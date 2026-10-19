/** Radio : choix varié dans la collection, résolution locale puis recherche bornée. */
import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { radioSessionTracks, radioSessions } from '@/db/schema';
import { moduleLogger } from '@/lib/logger';
import {
  getKnownYoutubePlaybacks,
  resolveTrack,
  type ResolvedPlayback,
} from '@/modules/resolution/service';
import type { YoutubeApi } from '@/modules/providers/youtube/api';

import {
  selectRadioCandidate,
  wasPlayedInSession,
  type RadioCandidate,
  type RadioHistoryEntry,
} from './selection';

const log = moduleLogger('radio');
const MAX_ATTEMPTS_PER_DRAW = 6;

export type RadioFilters = { genres?: string[] | undefined; styles?: string[] | undefined };
export type RadioSessionView = {
  id: string;
  collectionOwnerId: string;
  filterGenres: string[];
  filterStyles: string[];
  completedAt: Date | null;
};
export type RadioDrawResult =
  | { status: 'track'; trackId: string; playback: ResolvedPlayback }
  | { status: 'exhausted' }
  | { status: 'unavailable' };

function eligibleTracksCondition(collectionOwnerId: string, filters: RadioFilters) {
  const genres = filters.genres ?? [];
  const styles = filters.styles ?? [];
  return sql`
    t.type = 'track'
    and exists (
      select 1 from collection_instances ci
      where ci.release_id = t.release_id
        and ci.user_id = ${collectionOwnerId}::uuid and ci.is_active = true
    )
    ${genres.length > 0 ? sql`and r.genres && ${sql.param(genres)}::text[]` : sql``}
    ${styles.length > 0 ? sql`and r.styles && ${sql.param(styles)}::text[]` : sql``}
  `;
}

export async function getActiveSession(userId: string): Promise<RadioSessionView | null> {
  const rows = await db
    .select({
      id: radioSessions.id,
      collectionOwnerId: radioSessions.collectionOwnerId,
      filterGenres: radioSessions.filterGenres,
      filterStyles: radioSessions.filterStyles,
      completedAt: radioSessions.completedAt,
    })
    .from(radioSessions)
    .where(and(eq(radioSessions.userId, userId), isNull(radioSessions.completedAt)))
    .limit(1);
  return rows[0] ?? null;
}

/** Ouvrir une session ferme la précédente et fige la collection choisie (partage). */
export async function createSession(
  userId: string,
  collectionOwnerId: string,
  filters: RadioFilters,
  now = new Date(),
): Promise<RadioSessionView> {
  return db.transaction(async (tx) => {
    await tx
      .update(radioSessions)
      .set({ completedAt: now })
      .where(and(eq(radioSessions.userId, userId), isNull(radioSessions.completedAt)));
    const [created] = await tx
      .insert(radioSessions)
      .values({
        userId,
        collectionOwnerId,
        filterGenres: filters.genres ?? [],
        filterStyles: filters.styles ?? [],
      })
      .returning({
        id: radioSessions.id,
        collectionOwnerId: radioSessions.collectionOwnerId,
        filterGenres: radioSessions.filterGenres,
        filterStyles: radioSessions.filterStyles,
        completedAt: radioSessions.completedAt,
      });
    log.info({ userId, collectionOwnerId, sessionId: created!.id }, 'radio ouverte');
    return created!;
  });
}

type CandidateRow = {
  trackId: string;
  releaseId: string;
  artistKey: string;
  recordingKey: string;
};

/** Réservation courte : aucun verrou ni connexion de transaction pendant les appels API. */
async function claimCandidate(
  userId: string,
  sessionId: string,
  candidate: RadioCandidate,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const session = await tx.execute<{ id: string }>(sql`
      select id from radio_sessions
      where id = ${sessionId}::uuid and user_id = ${userId}::uuid and completed_at is null
      for update
    `);
    if (session.length === 0) return false;
    const conflict = await tx.execute<{ track_id: string }>(sql`
      select track_id from radio_session_tracks
      where session_id = ${sessionId}::uuid
        and (track_id = ${candidate.trackId}::uuid
          or (${candidate.videoId}::text is not null and youtube_video_id = ${candidate.videoId}))
      limit 1
    `);
    if (conflict.length > 0) return false;
    const [lastOrder] = await tx.execute<{ value: number }>(sql`
      select coalesce(max(play_order), 0)::int as value
      from radio_session_tracks where session_id = ${sessionId}::uuid
    `);
    await tx.insert(radioSessionTracks).values({
      sessionId,
      trackId: candidate.trackId,
      resolved: false,
      youtubeVideoId: candidate.videoId,
      playOrder: lastOrder!.value + 1,
    });
    return true;
  });
}

