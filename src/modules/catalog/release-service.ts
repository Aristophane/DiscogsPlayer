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

/**
 * Ce qu'il faut pour résoudre un média (§13, §14) : la piste, son édition, et le texte
 * utile à construire une requête de recherche. Distinct de `getReleaseForUser` : cette
 * lecture n'est pas qualifiée par utilisateur — le catalogue est partagé (§10.2), c'est
 * la collection qui est privée, pas l'édition elle-même.
 */
export type TrackForResolution = {
  trackId: string;
  trackTitle: string;
  trackOrdinal: number;
  durationSeconds: number | null;
  releaseId: string;
  discogsReleaseId: string;
  releaseTitle: string;
  releaseYear: number | null;
  artistsText: string;
  coverUrl: string | null;
};

export async function getTrackForResolution(trackId: string): Promise<TrackForResolution | null> {
  const rows = await db
    .select({
      trackId: discogsTracks.id,
      trackTitle: discogsTracks.title,
      trackOrdinal: discogsTracks.ordinal,
      durationSeconds: discogsTracks.durationSeconds,
      releaseId: discogsReleases.id,
      discogsReleaseId: discogsReleases.discogsReleaseId,
      releaseTitle: discogsReleases.title,
      releaseYear: discogsReleases.year,
      artistsText: discogsReleases.artistsText,
      coverUrl: discogsReleases.primaryImageUrl,
    })
    .from(discogsTracks)
    .innerJoin(discogsReleases, eq(discogsReleases.id, discogsTracks.releaseId))
    .where(eq(discogsTracks.id, trackId))
    .limit(1);

  return rows[0] ?? null;
}

/** Pistes jouables d'une édition, dans l'ordre — sert au matching et à la file (§13.6). */
export async function getPlayableTracks(
  releaseId: string,
): Promise<{ id: string; title: string; durationSeconds: number | null; ordinal: number }[]> {
  return db
    .select({
      id: discogsTracks.id,
      title: discogsTracks.title,
      durationSeconds: discogsTracks.durationSeconds,
      ordinal: discogsTracks.ordinal,
    })
    .from(discogsTracks)
    .where(and(eq(discogsTracks.releaseId, releaseId), eq(discogsTracks.type, 'track')))
    .orderBy(asc(discogsTracks.ordinal));
}

/** Vidéos brutes fournies par Discogs pour une édition — candidats gratuits (§13.1). */
export async function getReleaseVideos(
  releaseId: string,
): Promise<
  { id: string; urlCanonical: string; title: string | null; durationSeconds: number | null }[]
> {
  return db
    .select({
      id: discogsReleaseVideos.id,
      urlCanonical: discogsReleaseVideos.urlCanonical,
      title: discogsReleaseVideos.title,
      durationSeconds: discogsReleaseVideos.durationSeconds,
    })
    .from(discogsReleaseVideos)
    .where(eq(discogsReleaseVideos.releaseId, releaseId));
}

/** Première piste jouable d'une édition, pour le bouton play au niveau album. */
export async function getFirstPlayableTrackId(releaseId: string): Promise<string | null> {
  const rows = await db
    .select({ id: discogsTracks.id })
    .from(discogsTracks)
    .where(and(eq(discogsTracks.releaseId, releaseId), eq(discogsTracks.type, 'track')))
    .orderBy(asc(discogsTracks.ordinal))
    .limit(1);

  return rows[0]?.id ?? null;
}

/** Piste suivante dans l'ordre de l'édition, pour l'enchaînement de la file (§13.6). */
export async function getNextTrackId(
  releaseId: string,
  afterOrdinal: number,
): Promise<string | null> {
  const rows = await db
    .select({ id: discogsTracks.id })
    .from(discogsTracks)
    .where(
      and(
        eq(discogsTracks.releaseId, releaseId),
        eq(discogsTracks.type, 'track'),
        sql`${discogsTracks.ordinal} > ${afterOrdinal}`,
      ),
    )
    .orderBy(asc(discogsTracks.ordinal))
    .limit(1);

  return rows[0]?.id ?? null;
}
