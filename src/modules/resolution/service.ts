/**
 * Orchestration de la résolution média (SPECIFICATION.md §13.1, §14.2).
 *
 * Ordre effectif en v0 simplifiée (Lot 5 — corrections communautaires — repoussé, donc pas
 * de préférence utilisateur ni de proposition confirmée par vote) :
 *
 *   1. correspondance déjà en cache (`track_resolutions`) ;
 *   2. vidéo Discogs déjà connue, appariée par titre (§13.1 étape 3, gratuit) ;
 *   3. recherche YouTube automatique si le quota le permet ;
 *   4. repli manuel : lien de recherche YouTube toujours proposé, lien de recherche
 *      Spotify seulement si l'utilisateur a indiqué posséder un compte (ADR-0006).
 *
 * Aucune résolution n'est déclenchée par l'import ni par le simple affichage d'une fiche
 * (§4.2) : ce service n'est appelé qu'au moment où l'utilisateur choisit une lecture.
 */
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/db/client';
import { providerEntities, trackResolutions, users } from '@/db/schema';
import { getEnv } from '@/lib/env';
import { moduleLogger } from '@/lib/logger';
import {
  getPlayableTracks,
  getLocalPlaybackCatalog,
  getReleaseVideos,
  getTrackForResolution,
} from '@/modules/catalog/release-service';
import { fallbackSingleVideoMatch, matchVideosToTracks } from '@/modules/catalog/video-match';
import { youtubeIdFromUrl } from '@/modules/catalog/normalize';
import { buildSearchUrl as buildSpotifySearchUrl } from '@/modules/providers/spotify/service';
import {
  buildManualSearchUrl,
  buildSearchQuery,
  searchTrack,
  type YoutubeSearchOutcome,
} from '@/modules/providers/youtube/service';
import type { YoutubeApi } from '@/modules/providers/youtube/api';

const log = moduleLogger('resolution');

export type ResolvedPlayback =
  | { status: 'resolved'; provider: 'youtube'; videoId: string; title: string | null }
  | { status: 'resolved'; provider: 'spotify'; embedType: 'track' | 'album'; spotifyId: string }
  | {
      status: 'unresolved';
      youtubeSearchUrl: string;
      spotifySearchUrl: string | null;
      quotaExhausted: boolean;
    };

async function getCachedResolution(trackId: string) {
  const rows = await db
    .select({
      provider: providerEntities.provider,
      entityType: providerEntities.entityType,
      externalId: providerEntities.externalId,
      titleCache: providerEntities.titleCache,
      source: trackResolutions.source,
      confidenceScore: trackResolutions.confidenceScore,
    })
    .from(trackResolutions)
    .innerJoin(providerEntities, eq(providerEntities.id, trackResolutions.providerEntityId))
    .where(eq(trackResolutions.trackId, trackId))
    .limit(1);

  return rows[0] ?? null;
}

export type KnownYoutubePlayback = { videoId: string; title: string | null };

/** Même appariement que la lecture, sans écrire de cache ni consommer de quota. */
export async function getKnownYoutubePlaybacks(
  releaseIds: string[],
): Promise<Map<string, KnownYoutubePlayback>> {
  const catalog = await getLocalPlaybackCatalog(releaseIds);
  const known = new Map<string, KnownYoutubePlayback>();
  if (catalog.tracks.length === 0) {
    return known;
  }

  const tracksByRelease = Map.groupBy(catalog.tracks, (track) => track.releaseId);
  const videosByRelease = Map.groupBy(catalog.videos, (video) => video.releaseId);
  for (const [releaseId, tracks] of tracksByRelease) {
    const videos = (videosByRelease.get(releaseId) ?? []).filter(
      (video) => youtubeIdFromUrl(video.urlCanonical) !== null,
    );
    const matches = matchVideosToTracks(tracks, videos);
    const fallback = fallbackSingleVideoMatch(
      tracks,
      videos,
      new Set(matches.map((m) => m.trackId)),
    );
    for (const match of [...matches, ...(fallback ? [fallback] : [])]) {
      const video = videos.find((candidate) => candidate.id === match.videoId)!;
      known.set(match.trackId, {
        videoId: youtubeIdFromUrl(video.urlCanonical)!,
        title: video.title,
      });
    }
  }

  const cached = await db
    .select({
      trackId: trackResolutions.trackId,
      source: trackResolutions.source,
      confidenceScore: trackResolutions.confidenceScore,
      videoId: providerEntities.externalId,
      title: providerEntities.titleCache,
    })
    .from(trackResolutions)
    .innerJoin(providerEntities, eq(providerEntities.id, trackResolutions.providerEntityId))
    .where(
      and(
        inArray(
          trackResolutions.trackId,
          catalog.tracks.map((track) => track.id),
        ),
        eq(providerEntities.provider, 'youtube'),
      ),
    );

  for (const cachedTrack of cached) {
    // Les anciens replis pouvaient réutiliser la vidéo d'une autre piste. Le catalogue
    // corrigé fait foi pour ces seules correspondances automatiques de score nul.
    if (cachedTrack.source === 'discogs_video' && cachedTrack.confidenceScore === 0) {
      continue;
    }
    known.set(cachedTrack.trackId, { videoId: cachedTrack.videoId, title: cachedTrack.title });
  }
  return known;
}