/** Deux recherches concurrentes peuvent découvrir le même média : une seule le sert. */
async function recordPlayback(
  userId: string,
  sessionId: string,
  candidate: RadioCandidate,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const session = await tx.execute<{ id: string }>(sql`
      select id from radio_sessions
      where id = ${sessionId}::uuid and user_id = ${userId}::uuid for update
    `);
    if (session.length === 0) return false;
    const duplicate = await tx.execute<{ track_id: string }>(sql`
      select rst.track_id from radio_session_tracks rst
      join discogs_tracks t on t.id = rst.track_id
      join discogs_releases r on r.id = t.release_id
      where rst.session_id = ${sessionId}::uuid and rst.resolved = true
        and (rst.youtube_video_id = ${candidate.videoId}
          or r.artists_normalized || chr(31) || t.title_normalized = ${candidate.recordingKey})
      limit 1
    `);
    if (duplicate.length > 0) return false;
    await tx
      .update(radioSessionTracks)
      .set({
        resolved: true,
        youtubeVideoId: candidate.videoId,
      })
      .where(
        and(
          eq(radioSessionTracks.sessionId, sessionId),
          eq(radioSessionTracks.trackId, candidate.trackId),
        ),
      );
    return true;
  });
}

/**
 * Le cache et les vidéos Discogs forment un même bassin gratuit. Après six recherches
 * infructueuses, les pistes locales restent un repli, même récemment écoutées.
 */
export async function draw(
  userId: string,
  sessionId: string,
  youtubeApi?: YoutubeApi,
): Promise<RadioDrawResult> {
  const [session] = await db
    .select()
    .from(radioSessions)
    .where(and(eq(radioSessions.id, sessionId), eq(radioSessions.userId, userId)));
  if (!session || session.completedAt !== null) return { status: 'exhausted' };

  const filters = { genres: session.filterGenres, styles: session.filterStyles };
  const candidates = await db.execute<CandidateRow>(sql`
    select t.id as "trackId", t.release_id as "releaseId",
      r.artists_normalized as "artistKey",
      r.artists_normalized || chr(31) || t.title_normalized as "recordingKey"
    from discogs_tracks t join discogs_releases r on r.id = t.release_id
    where ${eligibleTracksCondition(session.collectionOwnerId, filters)}
      and not exists (
        select 1 from radio_session_tracks rst
        where rst.session_id = ${sessionId}::uuid and rst.track_id = t.id
      )
  `);
  const historyRows = await db.execute<
    CandidateRow & {
      sessionId: string;
      playedAt: string;
      videoId: string | null;
    }
  >(sql`
    select rst.track_id as "trackId", t.release_id as "releaseId",
      r.artists_normalized as "artistKey",
      r.artists_normalized || chr(31) || t.title_normalized as "recordingKey",
      rst.session_id as "sessionId", rst.played_at as "playedAt",
      rst.youtube_video_id as "videoId"
    from radio_session_tracks rst
    join radio_sessions rs on rs.id = rst.session_id
    join discogs_tracks t on t.id = rst.track_id
    join discogs_releases r on r.id = t.release_id
    where rs.user_id = ${userId}::uuid and rst.resolved = true
    order by rst.played_at desc, rs.created_at desc, rst.play_order desc
  `);
  const known = await getKnownYoutubePlaybacks([
    ...new Set([...candidates, ...historyRows].map((row) => row.releaseId)),
  ]);
  let remaining: RadioCandidate[] = candidates.map((row) => ({
    ...row,
    videoId: known.get(row.trackId)?.videoId ?? null,
  }));
  const history: RadioHistoryEntry[] = historyRows.map((row) => ({
    ...row,
    playedAt: new Date(row.playedAt),
    videoId: row.videoId ?? known.get(row.trackId)?.videoId ?? null,
  }));
  let searches = 0;
  while (remaining.length > 0) {
    const available =
      searches < MAX_ATTEMPTS_PER_DRAW
        ? remaining
        : remaining.filter((candidate) => candidate.videoId !== null);
    const candidate = selectRadioCandidate(available, history, sessionId);
    if (!candidate) {
      if (selectRadioCandidate(remaining, history, sessionId)) return { status: 'unavailable' };
      break;
    }
    remaining = remaining.filter((row) => row.trackId !== candidate.trackId);
    if (!(await claimCandidate(userId, sessionId, candidate))) continue;
    if (candidate.videoId === null) searches += 1;
    const playback = await resolveTrack(userId, candidate.trackId, youtubeApi);
    if (playback?.status !== 'resolved' || playback.provider !== 'youtube') continue;
    const resolvedCandidate = { ...candidate, videoId: playback.videoId };
    // Vérification après recherche, puis une seconde sous verrou pour la concurrence.
    if (
      wasPlayedInSession(resolvedCandidate, history, sessionId) ||
      !(await recordPlayback(userId, sessionId, resolvedCandidate))
    )
      continue;
    log.info({ sessionId, trackId: candidate.trackId, searches }, 'piste radio tirée');
    return { status: 'track', trackId: candidate.trackId, playback };
  }

  await db
    .update(radioSessions)
    .set({ completedAt: new Date() })
    .where(and(eq(radioSessions.id, sessionId), eq(radioSessions.userId, userId)));
  return { status: 'exhausted' };
}
