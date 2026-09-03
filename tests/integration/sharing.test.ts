/**
 * Partage de collection (Lot 7, demande produit 2026-09-03).
 *
 * Aucun appel réseau réel : ces tests parlent uniquement à PostgreSQL local (§22.3).
 */
import { createHash } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '@/db/client';
import { collectionInvites, collectionShares, users } from '@/db/schema';
import { upsertUserFromDiscogs } from '@/modules/auth/service';
import {
  consumeInvite,
  createInvite,
  hasActiveGrant,
  listGrantsGivenBy,
  listGrantsReceivedBy,
  previewInvite,
  purgeExpiredInvites,
  revokeGrant,
} from '@/modules/sharing/service';

const ALICE = { id: 992_000_001, username: 'alice_sharing' };
const BOB = { id: 992_000_002, username: 'bob_sharing' };
const CAROL = { id: 992_000_003, username: 'carol_sharing' };
const TOKENS = { token: 'jeton', tokenSecret: 'secret' };
const TEST_IDS = [ALICE, BOB, CAROL].map((identity) => String(identity.id));

async function cleanup() {
  await db.delete(users).where(inArray(users.discogsUserId, TEST_IDS));
}

let aliceId: string;
let bobId: string;
let carolId: string;

beforeEach(async () => {
  await cleanup();
  aliceId = (await upsertUserFromDiscogs(ALICE, TOKENS)).id;
  bobId = (await upsertUserFromDiscogs(BOB, TOKENS)).id;
  carolId = (await upsertUserFromDiscogs(CAROL, TOKENS)).id;
});

afterAll(async () => {
  await cleanup();
  await sql.end();
});

describe('invitation et partage', () => {
  it('un lien consommé crée un partage actif', async () => {
    const invite = await createInvite(aliceId);

    expect(await hasActiveGrant(aliceId, bobId)).toBe(false);

    const consumed = await consumeInvite(invite.token, bobId);

    expect(consumed).toEqual({ ownerId: aliceId, ownerUsername: 'alice_sharing' });
    expect(await hasActiveGrant(aliceId, bobId)).toBe(true);
    // Carol n'a rien demandé : aucun effet de bord sur elle.
    expect(await hasActiveGrant(aliceId, carolId)).toBe(false);
  });

  it('un lien ne se consomme qu’une fois', async () => {
    const invite = await createInvite(aliceId);

    expect(await consumeInvite(invite.token, bobId)).not.toBeNull();
    expect(await consumeInvite(invite.token, carolId)).toBeNull();

    // Le rejeu n'a créé aucun partage pour Carol.
    expect(await hasActiveGrant(aliceId, carolId)).toBe(false);
  });

  it('refuse un lien expiré', async () => {
    const invite = await createInvite(aliceId);
    // Expiration forcée, comme le ferait le vrai passage du temps.
    await db
      .update(collectionInvites)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(collectionInvites.ownerId, aliceId));

    expect(await consumeInvite(invite.token, bobId)).toBeNull();
    expect(await hasActiveGrant(aliceId, bobId)).toBe(false);
  });

  it('ignore un lien consommé par son propre propriétaire', async () => {
    const invite = await createInvite(aliceId);

    expect(await consumeInvite(invite.token, aliceId)).toBeNull();
    // Le jeton est bien marqué consommé (usage unique respecté) : personne d'autre ne
    // peut plus l'utiliser après coup, même si aucun partage n'en est sorti.
    expect(await consumeInvite(invite.token, bobId)).toBeNull();
  });

  it('un jeton inconnu est refusé sans planter', async () => {
    expect(await consumeInvite('jeton-jamais-emis', bobId)).toBeNull();
  });
});

describe('aperçu d’une invitation (page /invitations/[token])', () => {
  it('révèle le propriétaire sans consommer le jeton', async () => {
    const invite = await createInvite(aliceId);

    expect(await previewInvite(invite.token)).toEqual({
      ownerUsername: 'alice_sharing',
      valid: true,
    });
    // Toujours consommable après un simple aperçu : ce n'est pas ça qui brûle le jeton.
    expect(await consumeInvite(invite.token, bobId)).not.toBeNull();
  });

  it('signale un jeton déjà consommé comme invalide, sans planter', async () => {
    const invite = await createInvite(aliceId);
    await consumeInvite(invite.token, bobId);

    expect(await previewInvite(invite.token)).toEqual({
      ownerUsername: 'alice_sharing',
      valid: false,
    });
  });

  it('signale un jeton expiré comme invalide', async () => {
    const invite = await createInvite(aliceId);
    await db
      .update(collectionInvites)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(collectionInvites.ownerId, aliceId));

    expect(await previewInvite(invite.token)).toEqual({
      ownerUsername: 'alice_sharing',
      valid: false,
    });
  });

  it('renvoie null pour un jeton inconnu', async () => {
    expect(await previewInvite('jeton-jamais-emis')).toBeNull();
  });
});

