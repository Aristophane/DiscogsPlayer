/**
 * Collections et exécutions de synchronisation — Lot 2 (SPECIFICATION.md §10.3).
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { discogsReleases } from './catalog';
import { users } from './auth';

export const syncKind = pgEnum('sync_kind', ['initial', 'manual', 'scheduled']);
export const syncStatus = pgEnum('sync_status', [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

export const syncRuns = pgTable(
  'sync_runs',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: syncKind('kind').notNull(),
    status: syncStatus('status').notNull().default('queued'),
    /** `null` tant que la première page n'a pas révélé la pagination. */
    pagesTotal: integer('pages_total'),
    pagesProcessed: integer('pages_processed').notNull().default(0),
    itemsSeen: integer('items_seen').notNull().default(0),
    itemsChanged: integer('items_changed').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // SYNC-004 : deux synchronisations du même compte ne s'exécutent jamais en même
    // temps. La contrainte est portée par la base, pas par une vérification applicative.
    uniqueIndex('sync_runs_one_active_per_user')
      .on(table.userId)
      .where(sql`${table.status} in ('queued', 'running')`),
    index('sync_runs_user_created_idx').on(table.userId, table.createdAt),
  ],
);

export const collectionInstances = pgTable(
  'collection_instances',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    releaseId: uuid('release_id')
      .notNull()
      .references(() => discogsReleases.id, { onDelete: 'cascade' }),
    /** Un exemplaire physique : deux copies de la même édition font deux lignes (COLL-005). */
    discogsInstanceId: text('discogs_instance_id').notNull(),
    discogsFolderId: text('discogs_folder_id'),
    rating: integer('rating'),
    dateAdded: timestamp('date_added', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    /** Marqueur du dernier run l'ayant vu : base de la désactivation différée (SYNC-007). */
    lastSeenSyncId: uuid('last_seen_sync_id').references(() => syncRuns.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('collection_instances_user_instance_key').on(table.userId, table.discogsInstanceId),
    index('collection_instances_user_active_idx').on(table.userId, table.isActive),
    index('collection_instances_release_idx').on(table.releaseId),
  ],
);
