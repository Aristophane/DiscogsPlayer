/**
 * Critère de sortie du Lot 2 (SPECIFICATION.md §24) :
 * « une collection paginée avec doublons est importée, reprise après erreur et
 * synchronisée sans suppression prématurée ».
 *
 * L'adaptateur Discogs est remplacé par un double contrôlable : aucun appel réseau réel
 * (§22.3), et seule la frontière externe change — la logique métier est celle de prod.
 */
import { and, eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '@/db/client';
import {
  collectionInstances,
  discogsReleases,
  discogsTracks,
  syncRuns,
  tasks,
  users,
} from '@/db/schema';
import { upsertUserFromDiscogs } from '@/modules/auth/service';
import { applyReleaseDetails } from '@/modules/catalog/service';
import {
  DiscogsApiError,
  type CollectionPage,
  type DiscogsApi,
  type ReleaseDetails,
} from '@/modules/sync/discogs-api';
import { TASK_FETCH_RELEASE, runCollectionSync, startSync } from '@/modules/sync/service';

const ALICE = { id: 991_000_001, username: 'alice_sync' };
const BOB = { id: 991_000_002, username: 'bob_sync' };
const TOKENS = { token: 'jeton', tokenSecret: 'secret' };
const TEST_USER_IDS = [String(ALICE.id), String(BOB.id)];

/** Identifiants d'édition réservés aux tests, faciles à nettoyer. */
const R = (n: number) => `9910${String(n).padStart(3, '0')}`;

function release(
  id: string,
  title: string,
): CollectionPage['releases'][number]['basic_information'] {
  return {
    id: Number(id),
    title,
    year: 1999,
    genres: ['Electronic'],
    styles: ['Ambient'],
    artists: [{ id: 1, name: 'Artiste Test' }],
    cover_image: `https://i.discogs.test/${id}.jpg`,
  };
}

function page(
  pageNumber: number,
  pages: number,
  items: { releaseId: string; instanceId: number; title?: string }[],
): CollectionPage {
  return {
    pagination: { page: pageNumber, pages, items: items.length, per_page: 100 },
    releases: items.map((item) => ({
      id: Number(item.releaseId),
      instance_id: item.instanceId,
      folder_id: 1,
      rating: 0,
      date_added: '2026-01-01T00:00:00-08:00',
      basic_information: release(item.releaseId, item.title ?? `Album ${item.releaseId}`),
    })),
  };
}

/** Double de l'API Discogs : pages scriptées, erreurs injectables, appels tracés. */
class FakeDiscogsApi implements DiscogsApi {
  readonly calls: string[] = [];
  failOnPage: number | null = null;

  constructor(private readonly pages: CollectionPage[]) {}

  async getCollectionPage(_tokens: unknown, _username: string, pageNumber: number) {
    this.calls.push(`page:${pageNumber}`);

    if (this.failOnPage === pageNumber) {
      // Exactement le cas de §12.3 : une page en erreur, surtout pas une page vide.
      throw new DiscogsApiError({
        code: 'DISCOGS_RATE_LIMITED',
        message: 'limité',
        status: 429,
        retryable: true,
        retryAfterMs: 1_000,
      });
    }

    const found = this.pages[pageNumber - 1];
    if (!found) {
      throw new Error(`page ${pageNumber} non scriptée`);
    }
    return found;
  }

  async getRelease(discogsReleaseId: string): Promise<ReleaseDetails> {
    this.calls.push(`release:${discogsReleaseId}`);

    return {
      id: Number(discogsReleaseId),
      title: `Album ${discogsReleaseId}`,
      year: 1999,
      country: 'France',
      genres: ['Electronic'],
      styles: ['Ambient'],
      images: [{ type: 'primary', uri: `https://i.discogs.test/${discogsReleaseId}.jpg` }],
      artists: [{ id: 1, name: 'Artiste Test' }],
      tracklist: [
        { title: 'Face A', type_: 'heading' },
        { position: 'A1', title: 'Première', duration: '3:20', type_: 'track' },
        { position: 'A2', title: 'Deuxième', duration: '4:05', type_: 'track' },
      ],
      videos: [
        { uri: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Clip', duration: 200 },
      ],
    };
  }
}

/**
 * Nettoyage strictement limité aux données de test.
 *
 * Ne jamais élargir à `type like 'discogs.%'` : la base de développement contient de
 * vraies tâches d'import, et un test n'a aucune raison de les détruire.
 */
async function cleanup() {
  const testUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.discogsUserId, TEST_USER_IDS));

  const syncKeys = testUsers.map((user) => `sync:${user.id}`);
  if (syncKeys.length > 0) {
    await db.delete(tasks).where(inArray(tasks.dedupeKey, syncKeys));
  }

  await db.delete(users).where(inArray(users.discogsUserId, TEST_USER_IDS));
  await db.delete(discogsReleases).where(like(discogsReleases.discogsReleaseId, '9910%'));
  await db.delete(tasks).where(like(tasks.dedupeKey, 'release:9910%'));
}

