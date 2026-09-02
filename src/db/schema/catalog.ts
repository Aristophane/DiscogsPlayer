/**
 * Catalogue Discogs — Lot 2 (SPECIFICATION.md §10.2).
 *
 * Le catalogue est partagé entre tous les utilisateurs : une édition n'est chargée en
 * détail qu'une fois, quel que soit le nombre de collections qui la contiennent (§12.2).
 */
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const trackType = pgEnum('track_type', ['track', 'heading', 'index']);

export const discogsReleases = pgTable(
  'discogs_releases',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    discogsReleaseId: text('discogs_release_id').notNull(),
    /** Informatif seulement en v0 : aucune mutualisation entre éditions (MAP-009). */
    masterId: text('master_id'),
    title: text('title').notNull(),
    year: integer('year'),
    country: text('country'),
    formats: jsonb('formats')
      .notNull()
      .default(sql`'[]'::jsonb`),
    genres: text('genres')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    styles: text('styles')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    primaryImageUrl: text('primary_image_url'),
    /** Artistes aplatis, pour la recherche textuelle sans jointure (§10.2). */
    artistsText: text('artists_text').notNull().default(''),
    /**
     * Titre et artistes normalisés, concaténés : la recherche textuelle porte sur cette
     * colonne pour que « bjork » trouve « Björk » sans jointure (COLL-002, COLL-003).
     */
    searchText: text('search_text').notNull().default(''),
    /**
     * Titre et artistes normalisés séparément : la base est en collation `en_US.utf8`,
     * où « Ágætis » se trie après « Zoo ». Trier sur ces colonnes rend l'ordre
     * alphabétique conforme à ce qu'attend un lecteur francophone (§8.3).
     */
    titleNormalized: text('title_normalized').notNull().default(''),
    artistsNormalized: text('artists_normalized').notNull().default(''),
    rawSourceUpdatedAt: timestamp('raw_source_updated_at', { withTimezone: true }),
    /** `null` tant que seul le résumé de collection a été vu ; pilote la fraîcheur. */
    detailsFetchedAt: timestamp('details_fetched_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('discogs_releases_discogs_release_id_key').on(table.discogsReleaseId),
    // GIN : les filtres Genre/Style du mode aléatoire sont des recherches par tableau.
    index('discogs_releases_genres_idx').using('gin', table.genres),
    index('discogs_releases_styles_idx').using('gin', table.styles),
    index('discogs_releases_details_fetched_at_idx').on(table.detailsFetchedAt),
    // Trigrammes : une recherche « contient » reste rapide sans préfixe imposé.
    index('discogs_releases_search_text_idx').using('gin', sql`${table.searchText} gin_trgm_ops`),
  ],
);

export const discogsArtists = pgTable(
  'discogs_artists',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    discogsArtistId: text('discogs_artist_id'),
    name: text('name').notNull(),
    /** Sans accent ni casse : COLL-003 exige que « Bjork » trouve « Björk ». */
    nameNormalized: text('name_normalized').notNull(),
  },
  (table) => [
    uniqueIndex('discogs_artists_discogs_artist_id_key')
      .on(table.discogsArtistId)
      .where(sql`${table.discogsArtistId} is not null`),
    index('discogs_artists_name_normalized_idx').on(table.nameNormalized),
  ],
);

export const discogsReleaseArtists = pgTable(
  'discogs_release_artists',
  {
    releaseId: uuid('release_id')
      .notNull()
      .references(() => discogsReleases.id, { onDelete: 'cascade' }),
    artistId: uuid('artist_id')
      .notNull()
      .references(() => discogsArtists.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    joinText: text('join_text'),
  },
  (table) => [
    uniqueIndex('discogs_release_artists_release_position_key').on(table.releaseId, table.position),
    index('discogs_release_artists_artist_idx').on(table.artistId),
  ],
);

export const discogsTracks = pgTable(
  'discogs_tracks',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    releaseId: uuid('release_id')
      .notNull()
      .references(() => discogsReleases.id, { onDelete: 'cascade' }),
    /** Position telle qu'affichée par Discogs : `A1`, `1-03`… vide pour un heading. */
    discogsPosition: text('discogs_position').notNull().default(''),
    /** Ordre local déterministe, seul ordre fiable (SPEC-GAPS G-09). */
    ordinal: integer('ordinal').notNull(),
    title: text('title').notNull(),
    titleNormalized: text('title_normalized').notNull(),
    durationSeconds: integer('duration_seconds'),
    type: trackType('type').notNull().default('track'),
    extraArtists: jsonb('extra_artists')
      .notNull()
      .default(sql`'[]'::jsonb`),
  },
  (table) => [
    // G-09 : `(release_id, ordinal)` et non le triplet de la spécification, car
    // `discogs_position` est vide pour les headings et les index tracks.
    uniqueIndex('discogs_tracks_release_ordinal_key').on(table.releaseId, table.ordinal),
    index('discogs_tracks_title_normalized_idx').on(table.titleNormalized),
  ],
);

export const discogsReleaseVideos = pgTable(
  'discogs_release_videos',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    releaseId: uuid('release_id')
      .notNull()
      .references(() => discogsReleases.id, { onDelete: 'cascade' }),
    urlCanonical: text('url_canonical').notNull(),
    provider: text('provider').notNull().default('youtube'),
    externalId: text('external_id'),
    title: text('title'),
    durationSeconds: integer('duration_seconds'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('discogs_release_videos_release_url_key').on(table.releaseId, table.urlCanonical),
  ],
);
