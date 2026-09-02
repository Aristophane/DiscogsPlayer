/**
 * Service du module auth : création de compte, jetons Discogs, rôles (§8.1, §5.2).
 * C'est le seul point d'entrée des autres modules vers les tables d'identité.
 */
import { and, eq, isNull, lt } from 'drizzle-orm';

import { db } from '@/db/client';
import { discogsCredentials, discogsRequestTokens, users } from '@/db/schema';
import { getEnv } from '@/lib/env';

import { decryptSecret, encryptSecret } from './crypto';
import type { DiscogsIdentity, OAuthTokenPair } from './discogs-oauth';

/** Durée de vie d'un request token en attente de callback (§11, callbacks expirés). */
const REQUEST_TOKEN_TTL_MS = 15 * 60_000;

/**
 * Le rôle admin est attribué explicitement, jamais déduit du nom affiché (§5.2).
 * La configuration l'emporte : elle permet de rétablir un accès sans requête SQL.
 */
export function isConfiguredAdmin(discogsUserId: string): boolean {
  return getEnv().ADMIN_DISCOGS_USER_IDS.includes(discogsUserId);
}

export async function storeRequestToken(pair: OAuthTokenPair, now = new Date()): Promise<void> {
  const encrypted = encryptSecret(pair.tokenSecret);

  await db.insert(discogsRequestTokens).values({
    token: pair.token,
    tokenSecretCiphertext: encrypted.ciphertext,
    encryptionKeyVersion: encrypted.keyVersion,
    expiresAt: new Date(now.getTime() + REQUEST_TOKEN_TTL_MS),
  });
}

/**
 * Consomme un request token : usage unique, non expiré.
 * `UPDATE ... RETURNING` sur la condition `consumed_at IS NULL` rend le rejeu impossible
 * même si deux callbacks arrivent en parallèle.
 */
export async function consumeRequestToken(
  token: string,
  now = new Date(),
): Promise<OAuthTokenPair | null> {
  const rows = await db
    .update(discogsRequestTokens)
    .set({ consumedAt: now })
    .where(and(eq(discogsRequestTokens.token, token), isNull(discogsRequestTokens.consumedAt)))
    .returning({
      tokenSecretCiphertext: discogsRequestTokens.tokenSecretCiphertext,
      expiresAt: discogsRequestTokens.expiresAt,
    });

  const row = rows[0];
  if (!row || row.expiresAt.getTime() <= now.getTime()) {
    return null;
  }

  return { token, tokenSecret: decryptSecret(row.tokenSecretCiphertext) };
}

export async function purgeExpiredRequestTokens(now = new Date()): Promise<void> {
  await db.delete(discogsRequestTokens).where(lt(discogsRequestTokens.expiresAt, now));
}

/**
 * Crée ou met à jour le compte local à partir de l'identité Discogs, et remplace ses
 * jetons chiffrés. Idempotent : une reconnexion ne duplique pas le compte (AUTH-007).
 */
export async function upsertUserFromDiscogs(
  discogsIdentity: DiscogsIdentity,
  tokens: OAuthTokenPair,
  now = new Date(),
): Promise<{ id: string; role: 'user' | 'admin' }> {
  const discogsUserId = String(discogsIdentity.id);
  const role = isConfiguredAdmin(discogsUserId) ? 'admin' : undefined;

  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        discogsUserId,
        discogsUsername: discogsIdentity.username,
        ...(role ? { role } : {}),
      })
      .onConflictDoUpdate({
        target: users.discogsUserId,
        set: {
          discogsUsername: discogsIdentity.username,
          updatedAt: now,
          // Une reconnexion réactive un compte précédemment marqué supprimé.
          deletedAt: null,
          ...(role ? { role } : {}),
        },
      })
      .returning({ id: users.id, role: users.role });

    if (!user) {
      throw new Error('Échec de la création du compte local');
    }

    const accessTokenEncrypted = encryptSecret(tokens.token);
    const accessSecretEncrypted = encryptSecret(tokens.tokenSecret);

    await tx
      .insert(discogsCredentials)
      .values({
        userId: user.id,
        accessTokenCiphertext: accessTokenEncrypted.ciphertext,
        accessTokenSecretCiphertext: accessSecretEncrypted.ciphertext,
        encryptionKeyVersion: accessTokenEncrypted.keyVersion,
      })
      .onConflictDoUpdate({
        target: discogsCredentials.userId,
        set: {
          accessTokenCiphertext: accessTokenEncrypted.ciphertext,
          accessTokenSecretCiphertext: accessSecretEncrypted.ciphertext,
          encryptionKeyVersion: accessTokenEncrypted.keyVersion,
          updatedAt: now,
        },
      });

    return user;
  });
}

/**
 * Jetons Discogs déchiffrés d'un utilisateur, pour les appels API en son nom.
 * Réservé au serveur : le résultat ne doit jamais traverser une frontière réseau.
 */
export async function getDiscogsTokens(userId: string): Promise<OAuthTokenPair | null> {
  const rows = await db
    .select({
      accessTokenCiphertext: discogsCredentials.accessTokenCiphertext,
      accessTokenSecretCiphertext: discogsCredentials.accessTokenSecretCiphertext,
    })
    .from(discogsCredentials)
    .where(eq(discogsCredentials.userId, userId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    token: decryptSecret(row.accessTokenCiphertext),
    tokenSecret: decryptSecret(row.accessTokenSecretCiphertext),
  };
}
