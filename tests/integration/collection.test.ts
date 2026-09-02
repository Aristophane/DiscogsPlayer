/**
 * Parcours de collection (SPECIFICATION.md §8.3, §17.3).
 *
 * Les jeux de données sont construits ici pour couvrir les cas que la spécification
 * nomme explicitement : accents, doublons physiques, filtres combinés, pagination stable.
 */
import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db, sql } from '@/db/client';
import { collectionInstances, discogsReleases, users } from '@/db/schema';
import { upsertUserFromDiscogs } from '@/modules/auth/service';
import { upsertReleaseSummary } from '@/modules/catalog/service';
import { countCollection, listCollection, listFacets } from '@/modules/collection/service';

const ALICE = { id: 992_000_001, username: 'alice_coll' };
const BOB = { id: 992_000_002, username: 'bob_coll' };
const TOKENS = { token: 'jeton', tokenSecret: 'secret' };
const TEST_USER_IDS = [String(ALICE.id), String(BOB.id)];

/**
 * Espace de noms des éditions de test.
 *
 * Un identifiant purement numérique entrerait en collision avec un vrai identifiant
 * Discogs : le nettoyage `like '9920%'` a effectivement supprimé une édition réelle de
 * la base de développement. Le préfixe `test-` rend la collision impossible.
 */
const R = (n: number) => `test-9920${String(n).padStart(3, '0')}`;

type Seed = {
  n: number;
  title: string;
  artist: string;
  year: number | null;
  genres: string[];
  styles: string[];
  copies?: number;
  daysAgo: number;
};

const CATALOG: Seed[] = [
  {
    n: 1,
    title: 'De L’Autre Côté',
    artist: 'Véronique Sanson',
    year: 1972,
    genres: ['Rock'],
    styles: ['Chanson'],
    daysAgo: 1,
  },
  {
    n: 2,
    title: 'Homogenic',
    artist: 'Björk',
    year: 1997,
    genres: ['Electronic'],
    styles: ['Trip Hop', 'Ambient'],
    // Deux exemplaires physiques du même disque (COLL-005).
    copies: 2,
    daysAgo: 2,
  },
  {
    n: 3,
    title: 'Ágætis Byrjun',
    artist: 'Sigur Rós',
    year: 1999,
    genres: ['Rock', 'Electronic'],
    styles: ['Post Rock'],
    daysAgo: 3,
  },
  {
    n: 4,
    title: 'Sans Année',
    artist: 'Inconnu',
    year: null,
    genres: ['Folk, World, & Country'],
    styles: [],
    daysAgo: 4,
  },
];

let aliceId: string;
let bobId: string;

async function cleanup() {
  await db.delete(users).where(inArray(users.discogsUserId, TEST_USER_IDS));
  await db.delete(discogsReleases).where(like(discogsReleases.discogsReleaseId, 'test-9920%'));
}

beforeAll(async () => {
  await cleanup();

  aliceId = (await upsertUserFromDiscogs(ALICE, TOKENS)).id;
  bobId = (await upsertUserFromDiscogs(BOB, TOKENS)).id;

  let instanceId = 1;

  for (const seed of CATALOG) {
    const releaseId = await upsertReleaseSummary({
      discogsReleaseId: R(seed.n),
      title: seed.title,
      year: seed.year,
      genres: seed.genres,
      styles: seed.styles,
      artists: [{ id: seed.n, name: seed.artist }],
      primaryImageUrl: `https://i.discogs.com/test/${seed.n}.jpg`,
    });

    for (let copy = 0; copy < (seed.copies ?? 1); copy += 1) {
      await db.insert(collectionInstances).values({
        userId: aliceId,
        releaseId,
        discogsInstanceId: `9920${instanceId++}`,
        isActive: true,
        dateAdded: new Date(Date.now() - seed.daysAgo * 86_400_000),
      });
    }
  }

  // Bob ne possède qu'un seul de ces albums : sert à prouver l'isolation.
  const shared = await upsertReleaseSummary({
    discogsReleaseId: R(1),
    title: CATALOG[0]!.title,
    artists: [{ id: 1, name: CATALOG[0]!.artist }],
  });
  await db.insert(collectionInstances).values({
    userId: bobId,
    releaseId: shared,
    discogsInstanceId: '99209999',
    isActive: true,
    dateAdded: new Date(),
  });
});

afterAll(async () => {
  await cleanup();
  await sql.end();
});

describe('éditions logiques et exemplaires (COLL-005, COLL-006, §17.3)', () => {
  it('rend une tuile par édition, avec le nombre d’exemplaires', async () => {
    const { items } = await listCollection(aliceId);

    expect(items).toHaveLength(4);

    const homogenic = items.find((item) => item.discogsReleaseId === R(2));
    expect(homogenic?.instanceCount).toBe(2);
    expect(items.filter((item) => item.discogsReleaseId === R(2))).toHaveLength(1);
  });

  it('compte les éditions, pas les exemplaires', async () => {
    // Alice possède 5 exemplaires pour 4 éditions.
    expect(await countCollection(aliceId)).toBe(4);
  });
});

describe('recherche (COLL-002, COLL-003)', () => {
  it('ignore les accents dans les deux sens', async () => {
    const sansAccent = await listCollection(aliceId, { query: 'bjork' });
    const avecAccent = await listCollection(aliceId, { query: 'Björk' });

    expect(sansAccent.items.map((item) => item.title)).toEqual(['Homogenic']);
    expect(avecAccent.items.map((item) => item.title)).toEqual(['Homogenic']);
  });

  it('ignore la casse', async () => {
    const result = await listCollection(aliceId, { query: 'SIGUR ros' });

    expect(result.items.map((item) => item.title)).toEqual(['Ágætis Byrjun']);
  });

  it('cherche aussi dans le titre, pas seulement l’artiste', async () => {
    const result = await listCollection(aliceId, { query: 'agaetis' });

    expect(result.items).toHaveLength(1);
  });

  it('ne renvoie rien plutôt que tout quand la recherche échoue', async () => {
    const result = await listCollection(aliceId, { query: 'zzzz introuvable' });

    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });
});

