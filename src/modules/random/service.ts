/**
 * Mode aléatoire (SPECIFICATION.md §8.4).
 *
 * Les quatre exigences difficiles sont portées par le SQL, pas par du code applicatif :
 * - RAND-001 : le tirage porte sur `discogs_releases`, donc sur des éditions uniques ;
 * - RAND-002 : la jointure vers les exemplaires passe par `exists`, jamais par un `join`
 *   qui multiplierait les lignes — un disque possédé en double n'a pas deux chances ;
 * - RAND-003 : l'unicité `(session, édition)` interdit la répétition en base ;
 * - RAND-005 : plusieurs valeurs d'un type se combinent par OU, les deux types par ET.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { randomSessions } from '@/db/schema';
import { moduleLogger } from '@/lib/logger';

const log = moduleLogger('random');

export type RandomFilters = {
  genres?: string[] | undefined;
  styles?: string[] | undefined;
};

export type RandomSessionView = {
  id: string;
  filterGenres: string[];
  filterStyles: string[];
  eligibleCount: number;
  drawnCount: number;
  completedAt: Date | null;
};

export type DrawResult =
  | { status: 'drawn'; releaseId: string; discogsReleaseId: string; drawOrder: number }
  | { status: 'exhausted' };

/**
 * Condition d'éligibilité d'une édition pour un utilisateur.
 *
 * `exists` et non `join` : c'est précisément ce qui empêche un exemplaire en double de
 * peser deux fois dans le tirage (RAND-002).
 */
function eligibleCondition(userId: string, filters: RandomFilters) {
  const genres = filters.genres ?? [];
  const styles = filters.styles ?? [];

  const genreCondition =
    genres.length > 0 ? sql`and r.genres && ${sql.param(genres)}::text[]` : sql``;
  const styleCondition =
    styles.length > 0 ? sql`and r.styles && ${sql.param(styles)}::text[]` : sql``;

  return sql`
    exists (
      select 1
      from collection_instances ci
      where ci.release_id = r.id
        and ci.user_id = ${userId}::uuid
        and ci.is_active = true
    )
    ${genreCondition}
    ${styleCondition}
  `;
}

/** Nombre d'éditions uniques éligibles, tous filtres appliqués. */
export async function countEligible(userId: string, filters: RandomFilters): Promise<number> {
  const rows = await db.execute<{ count: string }>(sql`
    select count(*)::text as count
    from discogs_releases r
    where ${eligibleCondition(userId, filters)}
  `);

  return Number(rows[0]?.count ?? 0);
}

export async function getActiveSession(userId: string): Promise<RandomSessionView | null> {
  const rows = await db
    .select({
      id: randomSessions.id,
      filterGenres: randomSessions.filterGenres,
      filterStyles: randomSessions.filterStyles,
      eligibleCount: randomSessions.eligibleCount,
      completedAt: randomSessions.completedAt,
      drawnCount: sql<string>`(
        select count(*)::text from random_session_releases rsr
        where rsr.session_id = ${randomSessions.id}
      )`,
    })
    .from(randomSessions)
    .where(and(eq(randomSessions.userId, userId), isNull(randomSessions.completedAt)))
    .limit(1);

  const row = rows[0];
  return row ? { ...row, drawnCount: Number(row.drawnCount) } : null;
}

export async function getSession(
  userId: string,
  sessionId: string,
): Promise<RandomSessionView | null> {
  // Filtrage par utilisateur issu de la session serveur (§18.5).
  const rows = await db
    .select({
      id: randomSessions.id,
      filterGenres: randomSessions.filterGenres,
      filterStyles: randomSessions.filterStyles,
      eligibleCount: randomSessions.eligibleCount,
      completedAt: randomSessions.completedAt,
      drawnCount: sql<string>`(
        select count(*)::text from random_session_releases rsr
        where rsr.session_id = ${randomSessions.id}
      )`,
    })
    .from(randomSessions)
    .where(and(eq(randomSessions.id, sessionId), eq(randomSessions.userId, userId)))
    .limit(1);

  const row = rows[0];
  return row ? { ...row, drawnCount: Number(row.drawnCount) } : null;
}

