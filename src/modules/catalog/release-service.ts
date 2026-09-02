/**
 * Lecture d'une fiche d'édition (SPECIFICATION.md §7.4, §17.3).
 *
 * L'accès est toujours qualifié par l'utilisateur : une édition qu'il ne possède pas ne
 * lui est pas servie, même si elle existe au catalogue partagé (§18.5).
 */
import { and, asc, eq, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  collectionInstances,
  discogsReleaseVideos,
  discogsReleases,
  discogsTracks,
} from '@/db/schema';

export type ReleaseTrack = {
  id: string;
  ordinal: number;
  position: string;
  title: string;
  durationSeconds: number | null;
  type: 'track' | 'heading' | 'index';
};

export type ReleaseView = {
  releaseId: string;
  discogsReleaseId: string;
  title: string;
  artists: string;
  year: number | null;
  country: string | null;
  formats: unknown;
  genres: string[];
  styles: string[];
  coverUrl: string | null;
  detailsFetchedAt: Date | null;
  instanceCount: number;
  tracks: ReleaseTrack[];
  /** Vidéos déjà fournies par Discogs : candidats gratuits pour le Lot 6 (§13.1). */
  knownVideoCount: number;
};

export async function getReleaseForUser(
  userId: string,
  discogsReleaseId: string,
): Promise<ReleaseView | null> {
  const rows = await db
    .select({
      releaseId: discogsReleases.id,
      discogsReleaseId: discogsReleases.discogsReleaseId,
      title: discogsReleases.title,
      artists: discogsReleases.artistsText,
      year: discogsReleases.year,
      country: discogsReleases.country,
      formats: discogsReleases.formats,
      genres: discogsReleases.genres,
      styles: discogsReleases.styles,
      coverUrl: discogsReleases.primaryImageUrl,
      detailsFetchedAt: discogsReleases.detailsFetchedAt,
      instanceCount: sql<string>`count(*)::text`,
    })
    .from(collectionInstances)
    .innerJoin(discogsReleases, eq(discogsReleases.id, collectionInstances.releaseId))
    .where(
      and(
        eq(collectionInstances.userId, userId),
        eq(collectionInstances.isActive, true),
        eq(discogsReleases.discogsReleaseId, discogsReleaseId),
      ),
    )
    .groupBy(discogsReleases.id)
    .limit(1);

  const release = rows[0];
  if (!release) {
    return null;
  }

  const [tracks, videos] = await Promise.all([
    db
      .select({
        id: discogsTracks.id,
        ordinal: discogsTracks.ordinal,
        position: discogsTracks.discogsPosition,
        title: discogsTracks.title,
        durationSeconds: discogsTracks.durationSeconds,
        type: discogsTracks.type,
      })
      .from(discogsTracks)
      .where(eq(discogsTracks.releaseId, release.releaseId))
      .orderBy(asc(discogsTracks.ordinal)),
    db
      .select({ count: sql<string>`count(*)::text` })
      .from(discogsReleaseVideos)
      .where(eq(discogsReleaseVideos.releaseId, release.releaseId)),
  ]);

  return {
    ...release,
    instanceCount: Number(release.instanceCount),
    tracks,
    knownVideoCount: Number(videos[0]?.count ?? 0),
  };
}

/** `3:45` à partir de secondes ; chaîne vide si la durée est inconnue. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds <= 0) {
    return '';
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  const paddedSeconds = String(remaining).padStart(2, '0');

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${paddedSeconds}`
    : `${minutes}:${paddedSeconds}`;
}

/** Résumé lisible des formats Discogs : « LP, Album, Reissue ». */
export function formatFormats(raw: unknown): string {
  if (!Array.isArray(raw)) {
    return '';
  }

  const parts: string[] = [];

  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }

    const record = entry as { name?: unknown; qty?: unknown; descriptions?: unknown };

    if (typeof record.name === 'string') {
      const quantity = typeof record.qty === 'string' ? Number(record.qty) : 1;
      parts.push(quantity > 1 ? `${quantity} × ${record.name}` : record.name);
    }

    if (Array.isArray(record.descriptions)) {
      for (const description of record.descriptions) {
        if (typeof description === 'string') {
          parts.push(description);
        }
      }
    }
  }

  return parts.join(', ');
}