async function cacheResolution(params: {
  trackId: string;
  provider: 'youtube' | 'spotify';
  entityType: 'video' | 'track' | 'album';
  externalId: string;
  canonicalUrl: string;
  titleCache: string | null;
  source: 'discogs_video' | 'youtube_search' | 'spotify_search' | 'manual_url';
  confidenceScore: number | null;
}): Promise<void> {
  const [entity] = await db
    .insert(providerEntities)
    .values({
      provider: params.provider,
      entityType: params.entityType,
      externalId: params.externalId,
      canonicalUrl: params.canonicalUrl,
      titleCache: params.titleCache,
    })
    .onConflictDoUpdate({
      target: [providerEntities.provider, providerEntities.entityType, providerEntities.externalId],
      set: { titleCache: params.titleCache },
    })
    .returning({ id: providerEntities.id });

  if (!entity) {
    return;
  }

  await db
    .insert(trackResolutions)
    .values({
      trackId: params.trackId,
      providerEntityId: entity.id,
      source: params.source,
      confidenceScore: params.confidenceScore,
    })
    .onConflictDoUpdate({
      target: trackResolutions.trackId,
      set: {
        providerEntityId: entity.id,
        source: params.source,
        confidenceScore: params.confidenceScore,
        updatedAt: new Date(),
      },
    });
}

/** Vidéo Discogs déjà connue pour cette piste, si l'appariement par titre en trouve une. */
async function resolveFromDiscogsVideo(
  trackId: string,
  releaseId: string,
): Promise<{ videoId: string; title: string | null } | null> {
  const [tracks, releaseVideos] = await Promise.all([
    getPlayableTracks(releaseId),
    getReleaseVideos(releaseId),
  ]);
  const videos = releaseVideos.filter((video) => youtubeIdFromUrl(video.urlCanonical) !== null);

  if (videos.length === 0) {
    return null;
  }

  const matches = matchVideosToTracks(tracks, videos);
  const fallback = fallbackSingleVideoMatch(tracks, videos, new Set(matches.map((m) => m.trackId)));
  const applicable = [...matches, ...(fallback ? [fallback] : [])].find(
    (match) => match.trackId === trackId,
  );

  if (!applicable) {
    return null;
  }

  const video = videos.find((candidate) => candidate.id === applicable.videoId);
  if (!video) {
    return null;
  }

  const videoId = youtubeIdFromUrl(video.urlCanonical);
  if (!videoId) {
    // Vidéo Discogs d'un fournisseur autre que YouTube, ou URL non reconnue (§13.5).
    return null;
  }

  await cacheResolution({
    trackId,
    provider: 'youtube',
    entityType: 'video',
    externalId: videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    titleCache: video.title,
    source: 'discogs_video',
    confidenceScore: applicable.score,
  });

  return { videoId, title: video.title };
}

async function spotifyEnabledFor(userId: string): Promise<boolean> {
  const rows = await db
    .select({ spotifyEnabled: users.spotifyEnabled })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return rows[0]?.spotifyEnabled === 'yes';
}

/**
 * Résout une piste pour la lecture. Idempotent et rejouable : un second appel retrouve la
 * même correspondance en cache sans nouvelle recherche.
 */
export async function resolveTrack(
  userId: string,
  trackId: string,
  youtubeApi?: YoutubeApi,
): Promise<ResolvedPlayback | null> {
  const track = await getTrackForResolution(trackId);
  if (!track) {
    return null;
  }

  const cached = await getCachedResolution(trackId);
  const legacyFallback = cached?.source === 'discogs_video' && cached.confidenceScore === 0;
  if (cached && cached.provider === 'youtube' && !legacyFallback) {
    return {
      status: 'resolved',
      provider: 'youtube',
      videoId: cached.externalId,
      title: cached.titleCache,
    };
  }

  const fromDiscogs = await resolveFromDiscogsVideo(trackId, track.releaseId);
  if (fromDiscogs) {
    log.info({ trackId, source: 'discogs_video' }, 'piste résolue');
    return {
      status: 'resolved',
      provider: 'youtube',
      videoId: fromDiscogs.videoId,
      title: fromDiscogs.title,
    };
  }

  if (legacyFallback) {
    await db.delete(trackResolutions).where(eq(trackResolutions.trackId, trackId));
  }

  const query = buildSearchQuery({
    artist: track.artistsText,
    trackTitle: track.trackTitle,
    albumTitle: track.releaseTitle,
    year: track.releaseYear,
  });

  const searchResult: YoutubeSearchOutcome = await searchTrack(
    {
      artist: track.artistsText,
      trackTitle: track.trackTitle,
      albumTitle: track.releaseTitle,
      year: track.releaseYear,
    },
    youtubeApi,
  );

  if (searchResult.status === 'found') {
    await cacheResolution({
      trackId,
      provider: 'youtube',
      entityType: 'video',
      externalId: searchResult.videoId,
      canonicalUrl: `https://www.youtube.com/watch?v=${searchResult.videoId}`,
      titleCache: searchResult.title,
      source: 'youtube_search',
      confidenceScore: null,
    });

    log.info({ trackId, source: 'youtube_search' }, 'piste résolue');
    return {
      status: 'resolved',
      provider: 'youtube',
      videoId: searchResult.videoId,
      title: searchResult.title,
    };
  }

  const spotifyEnabled = await spotifyEnabledFor(userId);

  return {
    status: 'unresolved',
    youtubeSearchUrl: buildManualSearchUrl(query),
    spotifySearchUrl: spotifyEnabled
      ? buildSpotifySearchUrl({ artist: track.artistsText, trackTitle: track.trackTitle })
      : null,
    quotaExhausted: searchResult.status === 'quota_exhausted',
  };
}

export function youtubeReserveConfigured(): boolean {
  return getEnv().YOUTUBE_API_KEY !== undefined && getEnv().YOUTUBE_API_KEY !== '';
}