/**
 * Ouvre une session de tirage. Une session active existante est close : changer de filtres
 * revient à commencer une nouvelle série, et RAND-003 ne peut pas arbitrer entre deux
 * sessions concurrentes.
 */
export async function createSession(
  userId: string,
  filters: RandomFilters,
  now = new Date(),
): Promise<RandomSessionView> {
  const genres = filters.genres ?? [];
  const styles = filters.styles ?? [];
  const eligibleCount = await countEligible(userId, filters);

  return db.transaction(async (tx) => {
    await tx
      .update(randomSessions)
      .set({ completedAt: now })
      .where(and(eq(randomSessions.userId, userId), isNull(randomSessions.completedAt)));

    const [created] = await tx
      .insert(randomSessions)
      .values({ userId, filterGenres: genres, filterStyles: styles, eligibleCount })
      .returning({
        id: randomSessions.id,
        filterGenres: randomSessions.filterGenres,
        filterStyles: randomSessions.filterStyles,
        eligibleCount: randomSessions.eligibleCount,
        completedAt: randomSessions.completedAt,
      });

    log.info({ userId, sessionId: created!.id, eligibleCount, genres, styles }, 'session ouverte');

    return { ...created!, drawnCount: 0 };
  });
}

/**
 * Tire une édition non encore vue dans cette session.
 *
 * L'insertion et la sélection sont une seule instruction : deux tirages simultanés ne
 * peuvent pas rendre le même album, l'unicité `(session, édition)` tranchant en base.
 */
export async function draw(userId: string, sessionId: string): Promise<DrawResult> {
  const session = await getSession(userId, sessionId);

  if (!session || session.completedAt !== null) {
    return { status: 'exhausted' };
  }

  const filters = { genres: session.filterGenres, styles: session.filterStyles };

  const rows = await db.execute<{
    release_id: string;
    discogs_release_id: string;
    draw_order: number;
  }>(sql`
    with tirage as (
      insert into random_session_releases (session_id, release_id, draw_order)
      select
        ${sessionId}::uuid,
        r.id,
        coalesce(
          (select max(draw_order) from random_session_releases where session_id = ${sessionId}::uuid),
          0
        ) + 1
      from discogs_releases r
      where ${eligibleCondition(userId, filters)}
        and not exists (
          select 1 from random_session_releases rsr
          where rsr.session_id = ${sessionId}::uuid and rsr.release_id = r.id
        )
      order by random()
      limit 1
      on conflict do nothing
      returning release_id, draw_order
    )
    select tirage.release_id, tirage.draw_order, r.discogs_release_id
    from tirage
    join discogs_releases r on r.id = tirage.release_id
  `);

  const drawn = rows[0];

  if (!drawn) {
    // Plus rien à tirer : la session est close, l'interface proposera d'en ouvrir une
    // nouvelle plutôt que de reboucler silencieusement (RAND-007).
    await db
      .update(randomSessions)
      .set({ completedAt: new Date() })
      .where(and(eq(randomSessions.id, sessionId), isNull(randomSessions.completedAt)));

    return { status: 'exhausted' };
  }

  return {
    status: 'drawn',
    releaseId: drawn.release_id,
    discogsReleaseId: drawn.discogs_release_id,
    drawOrder: drawn.draw_order,
  };
}

/** Éditions déjà tirées, de la plus récente à la plus ancienne. */
export async function listDrawn(
  userId: string,
  sessionId: string,
  limit = 20,
): Promise<{ discogsReleaseId: string; drawOrder: number }[]> {
  const session = await getSession(userId, sessionId);
  if (!session) {
    return [];
  }

  const rows = await db.execute<{ discogs_release_id: string; draw_order: number }>(sql`
    select r.discogs_release_id, rsr.draw_order
    from random_session_releases rsr
    join discogs_releases r on r.id = rsr.release_id
    where rsr.session_id = ${sessionId}::uuid
    order by rsr.draw_order desc
    limit ${limit}
  `);

  return rows.map((row) => ({
    discogsReleaseId: row.discogs_release_id,
    drawOrder: row.draw_order,
  }));
}
