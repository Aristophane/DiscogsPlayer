/**
 * Partage de collection entre utilisateurs (Lot 7, demande produit 2026-09-03).
 *
 * Deux tables : l'invitation, un lien à usage unique généré par le propriétaire ; le
 * partage, la relation durable qu'elle crée une fois consommée. Distinctes à dessein —
 * l'invitation est un jeton, jetable ; le partage est la donnée qui compte, celle que
 * toute lecture de collection doit vérifier.
 *
 * Le jeton d'invitation suit le même principe que les sessions (`auth.ts`) : seul son
 * empreinte SHA-256 est stockée, jamais la valeur en clair — c'est un porteur d'accès à
 * une collection entière, potentiellement inactif plusieurs jours dans une conversation,
 * pas un jeton OAuth éphémère consommé en quelques secondes.
 */
import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { users } from './auth';

export const collectionInvites = pgTable(
  'collection_invites',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    consumedByUserId: uuid('consumed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('collection_invites_token_hash_key').on(table.tokenHash),
    index('collection_invites_owner_id_idx').on(table.ownerId),
  ],
);

export const collectionShares = pgTable(
  'collection_shares',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    granteeId: uuid('grantee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Effective immédiatement : toute lecture revérifie ce champ, jamais une valeur mise en cache (§18.5). */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    // Un partage actif au plus par paire — une révocation puis une nouvelle invitation
    // en recrée un, jamais deux vivants à la fois pour la même paire.
    uniqueIndex('collection_shares_active_pair_idx')
      .on(table.ownerId, table.granteeId)
      .where(sql`${table.revokedAt} is null`),
    index('collection_shares_grantee_id_idx').on(table.granteeId),
  ],
);
