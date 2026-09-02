/**
 * Service de collection (SPECIFICATION.md §8.3, §17.3).
 *
 * Deux règles structurent chaque requête :
 * - le `user_id` vient de la session serveur, jamais d'un paramètre client (§18.5) ;
 * - la réponse porte des **éditions logiques** avec leur nombre d'exemplaires, pas une
 *   tuile par exemplaire physique (COLL-005, §17.3).
 */
import { and, arrayOverlaps, eq, sql, type SQL } from 'drizzle-orm';

import { db } from '@/db/client';
import { collectionInstances, discogsReleases } from '@/db/schema';
import { normalizeText } from '@/modules/catalog/normalize';

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
