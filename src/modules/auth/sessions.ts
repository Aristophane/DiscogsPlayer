/**
 * Sessions applicatives (SPECIFICATION.md §11, AUTH-006).
 *
 * Jeton opaque de forte entropie : la valeur brute ne vit que dans un cookie `HttpOnly`,
 * la base ne connaît que son SHA-256. Double borne d'expiration — glissante sur
 * l'inactivité, absolue quoi qu'il arrive.
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db/client';
import { sessions, users } from '@/db/schema';
import { getEnv } from '@/lib/env';

export const SESSION_COOKIE_NAME = 'dp_session';

/** 32 octets = 256 bits d'entropie. */
function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export type SessionUser = {
  id: string;
  discogsUserId: string;
  discogsUsername: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: 'user' | 'admin';
  contributionStatus: 'active' | 'limited' | 'suspended';
  locale: string;
  /** ADR-0006 : préférence de recherche Spotify, jamais un OAuth. */
  spotifyEnabled: 'unset' | 'yes' | 'no';
  /**
   * Collection actuellement consultée (Lot 7, partage), brute et **non vérifiée** — la
   * valeur stockée sur la session, telle quelle. Ce n'est pas `current-user.ts` qui la
   * lit directement : il revérifie toujours contre `collection_shares` avant de s'en
   * servir (§18.5), pour qu'une révocation prenne effet dès la requête suivante, pas
   * seulement à la reconnexion. `null` = pas de bascule enregistrée, sa propre collection.
   */
  viewingAsUserId: string | null;
};

export type CreatedSession = {
  token: string;
  expiresAt: Date;
};

export async function createSession(userId: string, now = new Date()): Promise<CreatedSession> {
  const env = getEnv();
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + env.SESSION_ABSOLUTE_TTL_HOURS * 3_600_000);

  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    lastSeenAt: now,
  });

  return { token, expiresAt };
}

/**
 * Résout une session valide et rafraîchit `last_seen_at`.
 *
 * Retourne `null` pour toute session inexistante, révoquée, expirée, inactive au-delà de
 * la fenêtre glissante, ou appartenant à un compte supprimé — sans distinguer les cas,
 * afin de ne rien apprendre à un appelant qui essaierait des jetons.
 */
export async function resolveSession(token: string, now = new Date()): Promise<SessionUser | null> {
  const env = getEnv();

  const rows = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.lastSeenAt,
      revokedAt: sessions.revokedAt,
      viewingAsUserId: sessions.viewingAsUserId,
      user: {
        id: users.id,
        discogsUserId: users.discogsUserId,
        discogsUsername: users.discogsUsername,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        role: users.role,
        contributionStatus: users.contributionStatus,
        locale: users.locale,
        spotifyEnabled: users.spotifyEnabled,
        deletedAt: users.deletedAt,
      },
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, hashToken(token)))
    .limit(1);

  const row = rows[0];
  if (!row || row.revokedAt !== null || row.user.deletedAt !== null) {
    return null;
  }

  if (row.expiresAt.getTime() <= now.getTime()) {
    return null;
  }

  const idleDeadline = row.lastSeenAt.getTime() + env.SESSION_IDLE_TTL_HOURS * 3_600_000;
  if (idleDeadline <= now.getTime()) {
    return null;
  }

  // Écriture volontairement non bloquante pour le reste de la requête : une seconde de
  // retard sur `last_seen_at` n'a aucune conséquence de sécurité.
  await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.sessionId));

  return {
    id: row.user.id,
    discogsUserId: row.user.discogsUserId,
    discogsUsername: row.user.discogsUsername,
    displayName: row.user.displayName,
    avatarUrl: row.user.avatarUrl,
    role: row.user.role,
    contributionStatus: row.user.contributionStatus,
    locale: row.user.locale,
    spotifyEnabled: row.user.spotifyEnabled,
    viewingAsUserId: row.viewingAsUserId,
  };
}

/**
 * Fixe (ou efface, avec `null`) la collection consultée par cette session. Aucune
 * vérification de partage ici à dessein : c'est l'appelant (`current-user.ts` via la
 * route de bascule) qui doit avoir déjà confirmé un partage actif — cette fonction ne
 * fait qu'écrire, comme `revokeSession` ne fait que révoquer.
 */
export async function setViewingAsUserIdByToken(
  token: string,
  targetUserId: string | null,
): Promise<void> {
  await db
    .update(sessions)
    .set({ viewingAsUserId: targetUserId })
    .where(eq(sessions.tokenHash, hashToken(token)));
}

export async function revokeSession(token: string, now = new Date()): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)));
}

/** Révoque toutes les sessions d'un compte (déconnexion globale, suppression, §19.2). */
export async function revokeAllSessions(userId: string, now = new Date()): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}
