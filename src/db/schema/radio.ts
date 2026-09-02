/**
 * Mode Radio — lecture continue (ADR-0006 point 2 et 3).
 *
 * Distinct du mode Aléatoire (§8.4) : Aléatoire tire une édition et s'arrête, Radio
 * enchaîne des pistes en continu à travers toute la collection filtrée. Entrer en Radio
 * est la demande de lecture elle-même (amende PLAY-007 pour ce mode uniquement).
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { discogsTracks } from './catalog';
import { users } from './auth';

export const radioSessions = pgTable(
  'radio_sessions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    filterGenres: text('filter_genres')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    filterStyles: text('filter_styles')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Posé quand plus aucune piste éligible n'a été jouée (fin de la radio). */
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    // Une seule radio active par utilisateur, même contrainte que le mode Aléatoire
    // (SPEC-GAPS G-08) : sans quoi « la » session n'a pas de référent univoque.
    uniqueIndex('radio_sessions_one_active_per_user')
      .on(table.userId)
      .where(sql`${table.completedAt} is null`),
    index('radio_sessions_user_created_idx').on(table.userId, table.createdAt),
  ],
);

export const radioSessionTracks = pgTable(
  'radio_session_tracks',
  {
    sessionId: uuid('session_id')
      .notNull()
      .references(() => radioSessions.id, { onDelete: 'cascade' }),
    trackId: uuid('track_id')
      .notNull()
      .references(() => discogsTracks.id, { onDelete: 'cascade' }),
    /**
     * Toute piste tentée est marquée jouée, résolue ou non : sans cela, une piste sans
     * correspondance serait retentée à chaque tirage suivant, gaspillant du quota
     * YouTube sur le même échec (ADR-0006 point 3). `resolved` n'est qu'un diagnostic.
     */
    resolved: boolean('resolved').notNull(),
    playedAt: timestamp('played_at', { withTimezone: true }).notNull().defaultNow(),
    playOrder: integer('play_order').notNull(),
  },
  (table) => [
    uniqueIndex('radio_session_tracks_pkey').on(table.sessionId, table.trackId),
    uniqueIndex('radio_session_tracks_order_key').on(table.sessionId, table.playOrder),
  ],
);