beforeEach(cleanup);

afterAll(async () => {
  await cleanup();
  await sql.end();
});

async function createUser(identity: { id: number; username: string }) {
  return upsertUserFromDiscogs(identity, TOKENS);
}

async function activeInstances(userId: string) {
  return db
    .select()
    .from(collectionInstances)
    .where(and(eq(collectionInstances.userId, userId), eq(collectionInstances.isActive, true)));
}

describe('import paginé avec doublons (§12.1, COLL-005)', () => {
  it('importe toutes les pages et conserve deux exemplaires comme deux instances', async () => {
    const user = await createUser(ALICE);
    const api = new FakeDiscogsApi([
      page(1, 2, [
        { releaseId: R(1), instanceId: 1 },
        // Deuxième exemplaire physique de la même édition.
        { releaseId: R(1), instanceId: 2 },
        { releaseId: R(2), instanceId: 3 },
      ]),
      page(2, 2, [{ releaseId: R(3), instanceId: 4 }]),
    ]);

    const { run } = await startSync(user.id, 'initial');
    const result = await runCollectionSync(run.id, api);

    expect(result.completed).toBe(true);
    expect(result.pagesProcessed).toBe(2);

    const instances = await activeInstances(user.id);
    expect(instances).toHaveLength(4);

    // Une seule édition en catalogue pour les deux exemplaires : le doublon physique ne
    // duplique pas le catalogue (et ne pondérera pas le tirage aléatoire, RAND-002).
    const releases = await db
      .select()
      .from(discogsReleases)
      .where(eq(discogsReleases.discogsReleaseId, R(1)));
    expect(releases).toHaveLength(1);
  });

  it('programme un chargement de détail par édition inconnue, sans doublon', async () => {
    const user = await createUser(ALICE);
    const api = new FakeDiscogsApi([
      page(1, 1, [
        { releaseId: R(1), instanceId: 1 },
        { releaseId: R(1), instanceId: 2 },
        { releaseId: R(2), instanceId: 3 },
      ]),
    ]);

    const { run } = await startSync(user.id, 'initial');
    await runCollectionSync(run.id, api);

    const detailTasks = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.type, TASK_FETCH_RELEASE), like(tasks.dedupeKey, 'release:9910%')));

    expect(detailTasks).toHaveLength(2);
  });
});

