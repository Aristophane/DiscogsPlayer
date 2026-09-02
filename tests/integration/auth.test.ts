/**
 * Critère de sortie du Lot 1 (SPECIFICATION.md §24) :
 * « deux comptes simulés restent isolés et une session révoquée ne fonctionne plus ».
 *
 * Ces tests parlent à la base PostgreSQL locale. Aucun appel réseau réel : les réponses
 * Discogs sont fabriquées à la main (§22.3).
 */
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db, sql } from '@/db/client';
import { discogsCredentials, discogsRequestTokens, sessions, users } from '@/db/schema';
import type { DiscogsIdentity, OAuthTokenPair } from '@/modules/auth/discogs-oauth';
import {
  createSession,
  hashToken,
  resolveSession,
  revokeAllSessions,
  revokeSession,
} from '@/modules/auth/sessions';
import {
  consumeRequestToken,
  getDiscogsTokens,
  isConfiguredAdmin,
  storeRequestToken,
  upsertUserFromDiscogs,
} from '@/modules/auth/service';

/** Identités hors de toute plage réelle, pour un nettoyage sans risque. */
const ALICE: DiscogsIdentity = { id: 990_000_001, username: 'alice_test' };
const BOB: DiscogsIdentity = { id: 990_000_002, username: 'bob_test' };
const ADMIN: DiscogsIdentity = { id: 990_000_003, username: 'admin_test' };
const TEST_IDS = [ALICE, BOB, ADMIN].map((identity) => String(identity.id));

const ALICE_TOKENS: OAuthTokenPair = { token: 'alice-token', tokenSecret: 'alice-secret' };
const BOB_TOKENS: OAuthTokenPair = { token: 'bob-token', tokenSecret: 'bob-secret' };

const TEST_REQUEST_TOKENS = ['req-token-1', 'req-token-2'];

/** Le fichier doit pouvoir être rejoué : rien ne subsiste d'une exécution précédente. */
async function cleanup() {
  await db.delete(users).where(inArray(users.discogsUserId, TEST_IDS));
  await db
    .delete(discogsRequestTokens)
    .where(inArray(discogsRequestTokens.token, TEST_REQUEST_TOKENS));
}

beforeAll(cleanup);

afterAll(async () => {
  await cleanup();
  await sql.end();
});

describe('création de compte depuis l’identité Discogs', () => {
  it('crée puis retrouve le même compte, sans doublon (AUTH-007)', async () => {
    const first = await upsertUserFromDiscogs(ALICE, ALICE_TOKENS);
    const second = await upsertUserFromDiscogs(
      { ...ALICE, username: 'alice_renommee' },
      ALICE_TOKENS,
    );

    expect(second.id).toBe(first.id);

    const rows = await db
      .select()
      .from(users)
      .where(eq(users.discogsUserId, String(ALICE.id)));
    expect(rows).toHaveLength(1);
    // Le nom d'utilisateur Discogs peut changer ; l'identifiant numérique, non.
    expect(rows[0]?.discogsUsername).toBe('alice_renommee');
  });

  it('n’attribue le rôle admin que depuis la configuration (§5.2)', async () => {
    expect(isConfiguredAdmin(String(ADMIN.id))).toBe(true);
    expect(isConfiguredAdmin(String(ALICE.id))).toBe(false);

    const admin = await upsertUserFromDiscogs(ADMIN, ALICE_TOKENS);
    const alice = await upsertUserFromDiscogs(ALICE, ALICE_TOKENS);

    expect(admin.role).toBe('admin');
    expect(alice.role).toBe('user');
  });

  it('chiffre les jetons au repos (AUTH-005)', async () => {
    const alice = await upsertUserFromDiscogs(ALICE, ALICE_TOKENS);

    const rows = await db
      .select()
      .from(discogsCredentials)
      .where(eq(discogsCredentials.userId, alice.id));

    const row = rows[0];
    expect(row).toBeDefined();
    expect(row?.accessTokenCiphertext).not.toContain(ALICE_TOKENS.token);
    expect(row?.accessTokenSecretCiphertext).not.toContain(ALICE_TOKENS.tokenSecret);
    expect(row?.encryptionKeyVersion).toBe(1);

    // Le service, lui, sait les relire.
    await expect(getDiscogsTokens(alice.id)).resolves.toEqual(ALICE_TOKENS);
  });
});

