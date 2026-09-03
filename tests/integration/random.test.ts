/**
 * Critère de sortie du Lot 4 (SPECIFICATION.md §24) :
 * « les tests prouvent l'absence de répétition et de pondération par exemplaires ».
 */
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '@/db/client';
import { collectionInstances, discogsReleases, randomSessions, users } from '@/db/schema';
import { upsertUserFromDiscogs } from '@/modules/auth/service';
import { upsertReleaseSummary } from '@/modules/catalog/service';
import {
  countEligible,
  createSession,
  draw,
  getActiveSession,
  getSession,
  listDrawn,
} from '@/modules/random/service';

const ALICE = { id: 994_000_001, username: 'alice_random' };
const BOB = { id: 994_000_002, username: 'bob_random' };
const TOKENS = { token: 'jeton', tokenSecret: 'secret' };
const TEST_USER_IDS = [String(ALICE.id), String(BOB.id)];

/** Préfixe non numérique : aucune collision possible avec un identifiant Discogs réel. */
const R = (n: number) => `test-9940${String(n).padStart(3, '0')}`;

type Seed = { n: number; genres: string[]; styles: string[]; copies?: number };

const CATALOG: Seed[] = [
  // Le premier album est possédé en trois exemplaires : s'il pesait proportionnellement,
  // il sortirait bien plus souvent que les autres.
  { n: 1, genres: ['Rock'], styles: ['Post Rock'], copies: 3 },
  { n: 2, genres: ['Rock'], styles: ['Chanson'] },
  { n: 3, genres: ['Electronic'], styles: ['Ambient'] },
  { n: 4, genres: ['Electronic', 'Rock'], styles: ['Ambient', 'Post Rock'] },
  { n: 5, genres: ['Jazz'], styles: [] },
];

let aliceId: string;
let bobId: string;

async function cleanup() {
  await db.delete(users).where(inArray(users.discogsUserId, TEST_USER_IDS));
  await db.delete(discogsReleases).where(
    inArray(
      discogsReleases.discogsReleaseId,
      CATALOG.map((seed) => R(seed.n)),
    ),
  );
}

beforeEach(async () => {
  await cleanup();

  aliceId = (await upsertUserFromDiscogs(ALICE, TOKENS)).id;
  bobId = (await upsertUserFromDiscogs(BOB, TOKENS)).id;

  let instanceId = 1;

  for (const seed of CATALOG) {
    const releaseId = await upsertReleaseSummary({
      discogsReleaseId: R(seed.n),
      title: `Album ${seed.n}`,
      genres: seed.genres,
      styles: seed.styles,
      artists: [{ id: seed.n, name: `Artiste ${seed.n}` }],
    });

    for (let copy = 0; copy < (seed.copies ?? 1); copy += 1) {
      await db.insert(collectionInstances).values({
        userId: aliceId,
        releaseId,
        discogsInstanceId: `9940${instanceId++}`,
        isActive: true,
      });
    }
  }
});

afterAll(async () => {
  await cleanup();
  await sql.end();
});

/** Vide une session en tirant jusqu'à épuisement, et retourne l'ordre obtenu. */
async function drawAll(userId: string, sessionId: string, max = 50): Promise<string[]> {
  const drawn: string[] = [];

  for (let index = 0; index < max; index += 1) {
    const result = await draw(userId, sessionId);
    if (result.status === 'exhausted') {
      break;
    }
    drawn.push(result.discogsReleaseId);
  }

  return drawn;
}

describe('éligibilité (RAND-001, RAND-002)', () => {
  it('compte les éditions uniques, pas les exemplaires', async () => {
    // Alice possède 7 exemplaires pour 5 éditions.
    const instances = await db
      .select()
      .from(collectionInstances)
      .where(eq(collectionInstances.userId, aliceId));

    expect(instances).toHaveLength(7);
    expect(await countEligible(aliceId, {})).toBe(5);
  });

  it('ignore les exemplaires devenus inactifs', async () => {
    await db
      .update(collectionInstances)
      .set({ isActive: false })
      .where(eq(collectionInstances.userId, aliceId));

    expect(await countEligible(aliceId, {})).toBe(0);
  });

  it('ne voit pas la collection d’un autre compte (§18.5)', async () => {
    expect(await countEligible(bobId, {})).toBe(0);
  });
});

describe('filtres Genre et Style (RAND-004, RAND-005)', () => {
  it('combine plusieurs valeurs d’un même type par OU', async () => {
    expect(await countEligible(aliceId, { genres: ['Rock'] })).toBe(3);
    expect(await countEligible(aliceId, { genres: ['Rock', 'Jazz'] })).toBe(4);
  });

  it('combine Genre et Style par ET', async () => {
    expect(await countEligible(aliceId, { genres: ['Rock'], styles: ['Ambient'] })).toBe(1);
    expect(await countEligible(aliceId, { genres: ['Jazz'], styles: ['Ambient'] })).toBe(0);
  });

  it('sans filtre, toute la collection est éligible', async () => {
    expect(await countEligible(aliceId, { genres: [], styles: [] })).toBe(5);
  });
});

