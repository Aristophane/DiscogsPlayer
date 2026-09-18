import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, sql } from '@/db/client';
import { collectionInstances, collectionShares, discogsReleases, users } from '@/db/schema';
import { getFriendsActivity, getRandomSpotlight } from '@/modules/collection/service';
import { revokeGrant } from '@/modules/sharing/service';

const userIds = ['test-home-viewer', 'test-home-friend', 'test-home-stranger'];
const releaseIds = ['test-home-first', 'test-home-latest', 'test-home-removed'];
let viewer: string;
let friend: string;
let stranger: string;
let releases: string[];

async function cleanup() {
  await db.delete(users).where(inArray(users.discogsUserId, userIds));
  await db.delete(discogsReleases).where(inArray(discogsReleases.discogsReleaseId, releaseIds));
}

beforeEach(async () => {
  await cleanup();
  const people = await db
    .insert(users)
    .values(userIds.map((id) => ({ discogsUserId: id, discogsUsername: id })))
    .returning();
  [viewer, friend, stranger] = people.map((person) => person.id) as [string, string, string];
  const albums = await db
    .insert(discogsReleases)
    .values(releaseIds.map((id) => ({ discogsReleaseId: id, title: id })))
    .returning();
  releases = albums.map((album) => album.id);
  await db.insert(collectionInstances).values([
    {
      userId: friend,
      releaseId: releases[0]!,
      discogsInstanceId: 'first',
      dateAdded: new Date('2026-01-01'),
    },
    {
      userId: friend,
      releaseId: releases[0]!,
      discogsInstanceId: 'copy',
      dateAdded: new Date('2026-03-01'),
    },
    {
      userId: friend,
      releaseId: releases[1]!,
      discogsInstanceId: 'latest',
      dateAdded: new Date('2026-02-01'),
    },
    {
      userId: friend,
      releaseId: releases[2]!,
      discogsInstanceId: 'removed',
      dateAdded: new Date('2026-04-01'),
      isActive: false,
    },
    {
      userId: stranger,
      releaseId: releases[2]!,
      discogsInstanceId: 'private',
      dateAdded: new Date('2026-05-01'),
    },
  ]);
});

afterAll(async () => {
  await cleanup();
  await sql.end();
});

describe('découvertes de l’accueil', () => {
  it('affiche seulement les ajouts des amis ayant partagé leur collection, triés et dédupliqués', async () => {
    expect(await getFriendsActivity(viewer)).toEqual([]);
    await db.insert(collectionShares).values({ ownerId: friend, granteeId: viewer });
    const feed = await getFriendsActivity(viewer);
    expect(feed.map((item) => item.discogsReleaseId)).toEqual([releaseIds[1], releaseIds[0]]);
    expect(feed.every((item) => item.ownerId === friend && item.ownerUsername === userIds[1])).toBe(
      true,
    );
    expect(new Date(feed[1]!.addedAt!).toISOString()).toBe('2026-01-01T00:00:00.000Z');
    await revokeGrant(friend, viewer);
    expect(await getFriendsActivity(viewer)).toEqual([]);
  });

  it('respecte le sens du partage et garde les dates inconnues après les ajouts datés', async () => {
    await db.insert(collectionShares).values({ ownerId: viewer, granteeId: friend });
    expect(await getFriendsActivity(viewer)).toEqual([]);
    await db.insert(collectionShares).values({ ownerId: friend, granteeId: viewer });
    await db
      .update(collectionInstances)
      .set({ dateAdded: null })
      .where(eq(collectionInstances.releaseId, releases[1]!));
    const feed = await getFriendsActivity(viewer);
    expect(feed.map((item) => item.discogsReleaseId)).toEqual([releaseIds[0], releaseIds[1]]);
    expect(feed[1]?.addedAt).toBeNull();
  });

  it('évite le dernier tirage, exclut les disques retirés et reste dans la collection active', async () => {
    expect(await getRandomSpotlight(viewer)).toBeNull();
    expect((await getRandomSpotlight(friend, releaseIds[0]))?.discogsReleaseId).toBe(releaseIds[1]);
    expect((await getRandomSpotlight(friend, releaseIds[1]))?.discogsReleaseId).toBe(releaseIds[0]);
    expect((await getRandomSpotlight(stranger, releaseIds[2]))?.discogsReleaseId).toBe(
      releaseIds[2],
    );
    await db
      .update(collectionInstances)
      .set({ isActive: false })
      .where(eq(collectionInstances.userId, friend));
    expect(await getRandomSpotlight(friend)).toBeNull();
  });
});
