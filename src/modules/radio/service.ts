/**
 * Mode Radio — lecture continue à travers la collection (ADR-0006 points 2 et 3).
 *
 * Contrairement à `resolution/service.ts`, qui résout une piste précise choisie par
 * l'utilisateur, ce module choisit *quelle* piste jouer ensuite : il privilégie les
 * pistes déjà résolues (gratuites, instantanées) et ne recourt à la recherche YouTube
 * que si aucune n'est disponible, avec un nombre de tentatives borné par tirage pour ne
 * jamais consommer un quota illimité sur une collection mal couverte.
 *
 * Suit le même style que `random/service.ts` (SQL brut contre `collection_instances` et
 * `discogs_releases`) : c'est le précédent déjà établi dans ce dépôt pour ce genre de
 * requête d'éligibilité, plutôt que de passer par les services catalogue/collection.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { radioSessionTracks, radioSessions } from '@/db/schema';
import { moduleLogger } from '@/lib/logger';
import { getTrackForResolution } from '@/modules/catalog/release-service';
import { resolveTrack, type ResolvedPlayback } from '@/modules/resolution/service';
import type { YoutubeApi } from '@/modules/providers/youtube/api';

const log = moduleLogger('radio');

/** Nombre de pistes tentées au maximum pour un seul tirage (borne le coût en quota). */
const MAX_ATTEMPTS_PER_DRAW = 6;

export type RadioFilters = { genres?: string[] | undefined; styles?: string[] | undefined };

export type RadioSessionView = {
  id: string;
  filterGenres: string[];
  filterStyles: string[];
  completedAt: Date | null;
};

export type RadioDrawResult =
  | { status: 'track'; trackId: string; playback: ResolvedPlayback }
  | { status: 'exhausted' }
  | { status: 'unavailable' };

function eligibleTracksCondition(userId: string, filters: RadioFilters) {
  const genres = filters.genres ?? [];
  const styles = filters.styles ?? [];

  const genreCondition =
    genres.length > 0 ? sql`and r.genres && ${sql.param(genres)}::text[]` : sql``;
  const styleCondition =
    styles.length > 0 ? sql`and r.styles && ${sql.param(styles)}::text[]` : sql``;

  return sql`
    t.type = 'track'
    and exists (
      select 1 from collection_instances ci
      where ci.release_id = t.release_id
        and ci.user_id = ${userId}::uuid
        and ci.is_active = true
    )
    and r.id = t.release_id
    ${genreCondition}
    ${styleCondition}
  `;
}

export async function getActiveSession(userId: string): Promise<RadioSessionView | null> {
  const rows = await db
    .select({
      id: radioSessions.id,
      filterGenres: radioSessions.filterGenres,
      filterStyles: radioSessions.filterStyles,
      completedAt: radioSessions.completedAt,
    })
    .from(radioSessions)
    .where(and(eq(radioSessions.userId, userId), isNull(radioSessions.completedAt)))
    .limit(1);

  return rows[0] ?? null;
}

async function getSession(userId: string, sessionId: string): Promise<RadioSessionView | null> {
  const rows = await db
    .select({
      id: radioSessions.id,
      filterGenres: radioSessions.filterGenres,
      filterStyles: radioSessions.filterStyles,
      completedAt: radioSessions.completedAt,
    })
    .from(radioSessions)
    .where(and(eq(radioSessions.id, sessionId), eq(radioSessions.userId, userId)))
    .limit(1);

  return rows[0] ?? null;
}

/** Ouvre une session ; une session active existante est close (même règle que RAND). */
export async function createSession(
  userId: string,
  filters: RadioFilters,
  now = new Date(),
): Promise<RadioSessionView> {
  const genres = filters.genres ?? [];
  const styles = filters.styles ?? [];

  return db.transaction(async (tx) => {
    await tx
      .update(radioSessions)
      .set({ completedAt: now })
      .where(and(eq(radioSessions.userId, userId), isNull(radioSessions.completedAt)));

    const [created] = await tx
      .insert(radioSessions)
      .values({ userId, filterGenres: genres, filterStyles: styles })
      .returning({
        id: radioSessions.id,
        filterGenres: radioSessions.filterGenres,
        filterStyles: radioSessions.filterStyles,
        completedAt: radioSessions.completedAt,
      });

    log.info({ userId, sessionId: created!.id, genres, styles }, 'radio ouverte');

    return created!;
  });
}

/**
 * Sélectionne et marque une piste candidate — non encore jouée dans cette session,
 * en priorité parmi celles déjà résolues (`exists (select 1 from track_resolutions)`).
 * L'insertion sert de verrou : deux tirages concurrents ne peuvent pas choisir la même
 * piste, la contrainte unique `(session_id, track_id)` tranchant en base.
 *
 * `excludeTrackIds` écarte en plus un historique récent (toutes sessions confondues,
 * pas seulement celle-ci) : sans lui, relancer la radio choisissait quasi
 * systématiquement la même piste, celle priorisée par « déjà résolue » — souvent une
 * seule piste dans ce groupe au début, donc un tri par `random()` sans effet dessus.
 */
