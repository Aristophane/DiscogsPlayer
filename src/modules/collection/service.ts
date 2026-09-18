/**
 * Service de collection (SPECIFICATION.md §8.3, §17.3).
 *
 * Deux règles structurent chaque requête :
 * - le `user_id` vient de la session serveur, jamais d'un paramètre client (§18.5) ;
 * - la réponse porte des **éditions logiques** avec leur nombre d'exemplaires, pas une
 *   tuile par exemplaire physique (COLL-005, §17.3).
 */
import { and, arrayOverlaps, eq, inArray, sql, type SQL } from 'drizzle-orm';

import { db } from '@/db/client';
import { collectionInstances, discogsReleases } from '@/db/schema';
import { normalizeText } from '@/modules/catalog/normalize';
import { STATISTICS_FRESHNESS_MS } from '@/modules/catalog/service';
import { listGrantsReceivedBy } from '@/modules/sharing/service';

import { DEFAULT_SORT, decodeCursor, encodeCursor, type Cursor, type SortOption } from './cursor';

export const PAGE_SIZE = 48;

export type CollectionItem = {
  releaseId: string;
  discogsReleaseId: string;
  title: string;
  artists: string;
  year: number | null;
  genres: string[];
  styles: string[];
  coverUrl: string | null;
  communityHave: number | null;
  communityWant: number | null;
  /** Nombre d'exemplaires possédés (COLL-006), sans effet sur le tirage aléatoire. */
  instanceCount: number;
};

export type CollectionQuery = {
  query?: string | undefined;
  genres?: string[] | undefined;
  styles?: string[] | undefined;
  sort?: SortOption | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
};

export type CollectionPageResult = {
  items: CollectionItem[];
  nextCursor: string | null;
};

/**
 * Clé de tri de chaque option, exprimée sur l'agrégat.
 *
 * `date_added` est agrégé par `MIN` (SPEC-GAPS G-19) : quand un album est possédé en
 * plusieurs exemplaires, c'est la date de la première acquisition qui fait foi.
 */
const SORT_KEYS: Record<
  SortOption,
  { expression: SQL; direction: 'asc' | 'desc'; cast: 'timestamptz' | 'int' | 'text' }
> = {
  date_added_desc: {
    expression: sql`min(${collectionInstances.dateAdded})`,
    direction: 'desc',
    cast: 'timestamptz',
  },
  // Tri sur les colonnes normalisées : la base est en collation `en_US.utf8`, où
  // « Ágætis » se trierait après « Zoo ».
  artist_asc: {
    expression: sql`min(${discogsReleases.artistsNormalized})`,
    direction: 'asc',
    cast: 'text',
  },
  title_asc: {
    expression: sql`min(${discogsReleases.titleNormalized})`,
    direction: 'asc',
    cast: 'text',
  },
  year_desc: { expression: sql`min(${discogsReleases.year})`, direction: 'desc', cast: 'int' },
};

/** Filtres communs à la liste et au comptage. */
function baseFilters(userId: string, params: CollectionQuery): SQL[] {
  const conditions: SQL[] = [
    eq(collectionInstances.userId, userId),
    eq(collectionInstances.isActive, true),
  ];

  const search = params.query ? normalizeText(params.query) : '';
  if (search !== '') {
    // Recherche « contient » sur titre et artistes normalisés (COLL-002, COLL-003).
    conditions.push(sql`${discogsReleases.searchText} like ${'%' + search + '%'}`);
  }

  // Plusieurs valeurs d'un même type sont combinées par OU, les deux types par ET
  // (RAND-005, appliqué aussi aux filtres de collection pour rester cohérent).
  if (params.genres && params.genres.length > 0) {
    conditions.push(arrayOverlaps(discogsReleases.genres, params.genres));
  }

  if (params.styles && params.styles.length > 0) {
    conditions.push(arrayOverlaps(discogsReleases.styles, params.styles));
  }

  return conditions;
}

/**
 * Condition « strictement après le curseur », dans l'ordre courant.
 *
 * La comparaison porte sur le couple (clé de tri, identifiant) : sans l'identifiant, deux
 * albums de même clé feraient boucler ou sauter la pagination. Les valeurs nulles sont
 * placées en fin d'ordre par `NULLS LAST`, et le curseur en tient compte.
 */
