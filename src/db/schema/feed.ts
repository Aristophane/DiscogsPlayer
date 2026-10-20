import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth';

export const feedEditions = pgTable(
  'feed_editions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    day: text('day').notNull(),
    status: text('status').$type<'pending' | 'ready' | 'partial'>().notNull().default('pending'),
    editorialVersion: integer('editorial_version').notNull().default(0),
    enrichmentAttempts: integer('enrichment_attempts').notNull().default(0),
    retryAt: timestamp('retry_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('feed_editions_user_day_key').on(table.userId, table.day)],
);

export const feedPosts = pgTable(
  'feed_posts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    editionId: uuid('edition_id')
      .notNull()
      .references(() => feedEditions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    discogsReleaseId: text('discogs_release_id').notNull(),
    day: text('day').notNull(),
    position: integer('position').notNull(),
    contentKey: text('content_key').notNull(),
    content: jsonb('content').notNull(),
  },
  (table) => [
    uniqueIndex('feed_posts_user_content_key').on(table.userId, table.contentKey),
    uniqueIndex('feed_posts_edition_position_key').on(table.editionId, table.position),
    index('feed_posts_page_idx').on(table.userId, table.day, table.position),
  ],
);

/** Cache public partagé ; il ne contient ni propriétaire ni information de collection. */
export const feedSourceCache = pgTable('feed_source_cache', {
  key: text('key').primaryKey(),
  content: jsonb('content').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
