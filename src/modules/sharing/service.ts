/**
 * Partage de collection entre utilisateurs (Lot 7, demande produit 2026-09-03).
 *
 * Un lien d'invitation à usage unique, généré par le propriétaire ; qui, consommé par un
 * autre utilisateur déjà identifié via Discogs (aucune inscription séparée), crée un
 * partage durable. Depuis ce moment, ce partage — et lui seul — décide si un utilisateur
 * peut consulter la collection d'un autre ; `current-user.ts` le revérifie à chaque
 * requête, jamais une valeur mise en cache (§18.5).
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, isNull, lt } from 'drizzle-orm';

import { db } from '@/db/client';
import { collectionInvites, collectionShares, users } from '@/db/schema';
import { moduleLogger } from '@/lib/logger';

const log = moduleLogger('sharing');

/** Un lien d'invitation reste valide 7 jours — assez pour être relayé, pas indéfiniment. */
const INVITE_TTL_MS = 7 * 24 * 3_600_000;

function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export type CreatedInvite = { token: string; expiresAt: Date };

/** Crée un lien d'invitation pour la collection de `ownerId`. */
export async function createInvite(ownerId: string, now = new Date()): Promise<CreatedInvite> {
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);

  await db.insert(collectionInvites).values({
    ownerId,
    tokenHash: hashToken(token),
    expiresAt,
  });

  log.info({ ownerId }, 'invitation de collection créée');

  return { token, expiresAt };
}

export type PreviewedInvite = { ownerUsername: string; valid: boolean };

/**
 * Lit une invitation sans la consommer — pour afficher « X vous invite » avant que le
 * visiteur ne confirme. Un lien d'invitation transite par des canaux qui le suivent
 * parfois automatiquement (aperçu de messagerie, robot) ; une simple visite ne doit
 * jamais brûler un jeton à usage unique, seule une confirmation explicite (POST) le
 * fait via `consumeInvite`.
 */
export async function previewInvite(
  token: string,
  now = new Date(),
): Promise<PreviewedInvite | null> {
  const rows = await db
    .select({
      ownerUsername: users.discogsUsername,
      expiresAt: collectionInvites.expiresAt,
      consumedAt: collectionInvites.consumedAt,
    })
    .from(collectionInvites)
    .innerJoin(users, eq(users.id, collectionInvites.ownerId))
    .where(eq(collectionInvites.tokenHash, hashToken(token)))
    .limit(1);

  const invite = rows[0];
  if (!invite) {
    return null;
  }

  const valid = invite.consumedAt === null && invite.expiresAt.getTime() > now.getTime();
  return { ownerUsername: invite.ownerUsername, valid };
}

export type ConsumedInvite = { ownerId: string; ownerUsername: string };

/**
 * Consomme une invitation : usage unique, non expirée, jamais pour sa propre collection.
 * `UPDATE ... WHERE consumed_at IS NULL RETURNING` (même principe que les request tokens
 * OAuth, `auth/service.ts`) rend le rejeu impossible même si deux requêtes arrivent en
 * parallèle. Le partage créé remplace un éventuel partage déjà révoqué pour la même
 * paire ; s'il en existe déjà un actif, cette invitation ne fait qu'y renvoyer — jamais
 * une deuxième ligne vivante pour la même paire (index unique partiel du schéma).
 */
export async function consumeInvite(
  token: string,
  granteeId: string,
  now = new Date(),
): Promise<ConsumedInvite | null> {
  const rows = await db
    .update(collectionInvites)
    .set({ consumedAt: now, consumedByUserId: granteeId })
    .where(
      and(eq(collectionInvites.tokenHash, hashToken(token)), isNull(collectionInvites.consumedAt)),
    )
    .returning({ ownerId: collectionInvites.ownerId, expiresAt: collectionInvites.expiresAt });

  const invite = rows[0];
  if (!invite || invite.expiresAt.getTime() <= now.getTime()) {
    return null;
  }

  if (invite.ownerId === granteeId) {
    // Un propriétaire qui ouvre son propre lien (partagé par erreur, ou test) : le
    // jeton est déjà marqué consommé ci-dessus, pas de partage créé pour autant.
    log.warn(
      { ownerId: invite.ownerId },
      'invitation consommée par son propre propriétaire, ignorée',
    );
    return null;
  }

  await db
    .insert(collectionShares)
    .values({ ownerId: invite.ownerId, granteeId })
    .onConflictDoNothing();

  const [owner] = await db
    .select({ username: users.discogsUsername })
    .from(users)
    .where(eq(users.id, invite.ownerId))
    .limit(1);

  log.info({ ownerId: invite.ownerId, granteeId }, 'partage de collection créé');

  return { ownerId: invite.ownerId, ownerUsername: owner?.username ?? '' };
}

/**
 * Un partage actif existe-t-il pour cette paire ? Revérifié à chaque bascule de
 * collection active et à chaque résolution de session (`current-user.ts`) : c'est la
 * seule autorité, jamais une valeur en cache côté client ou côté session (§18.5).
 */
export async function hasActiveGrant(ownerId: string, granteeId: string): Promise<boolean> {
  const rows = await db
    .select({ id: collectionShares.id })
    .from(collectionShares)
    .where(
      and(
        eq(collectionShares.ownerId, ownerId),
        eq(collectionShares.granteeId, granteeId),
        isNull(collectionShares.revokedAt),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

export type GrantedToMe = { ownerId: string; ownerUsername: string; createdAt: Date };

/** Les collections auxquelles cet utilisateur a accès, en plus de la sienne. */
export async function listGrantsReceivedBy(granteeId: string): Promise<GrantedToMe[]> {
  const rows = await db
    .select({
      ownerId: collectionShares.ownerId,
      ownerUsername: users.discogsUsername,
      createdAt: collectionShares.createdAt,
    })
    .from(collectionShares)
    .innerJoin(users, eq(users.id, collectionShares.ownerId))
    .where(and(eq(collectionShares.granteeId, granteeId), isNull(collectionShares.revokedAt)))
    .orderBy(desc(collectionShares.createdAt));

  return rows;
}

export type GrantedByMe = { granteeId: string; granteeUsername: string; createdAt: Date };

/** Qui peut actuellement consulter la collection de cet utilisateur (gestion, réglages). */
export async function listGrantsGivenBy(ownerId: string): Promise<GrantedByMe[]> {
  const rows = await db
    .select({
      granteeId: collectionShares.granteeId,
      granteeUsername: users.discogsUsername,
      createdAt: collectionShares.createdAt,
    })
    .from(collectionShares)
    .innerJoin(users, eq(users.id, collectionShares.granteeId))
    .where(and(eq(collectionShares.ownerId, ownerId), isNull(collectionShares.revokedAt)))
    .orderBy(desc(collectionShares.createdAt));

  return rows;
}

/**
 * Révoque un partage. Qualifié par `ownerId` (§18.5) : seul le propriétaire de la
 * collection peut retirer un accès, jamais le bénéficiaire lui-même par cette voie.
 */
export async function revokeGrant(
  ownerId: string,
  granteeId: string,
  now = new Date(),
): Promise<void> {
  await db
    .update(collectionShares)
    .set({ revokedAt: now })
    .where(
      and(
        eq(collectionShares.ownerId, ownerId),
        eq(collectionShares.granteeId, granteeId),
        isNull(collectionShares.revokedAt),
      ),
    );

  log.info({ ownerId, granteeId }, 'partage de collection révoqué');
}

export async function purgeExpiredInvites(now = new Date()): Promise<void> {
  await db.delete(collectionInvites).where(lt(collectionInvites.expiresAt, now));
}
