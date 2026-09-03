/**
 * Schéma d'identité — Lot 1 (SPECIFICATION.md §10.1, §11).
 *
 * Trois tables : le compte local adossé à l'identité Discogs, les jetons OAuth chiffrés,
 * et les sessions applicatives. Une quatrième table stocke temporairement les request
 * tokens OAuth, dont le secret ne doit jamais transiter par le client (§11).
 */
import { sql } from 'drizzle-orm';
import {
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['user', 'admin']);
export const contributionStatus = pgEnum('contribution_status', ['active', 'limited', 'suspended']);

export const users = pgTable(
  'users',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** Identifiant numérique Discogs : stable, contrairement au nom d'utilisateur. */
    discogsUserId: text('discogs_user_id').notNull(),
    discogsUsername: text('discogs_username').notNull(),
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    role: userRole('role').notNull().default('user'),
    contributionStatus: contributionStatus('contribution_status').notNull().default('active'),
    locale: text('locale').notNull().default('fr'),
    /**
     * Préférence d'onboarding (ADR-0006) : indique si l'utilisateur a un compte Spotify,
     * pour proposer la recherche Spotify en repli. Facultatif, rejouable depuis les
     * paramètres — jamais un OAuth, jamais une donnée reçue de Spotify.
     */
    spotifyEnabled: text('spotify_enabled')
      .$type<'unset' | 'yes' | 'no'>()
      .notNull()
      .default('unset'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Compte purgé (§19.2, SPEC-GAPS G-10) : la ligne survit comme pierre tombale pour
     * l'intégrité des traces d'audit, les données privées sont supprimées physiquement.
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('users_discogs_user_id_key').on(table.discogsUserId)],
);

export const discogsCredentials = pgTable('discogs_credentials', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Chiffré AES-256-GCM ; le clair ne quitte jamais le module auth (§18.1). */
  accessTokenCiphertext: text('access_token_ciphertext').notNull(),
  accessTokenSecretCiphertext: text('access_token_secret_ciphertext').notNull(),
  /** Permet la rotation de clé sans déchiffrement de masse (§10.1). */
  encryptionKeyVersion: smallint('encryption_key_version').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Seul le hash SHA-256 est stocké : une fuite de base ne donne aucune session. */
    tokenHash: text('token_hash').notNull(),
    /** Expiration absolue, bornée quoi qu'il arrive (§11). */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Sert l'expiration glissante : inactivité prolongée = session morte. */
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /**
     * Collection actuellement consultée (Lot 7, partage) : `null` = la sienne, sinon un
     * ami dont le partage a été vérifié au moment de la bascule. Stockée pour éviter de
     * la redemander à chaque requête, mais jamais prise pour argent comptant : chaque
     * lecture la revérifie contre `collection_shares` (`current-user.ts`) — une
     * révocation doit prendre effet immédiatement, pas seulement à la reconnexion. Perdre
     * cette valeur (compte de l'ami supprimé) doit simplement ramener à sa propre
     * collection, jamais faire échouer la session : `set null`, pas `cascade`.
     */
    viewingAsUserId: uuid('viewing_as_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sessions_token_hash_key').on(table.tokenHash),
    index('sessions_user_id_idx').on(table.userId),
  ],
);

/**
 * Request tokens OAuth 1.0a en attente de callback.
 *
 * Le secret est conservé côté serveur et jamais renvoyé au navigateur (§11). La ligne est
 * consommée une seule fois : `consumedAt` bloque le rejeu d'un callback.
 */
export const discogsRequestTokens = pgTable(
  'discogs_request_tokens',
  {
    token: text('token').primaryKey(),
    tokenSecretCiphertext: text('token_secret_ciphertext').notNull(),
    encryptionKeyVersion: smallint('encryption_key_version').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('discogs_request_tokens_expires_at_idx').on(table.expiresAt)],
);