function cursorCondition(cursor: Cursor, sort: SortOption): SQL {
  const { expression, direction, cast } = SORT_KEYS[sort];
  const comparator = direction === 'desc' ? sql`<` : sql`>`;
  const id = sql`${discogsReleases.id}`;

  if (cursor.k === null) {
    // On était déjà dans la zone des valeurs absentes : seul l'identifiant départage.
    return sql`(${expression} is null and ${id} > ${cursor.i}::uuid)`;
  }

  // Le transtypage est indispensable : le curseur voyage en texte, la colonne est une
  // date ou un entier, et PostgreSQL refuse de comparer les deux sans conversion.
  const value = sql`${String(cursor.k)}::${sql.raw(cast)}`;

  return sql`(
    ${expression} ${comparator} ${value}
    or (${expression} = ${value} and ${id} > ${cursor.i}::uuid)
    or ${expression} is null
  )`;
}

export async function listCollection(
  userId: string,
  params: CollectionQuery = {},
): Promise<CollectionPageResult> {
  const sort = params.sort ?? DEFAULT_SORT;
  const limit = Math.min(Math.max(params.limit ?? PAGE_SIZE, 1), 100);
  const cursor = decodeCursor(params.cursor, sort);
  const { expression, direction } = SORT_KEYS[sort];

  const conditions = baseFilters(userId, params);
  const having = cursor ? cursorCondition(cursor, sort) : sql`true`;
  const order =
    direction === 'desc'
      ? sql`${expression} desc nulls last, ${discogsReleases.id} asc`
      : sql`${expression} asc nulls last, ${discogsReleases.id} asc`;

  const rows = await db
    .select({
      releaseId: discogsReleases.id,
      discogsReleaseId: discogsReleases.discogsReleaseId,
      title: discogsReleases.title,
      artists: discogsReleases.artistsText,
      year: discogsReleases.year,
      genres: discogsReleases.genres,
      styles: discogsReleases.styles,
      coverUrl: discogsReleases.primaryImageUrl,
      communityHave: discogsReleases.communityHave,
      communityWant: discogsReleases.communityWant,
      instanceCount: sql<string>`count(*)::text`,
      sortKey: expression,
    })
    .from(collectionInstances)
    .innerJoin(discogsReleases, eq(discogsReleases.id, collectionInstances.releaseId))
    .where(and(...conditions))
    .groupBy(discogsReleases.id)
    .having(having)
    .orderBy(order)
    // Un élément de plus que demandé : sa présence révèle qu'une page suivante existe.
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  const items: CollectionItem[] = page.map((row) => ({
    releaseId: row.releaseId,
    discogsReleaseId: row.discogsReleaseId,
    title: row.title,
    artists: row.artists,
    year: row.year,
    genres: row.genres,
    styles: row.styles,
    coverUrl: row.coverUrl,
    communityHave: row.communityHave,
    communityWant: row.communityWant,
    instanceCount: Number(row.instanceCount),
  }));

  const nextCursor =
    hasMore && last
      ? encodeCursor({
          k: normalizeSortKey(last.sortKey),
          i: last.releaseId,
          s: sort,
        })
      : null;

  return { items, nextCursor };
}

/** Une clé de tri peut être une date, un nombre ou du texte selon l'option choisie. */
function normalizeSortKey(value: unknown): string | number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  return String(value);
}

/** Nombre d'éditions distinctes correspondant aux filtres. */
export async function countCollection(
  userId: string,
  params: CollectionQuery = {},
): Promise<number> {
  const rows = await db
    .select({ count: sql<string>`count(distinct ${discogsReleases.id})::text` })
    .from(collectionInstances)
    .innerJoin(discogsReleases, eq(discogsReleases.id, collectionInstances.releaseId))
    .where(and(...baseFilters(userId, params)));

  return Number(rows[0]?.count ?? 0);
}

export type Facet = { value: string; count: number };

export type RankedRelease = Pick<
  CollectionItem,
  'discogsReleaseId' | 'title' | 'artists' | 'coverUrl' | 'communityHave' | 'communityWant'
> & { lowestPriceEur: string | null; statisticsFetchedAt: Date | null };

