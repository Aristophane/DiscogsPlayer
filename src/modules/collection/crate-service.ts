import { and, eq, exists, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  collectionInstances,
  discogsReleases,
  discogsArtists,
  discogsReleaseArtists,
} from '@/db/schema';
import { normalizeText } from '@/modules/catalog/normalize';

import type { CrateRecord } from './crate';

/**
 * Compact metadata for every edition in the active collection, with no pagination or
 * format restriction. The caller resolves this owner from the authenticated server
 * session (including its validated collection sharing grant).
 * EXISTS prevents extra copies of a record from duplicating its sleeve in the crate.
 */
export async function getCrateCollection(userId: string): Promise<CrateRecord[]> {
  const rows = await db
    .select({
      releaseId: discogsReleases.id,
      discogsReleaseId: discogsReleases.discogsReleaseId,
      title: discogsReleases.title,
      artists: discogsReleases.artistsText,
      year: discogsReleases.year,
      genres: discogsReleases.genres,
      country: discogsReleases.country,
      coverUrl: discogsReleases.primaryImageUrl,
      artistName: discogsArtists.name,
      originCountries: discogsArtists.originCountries,
      originSourceUrl: discogsArtists.originSourceUrl,
    })
    .from(discogsReleases)
    .leftJoin(discogsReleaseArtists, eq(discogsReleaseArtists.releaseId, discogsReleases.id))
    .leftJoin(discogsArtists, eq(discogsArtists.id, discogsReleaseArtists.artistId))
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
  const records = new Map<string, CrateRecord>();
  for (const { artistName, originCountries, originSourceUrl, ...row } of rows) {
    const known =
      originCountries?.length && originSourceUrl && artistName && !isPlaceholderArtist(artistName);
    const record = records.get(row.releaseId);
    if (record) {
      // Every credited main artist must be known; never guess a collaboration from one artist.
      record.originCountries =
        known && record.originCountries
          ? [...new Set([...record.originCountries, ...originCountries])]
          : null;
      if (known)
        record.originSourceUrls = [...new Set([...record.originSourceUrls, originSourceUrl])];
    } else
      records.set(row.releaseId, {
        ...row,
        originCountries: known ? originCountries : null,
        originSourceUrls: known ? [originSourceUrl] : [],
      });
  }
  return [...records.values()];
}

function isPlaceholderArtist(name: string): boolean {
  return ['various', 'various artists', 'unknown artist', 'unknown', 'no artist'].includes(
    normalizeText(name),
  );
}

/** Metadata only: the sync module combines this with its own task states. */
export async function getCollectionOriginArtists(userId: string) {
  const rows = await db
    .selectDistinct({
      id: discogsArtists.discogsArtistId,
      name: discogsArtists.name,
      countries: discogsArtists.originCountries,
      checkedAt: discogsArtists.originCheckedAt,
      version: discogsArtists.originLookupVersion,
    })
    .from(collectionInstances)
    .innerJoin(
      discogsReleaseArtists,
      eq(discogsReleaseArtists.releaseId, collectionInstances.releaseId),
    )
    .innerJoin(discogsArtists, eq(discogsArtists.id, discogsReleaseArtists.artistId))
    .where(and(eq(collectionInstances.userId, userId), eq(collectionInstances.isActive, true)));
  return rows.filter(
    (row) => row.id && /^[1-9]\d*$/.test(row.id) && !isPlaceholderArtist(row.name),
  );
}

/** Only main artists in this session owner's active collection are eligible. */
export async function listCollectionOriginCandidates(userId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: discogsArtists.discogsArtistId, name: discogsArtists.name })
    .from(collectionInstances)
    .innerJoin(
      discogsReleaseArtists,
      eq(discogsReleaseArtists.releaseId, collectionInstances.releaseId),
    )
    .innerJoin(discogsArtists, eq(discogsArtists.id, discogsReleaseArtists.artistId))
    .where(
      and(
        eq(collectionInstances.userId, userId),
        eq(collectionInstances.isActive, true),
        sql`(${discogsArtists.originNextCheckAt} is null or ${discogsArtists.originNextCheckAt} <= now() or (cardinality(${discogsArtists.originCountries}) = 0 and ${discogsArtists.originLookupVersion} < 2))`,
      ),
    );
  return rows.flatMap((row) =>
    row.id && /^[1-9]\d*$/.test(row.id) && !isPlaceholderArtist(row.name) ? [row.id] : [],
  );
}
