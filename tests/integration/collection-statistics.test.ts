import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, sql } from '@/db/client';
import { users, discogsReleases, discogsTracks, collectionInstances, tasks } from '@/db/schema';
import { upsertUserFromDiscogs } from '@/modules/auth/service';
import { applyReleaseDetails, applyReleaseStatistics } from '@/modules/catalog/service';
import { getReleaseForUser } from '@/modules/catalog/release-service';
import {
  getCollectionHighlights,
  listCollection,
  listStaleCollectionStatistics,
} from '@/modules/collection/service';
import { requestCollectionStatisticsRefresh, TASK_FETCH_STATISTICS } from '@/modules/sync/service';
import { runTask } from '@/modules/sync/handlers';
import type { DiscogsApi } from '@/modules/sync/discogs-api';

const IDS = ['982810001', '982810002'];
const R = (n: number) => String(982820000 + n);
const RELEASES = Array.from({ length: 10 }, (_, i) => R(i + 1));
let ownerId: string;
let friendId: string;

async function cleanup() {
  await db.delete(tasks).where(
    inArray(
      tasks.dedupeKey,
      RELEASES.map((id) => `${TASK_FETCH_STATISTICS}:${id}`),
    ),
  );
  await db.delete(users).where(inArray(users.discogsUserId, IDS));
  await db.delete(discogsReleases).where(inArray(discogsReleases.discogsReleaseId, RELEASES));
}

beforeEach(async () => {
  await cleanup();
  ownerId = (
    await upsertUserFromDiscogs(
      { id: Number(IDS[0]), username: 'stats_owner' },
      { token: 'test', tokenSecret: 'test' },
    )
  ).id;
  friendId = (
    await upsertUserFromDiscogs(
      { id: Number(IDS[1]), username: 'stats_friend' },
      { token: 'test', tokenSecret: 'test' },
    )
  ).id;
  for (let n = 1; n <= 10; n++) {
    const releaseId = await applyReleaseDetails({
      id: Number(R(n)),
      title: `Album ${n}`,
      community: { have: n * 10, want: n * 100 },
      lowest_price: n === 1 ? 99 : n * 100,
      num_for_sale: 2,
      tracklist: [{ position: 'A1', title: 'Une piste', type_: 'track' }],
    });
    await db.insert(collectionInstances).values({
      userId: n === 10 ? friendId : ownerId,
      releaseId,
      discogsInstanceId: R(n),
      isActive: n !== 9,
    });
    if (n === 8)
      await db
        .insert(collectionInstances)
        .values({ userId: ownerId, releaseId, discogsInstanceId: '982829999' });
  }
});

afterAll(async () => {
  await cleanup();
  await sql.end();
});

describe('tops personnels et compteurs', () => {
  it('limite les tops à cinq éditions actives distinctes du propriétaire', async () => {
    const result = await getCollectionHighlights(ownerId);
    expect(result.wanted.map((r) => r.discogsReleaseId)).toEqual([8, 7, 6, 5, 4].map(R));
    expect(result.valuable.map((r) => r.discogsReleaseId)).toEqual([8, 7, 6, 5, 4].map(R));
    expect(result).toMatchObject({ total: 8, fetched: 8 });
    expect((await getCollectionHighlights(friendId)).wanted.map((r) => r.discogsReleaseId)).toEqual(
      [R(10)],
    );
  });

  it('exclut les prix sans annonces, les inconnus et les zéros du top, sans confondre zéro et absence', async () => {
    for (const n of [4, 5, 6, 7, 8]) {
      await applyReleaseStatistics({
        id: Number(R(n)),
        title: 'Album',
        community: { have: 0, want: 0 },
        lowest_price: 9999,
        num_for_sale: 0,
      });
    }
    await applyReleaseStatistics({ id: Number(R(2)), title: 'Album' });
    const top = await getCollectionHighlights(ownerId);
    expect(top.valuable.map((r) => r.discogsReleaseId)).toEqual([R(3), R(1)]);
    expect(top.wanted.map((r) => r.discogsReleaseId)).toEqual([R(3), R(1)]);
    const listed = (await listCollection(ownerId)).items;
    expect(listed.find((r) => r.discogsReleaseId === R(4))).toMatchObject({
      communityHave: 0,
      communityWant: 0,
    });
    expect(listed.find((r) => r.discogsReleaseId === R(2))).toMatchObject({
      communityHave: null,
      communityWant: null,
    });
    expect(await getReleaseForUser(ownerId, R(4))).toMatchObject({
      communityHave: 0,
      communityWant: 0,
      lowestPriceEur: null,
    });
  });

  it('rafraîchit les anciennes éditions sans modifier les identifiants des pistes', async () => {
    const release = await getReleaseForUser(ownerId, R(1));
    await db
      .update(discogsReleases)
      .set({ statisticsFetchedAt: null })
      .where(eq(discogsReleases.discogsReleaseId, R(1)));
    expect(await listStaleCollectionStatistics(ownerId)).toEqual([R(1)]);
    await requestCollectionStatisticsRefresh(ownerId);
    const [task] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.dedupeKey, `${TASK_FETCH_STATISTICS}:${R(1)}`));
    const getRelease = vi.fn().mockResolvedValue({
      id: Number(R(1)),
      title: 'Album',
      community: { have: 77, want: 88 },
      lowest_price: 123.45,
      num_for_sale: 2,
    });
    const api: DiscogsApi = { getRelease, getCollectionPage: vi.fn() };
    await runTask(task!, api);
    const refreshed = await getReleaseForUser(ownerId, R(1));
    expect(refreshed).toMatchObject({
      communityHave: 77,
      communityWant: 88,
      lowestPriceEur: '123.45',
    });
    expect(refreshed?.tracks[0]?.id).toBe(release?.tracks[0]?.id);
    expect(
      await db.select().from(discogsTracks).where(eq(discogsTracks.releaseId, release!.releaseId)),
    ).toHaveLength(1);
    await runTask(task!, api);
    expect(getRelease).toHaveBeenCalledTimes(1);
  });

  it('déduplique les tâches et préserve le délai de reprise après une limitation', async () => {
    await db
      .update(discogsReleases)
      .set({ statisticsFetchedAt: new Date(Date.now() - 25 * 3_600_000) })
      .where(eq(discogsReleases.discogsReleaseId, R(1)));
    expect(await getCollectionHighlights(ownerId)).toMatchObject({
      total: 8,
      fetched: 8,
      fresh: 7,
    });
    await requestCollectionStatisticsRefresh(ownerId);
    const later = new Date(Date.now() + 600_000);
    await db
      .update(tasks)
      .set({ status: 'retry_wait', runAfter: later })
      .where(eq(tasks.dedupeKey, `${TASK_FETCH_STATISTICS}:${R(1)}`));
    await requestCollectionStatisticsRefresh(ownerId);
    const rows = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.type, TASK_FETCH_STATISTICS),
          eq(tasks.dedupeKey, `${TASK_FETCH_STATISTICS}:${R(1)}`),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.runAfter.getTime()).toBe(later.getTime());
  });

  it('ne boucle pas sur des données absentes récemment vérifiées', async () => {
    await applyReleaseStatistics({ id: Number(R(1)), title: 'Album' });
    expect(await listStaleCollectionStatistics(ownerId)).toEqual([]);
    expect(await getCollectionHighlights(ownerId)).toMatchObject({ total: 8, fresh: 8 });
    expect((await getCollectionHighlights('00000000-0000-0000-0000-000000000000')).total).toBe(0);
  });
});
