/**
 * Sessions de tirage aléatoire — Lot 4 (SPECIFICATION.md §10.6, §8.4).
 *
 * L'absence de répétition (RAND-003) n'est pas une règle applicative : c'est une
 * contrainte d'unicité en base. Une session mémorise ce qu'elle a déjà tiré, ce qui rend
 * la garantie vraie même après un rechargement de page ou depuis un autre appareil.
 */
import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { discogsReleases } from './catalog';
import { users } from './auth';

export const randomSessions = pgTable(
  'random_sessions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * Collection tirée (Lot 7, partage) : la sienne par défaut, ou celle d'un ami
     * consultée au moment d'ouvrir la session. Figée à la création, jamais redérivée
     * pendant la session — sans quoi basculer sa collection active en cours de route
     * changerait le bassin sous une session déjà ouverte, et RAND-003 (jamais deux fois
     * le même disque) perdrait tout son sens : le « déjà vu » d'une collection ne veut
     * rien dire pour une autre.
     */
    collectionOwnerId: uuid('collection_owner_id')
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
    /** Nombre d'éditions éligibles au moment de la création, pour la progression. */
    eligibleCount: integer('eligible_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Posé à l'épuisement (RAND-007) : la session ne tire plus, elle propose de recommencer. */
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    // SPEC-GAPS G-08 : une seule session active par utilisateur, sinon « la session »
    // dont parle RAND-003 n'a pas de référent.
    uniqueIndex('random_sessions_one_active_per_user')
      .on(table.userId)
      .where(sql`${table.completedAt} is null`),
    index('random_sessions_user_created_idx').on(table.userId, table.createdAt),
  ],
);

export const randomSessionReleases = pgTable(
  'random_session_releases',
  {
    sessionId: uuid('session_id')
      .notNull()
      .references(() => randomSessions.id, { onDelete: 'cascade' }),
    releaseId: uuid('release_id')
      .notNull()
      .references(() => discogsReleases.id, { onDelete: 'cascade' }),
    drawnAt: timestamp('drawn_at', { withTimezone: true }).notNull().defaultNow(),
    drawOrder: integer('draw_order').notNull(),
  },
  (table) => [
    // RAND-003 : c'est cette contrainte, et non le code, qui interdit la répétition.
    uniqueIndex('random_session_releases_pkey').on(table.sessionId, table.releaseId),
    uniqueIndex('random_session_releases_order_key').on(table.sessionId, table.drawOrder),
  ],
);