describe('absence de répétition (RAND-003, RAND-007)', () => {
  it('ne rend jamais deux fois le même album avant épuisement', async () => {
    const session = await createSession(aliceId, aliceId, {});
    const drawn = await drawAll(aliceId, session.id);

    expect(drawn).toHaveLength(5);
    expect(new Set(drawn).size).toBe(5);
  });

  it('s’arrête à l’épuisement plutôt que de reboucler', async () => {
    const session = await createSession(aliceId, aliceId, {});
    await drawAll(aliceId, session.id);

    expect(await draw(aliceId, session.id)).toEqual({ status: 'exhausted' });

    // La session est close : l'interface doit proposer d'en ouvrir une nouvelle.
    const closed = await getSession(aliceId, session.id);
    expect(closed?.completedAt).not.toBeNull();
    expect(await getActiveSession(aliceId)).toBeNull();
  });

  it('recommencer ouvre une session vierge', async () => {
    const first = await createSession(aliceId, aliceId, {});
    await drawAll(aliceId, first.id);

    const second = await createSession(aliceId, aliceId, {});
    expect(second.id).not.toBe(first.id);

    const drawn = await drawAll(aliceId, second.id);
    expect(drawn).toHaveLength(5);
  });

  it('ne tire que dans le périmètre des filtres de la session', async () => {
    const session = await createSession(aliceId, aliceId, { genres: ['Electronic'] });
    const drawn = await drawAll(aliceId, session.id);

    expect(drawn.sort()).toEqual([R(3), R(4)].sort());
  });

  it('mémorise la progression entre deux appels', async () => {
    const session = await createSession(aliceId, aliceId, {});

    await draw(aliceId, session.id);
    await draw(aliceId, session.id);

    const reloaded = await getSession(aliceId, session.id);
    expect(reloaded?.drawnCount).toBe(2);
    expect(reloaded?.eligibleCount).toBe(5);

    const history = await listDrawn(aliceId, session.id);
    expect(history).toHaveLength(2);
    expect(history[0]?.drawOrder).toBe(2);
  });
});

describe('absence de pondération par exemplaires (RAND-002)', () => {
  it('un album possédé en trois exemplaires ne sort qu’une fois par session', async () => {
    const session = await createSession(aliceId, aliceId, {});
    const drawn = await drawAll(aliceId, session.id);

    expect(drawn.filter((id) => id === R(1))).toHaveLength(1);
  });

  it('n’apparaît pas plus souvent que les autres sur de nombreuses sessions', async () => {
    // Chaque session est vidée d'un seul tirage : la position du triple exemplaire en
    // première place mesure directement sa probabilité.
    const firstDraws: string[] = [];

    for (let round = 0; round < 60; round += 1) {
      const session = await createSession(aliceId, aliceId, {});
      const result = await draw(aliceId, session.id);
      if (result.status === 'drawn') {
        firstDraws.push(result.discogsReleaseId);
      }
    }

    const triple = firstDraws.filter((id) => id === R(1)).length;

    // Sans pondération, l'espérance est 60 / 5 = 12 tirages. Avec une pondération par
    // exemplaires, elle serait de 60 × 3 / 7 ≈ 26. La borne haute écarte ce cas sans
    // rendre le test instable.
    expect(triple).toBeLessThan(22);
    expect(triple).toBeGreaterThan(2);
  });
});

describe('gestion des sessions', () => {
  it('n’autorise qu’une seule session active par utilisateur (G-08)', async () => {
    const first = await createSession(aliceId, aliceId, {});
    const second = await createSession(aliceId, aliceId, { genres: ['Rock'] });

    expect(second.id).not.toBe(first.id);

    const active = await db.select().from(randomSessions).where(eq(randomSessions.userId, aliceId));

    expect(active.filter((row) => row.completedAt === null)).toHaveLength(1);
    expect((await getActiveSession(aliceId))?.id).toBe(second.id);
  });

  it('refuse de tirer dans la session d’un autre utilisateur (§18.5)', async () => {
    const session = await createSession(aliceId, aliceId, {});

    expect(await draw(bobId, session.id)).toEqual({ status: 'exhausted' });
    expect(await getSession(bobId, session.id)).toBeNull();
    expect(await listDrawn(bobId, session.id)).toEqual([]);
  });

  it('une session sans album éligible s’épuise immédiatement', async () => {
    const session = await createSession(aliceId, aliceId, { genres: ['Genre Inexistant'] });

    expect(session.eligibleCount).toBe(0);
    expect(await draw(aliceId, session.id)).toEqual({ status: 'exhausted' });
  });
});
