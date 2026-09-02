/**
 * Résolution de médias — Lot 6 (SPECIFICATION.md §10.4, §10.6).
 *
 * Le Lot 5 (corrections communautaires) est repoussé : ce schéma n'inclut donc ni
 * `mapping_proposals` ni `mapping_confirmations`. `trackResolutions` les remplace par une
 * version minimale — une correspondance globale unique, sans vote ni historique — documentée
 * comme simplification temporaire dans ADR-0007. Elle sera remplacée, pas complétée, quand
 * le Lot 5 sera repris.
 */
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { discogsTracks } from './catalog';

export const providerName = pgEnum('provider_name', ['youtube', 'spotify']);
export const providerEntityType = pgEnum('provider_entity_type', ['video', 'track', 'album']);
export const resolutionSource = pgEnum('resolution_source', [
  'discogs_video',
  'youtube_search',
  'spotify_search',
  'manual_url',
]);

/** Cache des métadonnées fournisseur — jamais la source canonique du catalogue (§10.4). */
export const providerEntities = pgTable(
  'provider_entities',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    provider: providerName('provider').notNull(),
    entityType: providerEntityType('entity_type').notNull(),
    externalId: text('external_id').notNull(),
    canonicalUrl: text('canonical_url').notNull(),
    titleCache: text('title_cache'),
    artistCache: text('artist_cache'),
    durationSecondsCache: integer('duration_seconds_cache'),
    thumbnailUrlCache: text('thumbnail_url_cache'),
    metadataFetchedAt: timestamp('metadata_fetched_at', { withTimezone: true }),
    /** Politique YouTube : rafraîchir ou supprimer sous 30 jours (§13.7, SPEC-GAPS G-02). */
    metadataExpiresAt: timestamp('metadata_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('provider_entities_provider_type_external_key').on(
      table.provider,
      table.entityType,
      table.externalId,
    ),
  ],
);

/**
 * Correspondance globale simplifiée (remplace `mapping_proposals` en attendant le Lot 5).
 * Une seule ligne par piste : la dernière résolution automatique réussie fait foi pour
 * tout le monde, sans confirmation ni conflit — ADR-0007.
 */
export const trackResolutions = pgTable(
  'track_resolutions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    trackId: uuid('track_id')
      .notNull()
      .references(() => discogsTracks.id, { onDelete: 'cascade' }),
    providerEntityId: uuid('provider_entity_id')
      .notNull()
      .references(() => providerEntities.id, { onDelete: 'cascade' }),
    source: resolutionSource('source').notNull(),
    /** Conservé pour audit et débogage du matching (§15), pas affiché à l'utilisateur. */
    confidenceScore: real('confidence_score'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('track_resolutions_track_id_key').on(table.trackId)],
);

/**
 * Quota YouTube compté en unités, pas en appels (ADR-0002).
 * Une fenêtre par (provider, operation, window_start) ; mise à jour atomique.
 */
export const providerQuotaWindows = pgTable(
  'provider_quota_windows',
  {
    provider: text('provider').notNull(),
    operation: text('operation').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    windowEnd: timestamp('window_end', { withTimezone: true }).notNull(),
    configuredLimit: integer('configured_limit').notNull(),
    estimatedUsed: integer('estimated_used').notNull().default(0),
    reportedUsed: numeric('reported_used'),
    exhaustedAt: timestamp('exhausted_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('provider_quota_windows_pkey').on(
      table.provider,
      table.operation,
      table.windowStart,
    ),
    index('provider_quota_windows_window_idx').on(table.windowStart),
  ],
);