describe('déduplication globale entre utilisateurs (§12.2)', () => {
  it('ne programme pas deux fois le détail d’une édition partagée', async () => {
    const alice = await createUser(ALICE);
    const bob = await createUser(BOB);

    const aliceApi = new FakeDiscogsApi([page(1, 1, [{ releaseId: R(5), instanceId: 10 }])]);
    const bobApi = new FakeDiscogsApi([page(1, 1, [{ releaseId: R(5), instanceId: 20 }])]);

    const aliceRun = await startSync(alice.id, 'initial');
    await runCollectionSync(aliceRun.run.id, aliceApi);

    const bobRun = await startSync(bob.id, 'initial');
    await runCollectionSync(bobRun.run.id, bobApi);

    const detailTasks = await db
      .select()
      .from(tasks)
      .where(eq(tasks.dedupeKey, `release:${R(5)}`));

    // La même édition dans deux collections : un seul appel Discogs sera fait.
    expect(detailTasks).toHaveLength(1);

    // Mais chacun garde bien son exemplaire.
    expect(await activeInstances(alice.id)).toHaveLength(1);
    expect(await activeInstances(bob.id)).toHaveLength(1);
  });

  it('ne reprogramme pas une édition dont les détails sont déjà frais', async () => {
    const user = await createUser(ALICE);
    const api = new FakeDiscogsApi([page(1, 1, [{ releaseId: R(6), instanceId: 30 }])]);

    // Les détails ont déjà été chargés par ailleurs.
    await applyReleaseDetails(await api.getRelease(R(6)));

    const { run } = await startSync(user.id, 'initial');
    await runCollectionSync(run.id, api);

    const detailTasks = await db
      .select()
      .from(tasks)
      .where(eq(tasks.dedupeKey, `release:${R(6)}`));

    expect(detailTasks).toHaveLength(0);
  });
});

describe('tolérance aux pannes (§12.3, SYNC-007)', () => {
  it('ne désactive rien quand une page échoue, puis reprend où il s’est arrêté', async () => {
    const user = await createUser(ALICE);

    // Import initial complet : trois albums.
    const firstApi = new FakeDiscogsApi([
      page(1, 1, [
        { releaseId: R(1), instanceId: 1 },
        { releaseId: R(2), instanceId: 2 },
        { releaseId: R(3), instanceId: 3 },
      ]),
    ]);
    const first = await startSync(user.id, 'initial');
    await runCollectionSync(first.run.id, firstApi);
    expect(await activeInstances(user.id)).toHaveLength(3);

    // Nouvelle synchronisation : la page 2 échoue.
    const secondApi = new FakeDiscogsApi([
      page(1, 2, [{ releaseId: R(1), instanceId: 1 }]),
      page(2, 2, [{ releaseId: R(2), instanceId: 2 }]),
    ]);
    secondApi.failOnPage = 2;

    const second = await startSync(user.id, 'manual');
    await expect(runCollectionSync(second.run.id, secondApi)).rejects.toThrow(DiscogsApiError);

    // Le point capital : rien n'est désactivé. Interpréter l'échec comme une absence
    // aurait fait disparaître deux albums encore possédés.
    expect(await activeInstances(user.id)).toHaveLength(3);

    const runRows = await db.select().from(syncRuns).where(eq(syncRuns.id, second.run.id));
    expect(runRows[0]?.status).toBe('running');
    expect(runRows[0]?.pagesProcessed).toBe(1);

    // Reprise : la page 1 n'est pas redemandée, seule la page 2 l'est.
    secondApi.failOnPage = null;
    secondApi.calls.length = 0;

    const resumed = await runCollectionSync(second.run.id, secondApi);

    expect(resumed.completed).toBe(true);
    expect(secondApi.calls).toEqual(['page:2']);
  });

  it('désactive les albums absents seulement après un import complet réussi (SYNC-005)', async () => {
    const user = await createUser(ALICE);

    const firstApi = new FakeDiscogsApi([
      page(1, 1, [
        { releaseId: R(1), instanceId: 1 },
        { releaseId: R(2), instanceId: 2 },
      ]),
    ]);
    const first = await startSync(user.id, 'initial');
    await runCollectionSync(first.run.id, firstApi);
    expect(await activeInstances(user.id)).toHaveLength(2);

    // L'utilisateur a retiré un disque de sa collection Discogs.
    const secondApi = new FakeDiscogsApi([page(1, 1, [{ releaseId: R(1), instanceId: 1 }])]);
    const second = await startSync(user.id, 'manual');
    await runCollectionSync(second.run.id, secondApi);

    const remaining = await activeInstances(user.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.discogsInstanceId).toBe('1');

    // L'instance retirée est masquée, pas supprimée : l'historique reste exploitable (SYNC-006).
    const all = await db
      .select()
      .from(collectionInstances)
      .where(eq(collectionInstances.userId, user.id));
    expect(all).toHaveLength(2);
    expect(all.find((row) => row.discogsInstanceId === '2')?.removedAt).not.toBeNull();
  });

  it('réactive un album remis dans la collection', async () => {
    const user = await createUser(ALICE);

    const api1 = new FakeDiscogsApi([page(1, 1, [{ releaseId: R(1), instanceId: 1 }])]);
    await runCollectionSync((await startSync(user.id, 'initial')).run.id, api1);

    const api2 = new FakeDiscogsApi([page(1, 1, [])]);
    await runCollectionSync((await startSync(user.id, 'manual')).run.id, api2);
    expect(await activeInstances(user.id)).toHaveLength(0);

    const api3 = new FakeDiscogsApi([page(1, 1, [{ releaseId: R(1), instanceId: 1 }])]);
    await runCollectionSync((await startSync(user.id, 'manual')).run.id, api3);

    expect(await activeInstances(user.id)).toHaveLength(1);
  });
});