describe('révocation', () => {
  it('prend effet immédiatement', async () => {
    const invite = await createInvite(aliceId);
    await consumeInvite(invite.token, bobId);
    expect(await hasActiveGrant(aliceId, bobId)).toBe(true);

    await revokeGrant(aliceId, bobId);

    expect(await hasActiveGrant(aliceId, bobId)).toBe(false);
  });

  it('une nouvelle invitation après révocation recrée un partage actif', async () => {
    const first = await createInvite(aliceId);
    await consumeInvite(first.token, bobId);
    await revokeGrant(aliceId, bobId);

    const second = await createInvite(aliceId);
    const consumed = await consumeInvite(second.token, bobId);

    expect(consumed).not.toBeNull();
    expect(await hasActiveGrant(aliceId, bobId)).toBe(true);

    // Exactement un partage vivant pour cette paire, jamais deux (index unique partiel).
    const rows = await db
      .select()
      .from(collectionShares)
      .where(eq(collectionShares.granteeId, bobId));
    expect(rows.filter((row) => row.revokedAt === null)).toHaveLength(1);
  });

  it('seul le propriétaire peut révoquer, pas le bénéficiaire lui-même', async () => {
    const invite = await createInvite(aliceId);
    await consumeInvite(invite.token, bobId);

    // Bob tente de révoquer « son » accès en s'appelant lui-même propriétaire : la
    // requête, qualifiée par ownerId, ne trouve aucune ligne à cette adresse et n'a
    // aucun effet sur le vrai partage d'Alice.
    await revokeGrant(bobId, bobId);

    expect(await hasActiveGrant(aliceId, bobId)).toBe(true);
  });
});

describe('listes de gestion', () => {
  it('liste ce qui m’a été partagé, isolé par bénéficiaire', async () => {
    const inviteToBob = await createInvite(aliceId);
    await consumeInvite(inviteToBob.token, bobId);
    const inviteToCarol = await createInvite(aliceId);
    await consumeInvite(inviteToCarol.token, carolId);

    const bobsGrants = await listGrantsReceivedBy(bobId);
    expect(bobsGrants).toHaveLength(1);
    expect(bobsGrants[0]).toMatchObject({ ownerId: aliceId, ownerUsername: 'alice_sharing' });

    const carolsGrants = await listGrantsReceivedBy(carolId);
    expect(carolsGrants).toHaveLength(1);
  });

  it('liste ce que j’ai partagé, sans exposer un partage révoqué', async () => {
    const inviteToBob = await createInvite(aliceId);
    await consumeInvite(inviteToBob.token, bobId);
    const inviteToCarol = await createInvite(aliceId);
    await consumeInvite(inviteToCarol.token, carolId);
    await revokeGrant(aliceId, carolId);

    const given = await listGrantsGivenBy(aliceId);
    expect(given).toHaveLength(1);
    expect(given[0]).toMatchObject({ granteeId: bobId, granteeUsername: 'bob_sharing' });
  });
});

describe('purge des invitations expirées', () => {
  it('supprime seulement celles qui ont expiré', async () => {
    const fresh = await createInvite(aliceId);
    const stale = await createInvite(aliceId);
    const staleTokenHash = createHash('sha256').update(stale.token, 'utf8').digest('hex');
    await db
      .update(collectionInvites)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(collectionInvites.tokenHash, staleTokenHash));

    await purgeExpiredInvites();

    expect(await consumeInvite(fresh.token, bobId)).not.toBeNull();
    // L'invitation expirée n'existe plus du tout, pas seulement refusée.
    const remaining = await db
      .select()
      .from(collectionInvites)
      .where(eq(collectionInvites.ownerId, aliceId));
    expect(remaining).toHaveLength(1);
  });
});
