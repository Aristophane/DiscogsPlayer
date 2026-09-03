/**
 * Résolution de la collection active (Lot 7, partage, demande produit 2026-09-03).
 *
 * `resolveActiveCollection` porte la garantie de sécurité qui compte ici : une
 * révocation doit prendre effet à la requête suivante, jamais seulement à la
 * reconnexion (§18.5). Testée directement plutôt que via `getCurrentUser()`, qui a
 * besoin d'un vrai cookie `next/headers` — indisponible hors d'une requête Next.js.
 */
import { inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '@/db/client';
import { users } from '@/db/schema';
import { resolveActiveCollection } from '@/modules/auth/current-user';
import type { SessionUser } from '@/modules/auth/sessions';
import { upsertUserFromDiscogs } from '@/modules/auth/service';
import { consumeInvite, createInvite, revokeGrant } from '@/modules/sharing/service';

const ALICE = { id: 993_000_001, username: 'alice_cu' };
const BOB = { id: 993_000_002, username: 'bob_cu' };
const TOKENS = { token: 'jeton', tokenSecret: 'secret' };
const TEST_IDS = [ALICE, BOB].map((identity) => String(identity.id));

async function cleanup() {
  await db.delete(users).where(inArray(users.discogsUserId, TEST_IDS));
}

/** `SessionUser` minimal, comme le renverrait `resolveSession` pour Bob. */
function bobSession(viewingAsUserId: string | null, bobId: string): SessionUser {
  return {
    id: bobId,
    discogsUserId: BOB.id.toString(),
    discogsUsername: BOB.username,
    displayName: null,
    avatarUrl: null,
    role: 'user',
    contributionStatus: 'active',
    locale: 'fr',
    spotifyEnabled: 'unset',
    viewingAsUserId,
  };
}

let aliceId: string;
let bobId: string;

beforeEach(async () => {
  await cleanup();
  aliceId = (await upsertUserFromDiscogs(ALICE, TOKENS)).id;
  bobId = (await upsertUserFromDiscogs(BOB, TOKENS)).id;
});

afterAll(async () => {
  await cleanup();
  await sql.end();
});

describe('résolution de la collection active', () => {
  it('sans bascule enregistrée, résout sur sa propre collection', async () => {
    const active = await resolveActiveCollection(bobSession(null, bobId));

    expect(active).toEqual({ activeCollectionOwnerId: bobId, activeCollectionOwner: null });
  });

  it('avec un partage actif, résout sur la collection de l’ami', async () => {
    const invite = await createInvite(aliceId);
    await consumeInvite(invite.token, bobId);

    const active = await resolveActiveCollection(bobSession(aliceId, bobId));

    expect(active).toEqual({
      activeCollectionOwnerId: aliceId,
      activeCollectionOwner: { id: aliceId, username: 'alice_cu' },
    });
  });

  it('un partage révoqué retombe immédiatement sur sa propre collection', async () => {
    const invite = await createInvite(aliceId);
    await consumeInvite(invite.token, bobId);
    await revokeGrant(aliceId, bobId);

    // C'est exactement le scénario du § de tête du fichier : la session de Bob porte
    // toujours `viewingAsUserId = aliceId` (rien ne l'a réécrite), mais le partage
    // sous-jacent n'existe plus — la garantie tient sur cette revérification, pas sur
    // un signal explicite de déconnexion.
    const active = await resolveActiveCollection(bobSession(aliceId, bobId));

    expect(active).toEqual({ activeCollectionOwnerId: bobId, activeCollectionOwner: null });
  });

  it('une bascule vers un partage jamais accordé est refusée (pas de confiance dans la session seule)', async () => {
    // Bob n'a jamais reçu d'invitation d'Alice : même si sa session portait cette
    // valeur (erreur de bascule, ou tentative directe), la revérification l'annule.
    const active = await resolveActiveCollection(bobSession(aliceId, bobId));

    expect(active).toEqual({ activeCollectionOwnerId: bobId, activeCollectionOwner: null });
  });

  it('un propriétaire supprimé retombe silencieusement, sans faire échouer la requête', async () => {
    const invite = await createInvite(aliceId);
    await consumeInvite(invite.token, bobId);
    await db.delete(users).where(inArray(users.discogsUserId, [String(ALICE.id)]));

    const active = await resolveActiveCollection(bobSession(aliceId, bobId));

    expect(active).toEqual({ activeCollectionOwnerId: bobId, activeCollectionOwner: null });

    // Alice recréée pour que le nettoyage global du fichier reste valide.
    aliceId = (await upsertUserFromDiscogs(ALICE, TOKENS)).id;
  });
});
