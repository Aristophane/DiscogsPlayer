import { inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '@/db/client';
import { collectionInstances, discogsReleases, users } from '@/db/schema';
import { getCrateCollection } from '@/modules/collection/crate-service';

const userIds = ['test-crate-owner', 'test-crate-other'];
const externalIds = Array.from({ length: 58 }, (_, index) => `test-crate-release-${index}`);
let ownerId: string;
let otherId: string;
let releaseIds: string[];

async function cleanup() {
  await db.delete(users).where(inArray(users.discogsUserId, userIds));
  await db.delete(discogsReleases).where(inArray(discogsReleases.discogsReleaseId, externalIds));
}

beforeEach(async () => {
  await cleanup();
  const people = await db
    .insert(users)
    .values(
      userIds.map((id) => ({
        discogsUserId: id,
        discogsUsername: id,
      })),
    )
    .returning();
  [ownerId, otherId] = people.map((person) => person.id) as [string, string];
  const releases = await db
    .insert(discogsReleases)
    .values(
      externalIds.map((id, index) => ({
        discogsReleaseId: id,
        title: `Album ${index}`,
        titleNormalized: String(index).padStart(2, '0'),
        artistsText: index % 2 === 0 ? 'Alpha' : 'Zulu',
        artistsNormalized: index % 2 === 0 ? 'alpha' : 'zulu',
        genres: index % 2 === 0 ? ['Rock'] : ['Jazz'],
        year: 1990 + index,
        country: 'France',
        primaryImageUrl: 'https://i.discogs.com/test.jpg',
        // No format restriction: this mode must retain the entire existing collection.
        formats: [{ name: index % 2 === 0 ? 'Vinyl' : 'CD' }],
      })),
    )
    .returning();
  releaseIds = releases.map((release) => release.id);
  await db.insert(collectionInstances).values([
    ...releaseIds.slice(0, 56).map((releaseId, index) => ({
      userId: ownerId,
      releaseId,
      discogsInstanceId: `copy-${index}`,
    })),
    { userId: ownerId, releaseId: releaseIds[0]!, discogsInstanceId: 'second-copy' },
    { userId: ownerId, releaseId: releaseIds[56]!, discogsInstanceId: 'removed', isActive: false },
    { userId: otherId, releaseId: releaseIds[57]!, discogsInstanceId: 'other-owner' },
  ]);
});

afterAll(async () => {
  await cleanup();
  await sql.end();
});

describe('collection des bacs', () => {
  it('charge toutes les éditions, dédupliquées et isolées par propriétaire actif', async () => {
    const records = await getCrateCollection(ownerId);
    expect(records).toHaveLength(56);
    expect(new Set(records.map((record) => record.releaseId)).size).toBe(56);
    expect(records.map((record) => record.releaseId)).not.toContain(releaseIds[56]);
    expect(records.map((record) => record.releaseId)).not.toContain(releaseIds[57]);
    expect((await getCrateCollection(otherId)).map((record) => record.releaseId)).toEqual([
      releaseIds[57],
    ]);
  });

  it('fournit les métadonnées des bacs et un ordre artistes, titre reproductible', async () => {
    const records = await getCrateCollection(ownerId);
    const expected = [
      ...Array.from({ length: 28 }, (_, index) => externalIds[index * 2]),
      ...Array.from({ length: 28 }, (_, index) => externalIds[index * 2 + 1]),
    ];
    expect(records.map((record) => record.discogsReleaseId)).toEqual(expected);
    expect(records[0]).toEqual({
      releaseId: releaseIds[0],
      discogsReleaseId: externalIds[0],
      title: 'Album 0',
      artists: 'Alpha',
      genres: ['Rock'],
      year: 1990,
      country: 'France',
      originCountries: null,
      originSourceUrls: [],
      coverUrl: 'https://i.discogs.com/test.jpg',
    });
    expect(await getCrateCollection(ownerId)).toEqual(records);
  });
});