describe('isolation multi-utilisateur (AUTH-007, §18.5)', () => {
  it('deux comptes simulés ne voient jamais la session ni les jetons de l’autre', async () => {
    const alice = await upsertUserFromDiscogs(ALICE, ALICE_TOKENS);
    const bob = await upsertUserFromDiscogs(BOB, BOB_TOKENS);

    expect(alice.id).not.toBe(bob.id);

    const aliceSession = await createSession(alice.id);
    const bobSession = await createSession(bob.id);

    const resolvedAlice = await resolveSession(aliceSession.token);
    const resolvedBob = await resolveSession(bobSession.token);

    expect(resolvedAlice?.id).toBe(alice.id);
    expect(resolvedBob?.id).toBe(bob.id);
    expect(resolvedAlice?.discogsUsername).not.toBe(resolvedBob?.discogsUsername);

    await expect(getDiscogsTokens(alice.id)).resolves.toEqual(ALICE_TOKENS);
    await expect(getDiscogsTokens(bob.id)).resolves.toEqual(BOB_TOKENS);
  });

  it('révoquer les sessions d’un compte n’affecte pas l’autre', async () => {
    const alice = await upsertUserFromDiscogs(ALICE, ALICE_TOKENS);
    const bob = await upsertUserFromDiscogs(BOB, BOB_TOKENS);

    const aliceSession = await createSession(alice.id);
    const bobSession = await createSession(bob.id);

    await revokeAllSessions(alice.id);

    expect(await resolveSession(aliceSession.token)).toBeNull();
    expect((await resolveSession(bobSession.token))?.id).toBe(bob.id);
  });
});

describe('cycle de vie des sessions (§11, AUTH-006)', () => {
  it('ne stocke que le hash du jeton, jamais sa valeur', async () => {
    const alice = await upsertUserFromDiscogs(ALICE, ALICE_TOKENS);
    const session = await createSession(alice.id);

    const rows = await db.select().from(sessions).where(eq(sessions.userId, alice.id));
    const stored = rows.map((row) => row.tokenHash);

    expect(stored).toContain(hashToken(session.token));
    expect(stored).not.toContain(session.token);
  });

  it('une session révoquée ne fonctionne plus', async () => {
    const alice = await upsertUserFromDiscogs(ALICE, ALICE_TOKENS);
    const session = await createSession(alice.id);

    expect((await resolveSession(session.token))?.id).toBe(alice.id);

    await revokeSession(session.token);

    expect(await resolveSession(session.token)).toBeNull();
  });

  it('une session expirée ne fonctionne plus, même non révoquée', async () => {
    const alice = await upsertUserFromDiscogs(ALICE, ALICE_TOKENS);
    const session = await createSession(alice.id);

    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(sessions.tokenHash, hashToken(session.token)));

    expect(await resolveSession(session.token)).toBeNull();
  });

  it('une session inactive au-delà de la fenêtre glissante ne fonctionne plus', async () => {
    const alice = await upsertUserFromDiscogs(ALICE, ALICE_TOKENS);
    const session = await createSession(alice.id);

    // Dernière activité il y a plus que SESSION_IDLE_TTL_HOURS (720 h par défaut).
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(Date.now() - 800 * 3_600_000) })
      .where(eq(sessions.tokenHash, hashToken(session.token)));

    expect(await resolveSession(session.token)).toBeNull();
  });

  it('rafraîchit last_seen_at à chaque résolution réussie', async () => {
    const alice = await upsertUserFromDiscogs(ALICE, ALICE_TOKENS);
    const session = await createSession(alice.id);
    const past = new Date(Date.now() - 3_600_000);

    await db
      .update(sessions)
      .set({ lastSeenAt: past })
      .where(eq(sessions.tokenHash, hashToken(session.token)));

    await resolveSession(session.token);

    const rows = await db
      .select({ lastSeenAt: sessions.lastSeenAt })
      .from(sessions)
      .where(eq(sessions.tokenHash, hashToken(session.token)));

    expect(rows[0]!.lastSeenAt.getTime()).toBeGreaterThan(past.getTime());
  });

  it('un jeton inconnu ne résout rien', async () => {
    expect(await resolveSession('jeton-inexistant')).toBeNull();
  });

  it('la session d’un compte supprimé ne fonctionne plus (§19.2)', async () => {
    const alice = await upsertUserFromDiscogs(ALICE, ALICE_TOKENS);
    const session = await createSession(alice.id);

    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, alice.id));

    expect(await resolveSession(session.token)).toBeNull();
  });
});

describe('request tokens OAuth (§11)', () => {
  it('se consomme une seule fois, ce qui bloque le rejeu d’un callback', async () => {
    const pair: OAuthTokenPair = { token: 'req-token-1', tokenSecret: 'req-secret-1' };
    await storeRequestToken(pair);

    await expect(consumeRequestToken(pair.token)).resolves.toEqual(pair);
    // Un second callback avec le même token doit échouer.
    await expect(consumeRequestToken(pair.token)).resolves.toBeNull();
  });

  it('refuse un request token expiré', async () => {
    const pair: OAuthTokenPair = { token: 'req-token-2', tokenSecret: 'req-secret-2' };
    // Émis il y a 20 minutes, au-delà des 15 minutes de validité.
    await storeRequestToken(pair, new Date(Date.now() - 20 * 60_000));

    await expect(consumeRequestToken(pair.token)).resolves.toBeNull();
  });

  it('refuse un request token inconnu', async () => {
    await expect(consumeRequestToken('jamais-emis')).resolves.toBeNull();
  });
});