describe('filtres Genre et Style (RAND-004, RAND-005)', () => {
  it('combine plusieurs valeurs d’un même type par OU', async () => {
    const result = await listCollection(aliceId, { genres: ['Rock', 'Electronic'] });

    // Véronique Sanson (Rock), Björk (Electronic), Sigur Rós (les deux).
    expect(result.items).toHaveLength(3);
  });

  it('combine Genre et Style par ET', async () => {
    const both = await listCollection(aliceId, { genres: ['Rock'], styles: ['Post Rock'] });
    expect(both.items.map((item) => item.title)).toEqual(['Ágætis Byrjun']);

    // Le style existe, mais pas sur une édition de ce genre : intersection vide.
    const none = await listCollection(aliceId, { genres: ['Electronic'], styles: ['Chanson'] });
    expect(none.items).toEqual([]);
  });

  it('combine recherche et filtres', async () => {
    const result = await listCollection(aliceId, { query: 'sigur', genres: ['Electronic'] });

    expect(result.items).toHaveLength(1);
  });
});

describe('facettes', () => {
  it('ne propose que des valeurs présentes dans la collection, avec leur compte', async () => {
    const { genres, styles } = await listFacets(aliceId);

    expect(genres.find((facet) => facet.value === 'Rock')?.count).toBe(2);
    expect(genres.find((facet) => facet.value === 'Electronic')?.count).toBe(2);
    expect(genres.some((facet) => facet.value === 'Hip Hop')).toBe(false);

    // Un doublon physique ne double pas le compte de la facette.
    expect(styles.find((facet) => facet.value === 'Ambient')?.count).toBe(1);
  });

  it('est propre à chaque utilisateur (§18.5)', async () => {
    const bob = await listFacets(bobId);

    expect(bob.genres.every((facet) => facet.count <= 1)).toBe(true);
  });
});

describe('pagination par curseur (§17.3, G-15)', () => {
  it('parcourt toute la collection sans doublon ni oubli', async () => {
    const seen: string[] = [];
    let cursor: string | null | undefined;

    for (let page = 0; page < 10; page += 1) {
      const result = await listCollection(aliceId, { limit: 1, cursor: cursor ?? undefined });
      seen.push(...result.items.map((item) => item.discogsReleaseId));
      cursor = result.nextCursor;
      if (!cursor) {
        break;
      }
    }

    expect(seen).toHaveLength(4);
    expect(new Set(seen).size).toBe(4);
  });

  it('ne renvoie pas de curseur sur la dernière page', async () => {
    const result = await listCollection(aliceId, { limit: 100 });

    expect(result.nextCursor).toBeNull();
  });

  it('reste stable sur un tri où des valeurs sont absentes', async () => {
    // « Sans Année » n'a pas d'année : elle doit apparaître une fois, en fin d'ordre.
    const seen: string[] = [];
    let cursor: string | null | undefined;

    for (let page = 0; page < 10; page += 1) {
      const result = await listCollection(aliceId, {
        sort: 'year_desc',
        limit: 1,
        cursor: cursor ?? undefined,
      });
      seen.push(...result.items.map((item) => item.discogsReleaseId));
      cursor = result.nextCursor;
      if (!cursor) {
        break;
      }
    }

    expect(seen).toHaveLength(4);
    expect(new Set(seen).size).toBe(4);
    expect(seen[seen.length - 1]).toBe(R(4));
  });

  it('trie par titre dans l’ordre alphabétique', async () => {
    const result = await listCollection(aliceId, { sort: 'title_asc' });

    expect(result.items[0]?.title).toBe('Ágætis Byrjun');
  });

  it('trie par ajout récent par défaut', async () => {
    const result = await listCollection(aliceId);

    expect(result.items[0]?.discogsReleaseId).toBe(R(1));
  });
});

describe('préservation des métadonnées (§12.1)', () => {
  it('un upsert sans année n’efface pas une année déjà connue', async () => {
    // Le résumé d'une page de collection est plus pauvre qu'une fiche détaillée :
    // le laisser écraser ferait régresser le catalogue, et fausserait le tri par année.
    await upsertReleaseSummary({
      discogsReleaseId: R(1),
      title: CATALOG[0]!.title,
      artists: [{ id: 1, name: CATALOG[0]!.artist }],
    });

    const rows = await db
      .select({ year: discogsReleases.year })
      .from(discogsReleases)
      .where(eq(discogsReleases.discogsReleaseId, R(1)));

    expect(rows[0]?.year).toBe(1972);
  });
});

describe('isolation multi-utilisateur (§18.5)', () => {
  it('ne montre jamais la collection d’un autre compte', async () => {
    const alice = await listCollection(aliceId);
    const bob = await listCollection(bobId);

    expect(alice.items).toHaveLength(4);
    expect(bob.items).toHaveLength(1);
    expect(await countCollection(bobId)).toBe(1);
  });

  it('exclut les instances devenues inactives', async () => {
    await db
      .update(collectionInstances)
      .set({ isActive: false })
      .where(eq(collectionInstances.userId, bobId));

    expect(await countCollection(bobId)).toBe(0);

    await db
      .update(collectionInstances)
      .set({ isActive: true })
      .where(eq(collectionInstances.userId, bobId));
  });
});