/** Deux tops sur les éditions actives du propriétaire, jamais sur le catalogue global. */
export async function getCollectionHighlights(userId: string) {
  const threshold = new Date(Date.now() - STATISTICS_FRESHNESS_MS).toISOString();
  const ranked = (kind: 'wanted' | 'value') =>
    db
      .select({
        discogsReleaseId: discogsReleases.discogsReleaseId,
        title: discogsReleases.title,
        artists: discogsReleases.artistsText,
        coverUrl: discogsReleases.primaryImageUrl,
        communityHave: discogsReleases.communityHave,
        communityWant: discogsReleases.communityWant,
        lowestPriceEur: discogsReleases.lowestPriceEur,
        statisticsFetchedAt: discogsReleases.statisticsFetchedAt,
      })
      .from(collectionInstances)
      .innerJoin(discogsReleases, eq(discogsReleases.id, collectionInstances.releaseId))
      .where(
        and(
          ...baseFilters(userId, {}),
          kind === 'wanted'
            ? sql`${discogsReleases.communityWant} > 0`
            : sql`${discogsReleases.lowestPriceEur} > 0 and ${discogsReleases.numForSale} > 0`,
        ),
      )
      .groupBy(discogsReleases.id)
      .orderBy(
        kind === 'wanted'
          ? sql`${discogsReleases.communityWant} desc`
          : sql`${discogsReleases.lowestPriceEur} desc`,
        discogsReleases.titleNormalized,
        discogsReleases.id,
      )
      .limit(5);
  const [wanted, valuable, [coverage]] = await Promise.all([
    ranked('wanted'),
    ranked('value'),
    db
      .select({
        total: sql<number>`count(distinct ${discogsReleases.id})::int`,
        fetched: sql<number>`count(distinct ${discogsReleases.id}) filter (where ${discogsReleases.statisticsFetchedAt} is not null)::int`,
        fresh: sql<number>`count(distinct ${discogsReleases.id}) filter (where ${discogsReleases.statisticsFetchedAt} >= ${threshold}::timestamptz)::int`,
      })
      .from(collectionInstances)
      .innerJoin(discogsReleases, eq(discogsReleases.id, collectionInstances.releaseId))
      .where(and(...baseFilters(userId, {}))),
  ]);
  return {
    wanted,
    valuable,
    total: coverage?.total ?? 0,
    fetched: coverage?.fetched ?? 0,
    fresh: coverage?.fresh ?? 0,
  };
}

/** Derniers ajouts des seules collections partagées avec l'utilisateur connecté. */
export async function getFriendsActivity(userId: string) {
  const grants = await listGrantsReceivedBy(userId);
  if (grants.length === 0) return [];
  const rows = await db
    .select({
      ownerId: collectionInstances.userId,
      discogsReleaseId: discogsReleases.discogsReleaseId,
      title: discogsReleases.title,
      artists: discogsReleases.artistsText,
      coverUrl: discogsReleases.primaryImageUrl,
      // La première acquisition fait foi, comme dans la collection (G-19).
      addedAt: sql<string | null>`min(${collectionInstances.dateAdded})`,
    })
    .from(collectionInstances)
    .innerJoin(discogsReleases, eq(discogsReleases.id, collectionInstances.releaseId))
    .where(
      and(
        inArray(
          collectionInstances.userId,
          grants.map((grant) => grant.ownerId),
        ),
        eq(collectionInstances.isActive, true),
      ),
    )
    .groupBy(collectionInstances.userId, discogsReleases.id)
    .orderBy(
      sql`min(${collectionInstances.dateAdded}) desc nulls last`,
      collectionInstances.userId,
      discogsReleases.id,
    )
    .limit(12);
  const usernames = new Map(grants.map((grant) => [grant.ownerId, grant.ownerUsername]));
  return rows.map((row) => ({ ...row, ownerUsername: usernames.get(row.ownerId)! }));
}