describe('concurrence des synchronisations (SYNC-004)', () => {
  it('ne crée jamais deux runs actifs pour le même compte', async () => {
    const user = await createUser(ALICE);

    const first = await startSync(user.id, 'initial');
    const second = await startSync(user.id, 'manual');

    expect(second.created).toBe(false);
    expect(second.run.id).toBe(first.run.id);

    const active = await db
      .select()
      .from(syncRuns)
      .where(and(eq(syncRuns.userId, user.id), inArray(syncRuns.status, ['queued', 'running'])));

    expect(active).toHaveLength(1);
  });

  it('isole les synchronisations de deux comptes (§18.5)', async () => {
    const alice = await createUser(ALICE);
    const bob = await createUser(BOB);

    const aliceRun = await startSync(alice.id, 'initial');
    const bobRun = await startSync(bob.id, 'initial');

    expect(aliceRun.created).toBe(true);
    expect(bobRun.created).toBe(true);
    expect(aliceRun.run.id).not.toBe(bobRun.run.id);
  });
});

describe('chargement des détails d’une édition (§12.1)', () => {
  it('écrit tracklist, headings, genres, styles et vidéos', async () => {
    const api = new FakeDiscogsApi([]);
    const releaseId = await applyReleaseDetails(await api.getRelease(R(9)));

    const tracks = await db
      .select()
      .from(discogsTracks)
      .where(eq(discogsTracks.releaseId, releaseId))
      .orderBy(discogsTracks.ordinal);

    expect(tracks).toHaveLength(3);
    expect(tracks[0]?.type).toBe('heading');
    expect(tracks[1]?.durationSeconds).toBe(200);
    expect(tracks[2]?.discogsPosition).toBe('A2');

    const releases = await db
      .select()
      .from(discogsReleases)
      .where(eq(discogsReleases.id, releaseId));

    expect(releases[0]?.genres).toEqual(['Electronic']);
    expect(releases[0]?.styles).toEqual(['Ambient']);
    expect(releases[0]?.detailsFetchedAt).not.toBeNull();
    expect(releases[0]?.artistsText).toBe('Artiste Test');
  });

  it('traite l’année 0 de Discogs comme une année inconnue', async () => {
    // Cas rencontré sur une vraie collection : une édition sans année reçoit `0`,
    // qui s'afficherait tel quel dans la fiche album.
    const api = new FakeDiscogsApi([]);
    const details = { ...(await api.getRelease(R(11))), year: 0 };

    const releaseId = await applyReleaseDetails(details);

    const rows = await db.select().from(discogsReleases).where(eq(discogsReleases.id, releaseId));
    expect(rows[0]?.year).toBeNull();
  });

  it('est idempotent : rejouer le même détail ne duplique pas les pistes', async () => {
    const api = new FakeDiscogsApi([]);
    const details = await api.getRelease(R(10));

    const releaseId = await applyReleaseDetails(details);
    await applyReleaseDetails(details);

    const tracks = await db
      .select()
      .from(discogsTracks)
      .where(eq(discogsTracks.releaseId, releaseId));

    expect(tracks).toHaveLength(3);
  });
});
