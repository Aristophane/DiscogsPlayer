import { and, eq, exists } from 'drizzle-orm';

import { db } from '@/db/client';
import { collectionInstances, discogsReleases } from '@/db/schema';

import type { CrateRecord } from './crate';

/**
 * Compact metadata for every edition in the active collection, with no pagination or
 * format restriction. The caller resolves this owner from the authenticated server
 * session (including its validated collection sharing grant).
 * EXISTS prevents extra copies of a record from duplicating its sleeve in the crate.
 */
export async function getCrateCollection(userId: string): Promise<CrateRecord[]> {
  return db
    .select({
      releaseId: discogsReleases.id,
      discogsReleaseId: discogsReleases.discogsReleaseId,
      title: discogsReleases.title,
      artists: discogsReleases.artistsText,
      year: discogsReleases.year,
      genres: discogsReleases.genres,
      country: discogsReleases.country,
      coverUrl: discogsReleases.primaryImageUrl,
    })
    .from(discogsReleases)
    .where(
      exists(
        db
          .select({ releaseId: collectionInstances.releaseId })
          .from(collectionInstances)
          .where(
            and(
              eq(collectionInstances.releaseId, discogsReleases.id),
              eq(collectionInstances.userId, userId),
              eq(collectionInstances.isActive, true),
            ),
          ),
      ),
    )
    .orderBy(
      discogsReleases.artistsNormalized,
      discogsReleases.titleNormalized,
      discogsReleases.id,
    );
}