async function claimNextCandidate(
  sessionId: string,
  userId: string,
  filters: RadioFilters,
  excludeTrackIds: string[],
): Promise<string | null> {
  const recentExclusion =
    excludeTrackIds.length > 0
      ? sql`and not (t.id = any(${sql.param(excludeTrackIds)}::uuid[]))`
      : sql``;

  const rows = await db.execute<{ track_id: string }>(sql`
    with candidate as (
      select t.id
      from discogs_tracks t
      join discogs_releases r on r.id = t.release_id
      where ${eligibleTracksCondition(userId, filters)}
        and not exists (
          select 1 from radio_session_tracks rst
          where rst.session_id = ${sessionId}::uuid and rst.track_id = t.id
        )
        ${recentExclusion}
      order by
        (exists (select 1 from track_resolutions tr where tr.track_id = t.id)) desc,
        random()
      limit 1
    ),
    inserted as (
      insert into radio_session_tracks (session_id, track_id, resolved, play_order)
      select
        ${sessionId}::uuid,
        candidate.id,
        false,
        coalesce(
          (select max(play_order) from radio_session_tracks where session_id = ${sessionId}::uuid),
          0
        ) + 1
      from candidate
      on conflict do nothing
      returning track_id
    )
    select track_id from inserted
  `);

  return rows[0]?.track_id ?? null;
}

/**
 * Nombre de pistes récentes (toutes sessions de l'utilisateur confondues) à écarter des
 * tirages suivants — c'est ce qui empêche une relance de rouvrir systématiquement sur le
 * même titre.
 */
const RECENT_HISTORY_WINDOW = 5;

/** Dernières pistes jouées par cet utilisateur en Radio, toutes sessions confondues. */
async function recentlyPlayedTrackIds(userId: string, limit: number): Promise<string[]> {
  const rows = await db.execute<{ track_id: string }>(sql`
    select rst.track_id
    from radio_session_tracks rst
    join radio_sessions rs on rs.id = rst.session_id
    where rs.user_id = ${userId}::uuid
    order by rst.played_at desc
    limit ${limit}
  `);

  return rows.map((row) => row.track_id);
}

/**
 * Réclame le prochain candidat en évitant l'historique récent — sauf si ça ne laisse
 * plus rien : « dans la mesure du possible » (demande produit), jamais au prix d'un
 * épuisement à tort d'une radio filtrée sur un petit périmètre.
 */
async function claimNextCandidateAvoidingHistory(
  sessionId: string,
  userId: string,
  filters: RadioFilters,
  recentlyPlayed: string[],
): Promise<string | null> {
  const withHistoryExcluded = await claimNextCandidate(sessionId, userId, filters, recentlyPlayed);
  if (withHistoryExcluded || recentlyPlayed.length === 0) {
    return withHistoryExcluded;
  }

  return claimNextCandidate(sessionId, userId, filters, []);
}

async function markResolved(sessionId: string, trackId: string): Promise<void> {
  await db
    .update(radioSessionTracks)
    .set({ resolved: true })
    .where(
      and(eq(radioSessionTracks.sessionId, sessionId), eq(radioSessionTracks.trackId, trackId)),
    );
}

/**
 * Tire la prochaine piste à jouer. Essaie jusqu'à `MAX_ATTEMPTS_PER_DRAW` candidats —
 * les pistes déjà résolues d'abord, donc gratuites — avant d'abandonner ce tirage plutôt
 * que de consommer un quota illimité sur une collection mal couverte.
 */
export async function draw(
  userId: string,
  sessionId: string,
  youtubeApi?: YoutubeApi,
): Promise<RadioDrawResult> {
  const session = await getSession(userId, sessionId);
  if (!session || session.completedAt !== null) {
    return { status: 'exhausted' };
  }

  const filters = { genres: session.filterGenres, styles: session.filterStyles };
  // Calculé une fois pour tout l'appel : les tentatives suivantes de ce même tirage
  // doivent éviter le même historique récent, pas seulement la première.
  const recentlyPlayed = await recentlyPlayedTrackIds(userId, RECENT_HISTORY_WINDOW);

  for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_DRAW; attempt += 1) {
    const trackId = await claimNextCandidateAvoidingHistory(
      sessionId,
      userId,
      filters,
      recentlyPlayed,
    );

    if (!trackId) {
      // Plus aucune piste éligible non jouée : la radio est terminée.
      await db
        .update(radioSessions)
        .set({ completedAt: new Date() })
        .where(and(eq(radioSessions.id, sessionId), isNull(radioSessions.completedAt)));

      return { status: 'exhausted' };
    }

    const track = await getTrackForResolution(trackId);
    if (!track) {
      continue;
    }

    const playback = await resolveTrack(userId, trackId, youtubeApi);

    if (playback?.status === 'resolved') {
      await markResolved(sessionId, trackId);
      log.info({ sessionId, trackId, attempt }, 'piste radio tirée');
      return { status: 'track', trackId, playback };
    }

    // Non résolue : déjà marquée jouée par `claimNextCandidate` (elle ne sera pas
    // retentée dans cette session), on essaie un autre candidat sans dépenser plus
    // qu'une tentative de recherche par piste manquée.
  }

  // Des pistes restent éligibles, mais aucune parmi les tentatives n'a pu être résolue
  // (quota probablement épuisé) : distinct d'un épuisement réel du catalogue filtré.
  return { status: 'unavailable' };
}