/** Tirage uniforme par édition, sans modifier les sessions du mode Aléatoire. */
export async function getRandomSpotlight(userId: string, previousReleaseId?: string) {
  const [item] = await db
    .select({
      discogsReleaseId: discogsReleases.discogsReleaseId,
      title: discogsReleases.title,
      artists: discogsReleases.artistsText,
      coverUrl: discogsReleases.primaryImageUrl,
      year: discogsReleases.year,
    })
    .from(discogsReleases)
    .where(
      sql`exists (
      select 1 from ${collectionInstances}
      where ${collectionInstances.releaseId} = ${discogsReleases.id}
        and ${collectionInstances.userId} = ${userId}::uuid
        and ${collectionInstances.isActive} = true
    )`,
    )
    // L'édition précédente passe en dernier : réutilisée seulement s'il n'y en a qu'une.
    .orderBy(
      sql`(${discogsReleases.discogsReleaseId} = ${previousReleaseId ?? ''}) asc`,
      sql`random()`,
    )
    .limit(1);
  return item ?? null;
}

/** Les absences sont rafraîchies au même rythme que les valeurs, sans boucle de requêtes. */
export async function listStaleCollectionStatistics(userId: string): Promise<string[]> {
  const threshold = new Date(Date.now() - STATISTICS_FRESHNESS_MS).toISOString();
  const rows = await db
    .selectDistinct({ discogsReleaseId: discogsReleases.discogsReleaseId })
    .from(collectionInstances)
    .innerJoin(discogsReleases, eq(discogsReleases.id, collectionInstances.releaseId))
    .where(
      and(
        ...baseFilters(userId, {}),
        sql`(${discogsReleases.statisticsFetchedAt} is null
      or ${discogsReleases.statisticsFetchedAt} < ${threshold}::timestamptz)`,
      ),
    );
  return rows.map((row) => row.discogsReleaseId);
}

/**
 * Genres et styles réellement présents dans la collection de l'utilisateur, avec leur
 * nombre d'éditions. Proposer un filtre qui ne ramène rien serait une impasse.
 */
export async function listFacets(userId: string): Promise<{ genres: Facet[]; styles: Facet[] }> {
  const query = async (column: SQL) => {
    const rows = await db
      .select({ value: sql<string>`value`, count: sql<string>`count(distinct release_id)::text` })
      .from(
        sql`(
          select distinct ${discogsReleases.id} as release_id, unnest(${column}) as value
          from ${collectionInstances}
          inner join ${discogsReleases} on ${discogsReleases.id} = ${collectionInstances.releaseId}
          where ${collectionInstances.userId} = ${userId}::uuid
            and ${collectionInstances.isActive} = true
        ) as facets`,
      )
      .groupBy(sql`value`)
      .orderBy(sql`count(distinct release_id) desc, value asc`);

    return rows.map((row) => ({ value: row.value, count: Number(row.count) }));
  };

  return {
    genres: await query(sql`${discogsReleases.genres}`),
    styles: await query(sql`${discogsReleases.styles}`),
  };
}

export type VideoCoverage = { totalTracks: number; coveredTracks: number; percent: number };

/**
 * Part de la collection déjà couverte par une vidéo connue — demande produit, affichée
 * dans les paramètres (2026-09-03). « Couverte » veut dire : une résolution existe déjà
 * dans `track_resolutions`, qu'elle vienne d'une vidéo Discogs appariée à l'import ou
 * d'une recherche passée — jamais une recherche déclenchée pour calculer ce chiffre
 * (§4.2, aucune résolution sans demande explicite de lecture). Une piste d'une édition
 * dont les détails n'ont pas encore été récupérés (import en arrière-plan toujours en
 * cours) compte dans le dénominateur dès qu'elle existe en base, pas avant — ce qui sous-
 * estime honnêtement la couverture pendant un import, plutôt que de la surestimer en
 * ignorant ce qui n'est pas encore connu.
 */
export async function getVideoCoverage(userId: string): Promise<VideoCoverage> {
  const rows = await db.execute<{ total: string; covered: string }>(sql`
    select
      count(*)::text as total,
      count(tr.id)::text as covered
    from discogs_tracks t
    inner join discogs_releases r on r.id = t.release_id
    left join track_resolutions tr on tr.track_id = t.id
    where t.type = 'track'
      and exists (
        select 1
        from collection_instances ci
        where ci.release_id = r.id
          and ci.user_id = ${userId}::uuid
          and ci.is_active = true
      )
  `);

  const totalTracks = Number(rows[0]?.total ?? 0);
  const coveredTracks = Number(rows[0]?.covered ?? 0);
  const percent = totalTracks === 0 ? 0 : Math.round((coveredTracks / totalTracks) * 100);

  return { totalTracks, coveredTracks, percent };
}
