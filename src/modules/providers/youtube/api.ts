/**
 * Client YouTube Data API v3 (SPECIFICATION.md §13.2, §13.5).
 *
 * Même discipline que le client Discogs (`sync/discogs-api.ts`) : interface remplaçable
 * par un double en test (§22.3, aucun appel réel), erreurs typées distinguant le quota
 * épuisé d'une panne récupérable.
 */
import { z } from 'zod';

import { getEnv } from '@/lib/env';

export class YoutubeApiError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly quotaExceeded: boolean;

  constructor(params: {
    code: string;
    message: string;
    retryable: boolean;
    quotaExceeded?: boolean;
    cause?: unknown;
  }) {
    super(params.message, params.cause === undefined ? undefined : { cause: params.cause });
    this.name = 'YoutubeApiError';
    this.code = params.code;
    this.retryable = params.retryable;
    this.quotaExceeded = params.quotaExceeded ?? false;
  }
}

const searchItemSchema = z.object({
  id: z.object({ videoId: z.string().optional() }).optional(),
  snippet: z.object({
    title: z.string(),
    channelTitle: z.string().optional(),
  }),
});

const searchResponseSchema = z.object({
  items: z.array(searchItemSchema).default([]),
});

export type YoutubeSearchResult = {
  videoId: string;
  title: string;
  channelTitle: string | null;
};

export type YoutubeApi = {
  search(query: string, maxResults?: number): Promise<YoutubeSearchResult[]>;
};

async function requestJson(url: URL): Promise<unknown> {
  let response: Response;

  try {
    response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch (cause) {
    throw new YoutubeApiError({
      code: 'YOUTUBE_UNREACHABLE',
      message: 'YouTube est injoignable',
      retryable: true,
      cause,
    });
  }

  if (!response.ok) {
    let quotaExceeded = false;
    try {
      const body = (await response.json()) as { error?: { errors?: { reason?: string }[] } };
      quotaExceeded =
        body.error?.errors?.some((entry) => entry.reason === 'quotaExceeded') ?? false;
    } catch {
      // Corps illisible : on continue avec `quotaExceeded = false`.
    }

    throw new YoutubeApiError({
      code: quotaExceeded ? 'YOUTUBE_SEARCH_QUOTA_EXHAUSTED' : 'YOUTUBE_REQUEST_REJECTED',
      message: `YouTube a répondu ${response.status}`,
      retryable: response.status >= 500,
      quotaExceeded,
    });
  }

  try {
    return await response.json();
  } catch (cause) {
    throw new YoutubeApiError({
      code: 'YOUTUBE_INVALID_JSON',
      message: 'Réponse YouTube illisible',
      retryable: true,
      cause,
    });
  }
}

/** Adaptateur réel — `PROVIDERS_MODE=live` uniquement, jamais en test (§22.3). */
export const liveYoutubeApi: YoutubeApi = {
  async search(query, maxResults = 5) {
    const env = getEnv();

    if (!env.YOUTUBE_API_KEY) {
      throw new YoutubeApiError({
        code: 'YOUTUBE_API_KEY_MISSING',
        message: 'Clé YouTube absente',
        retryable: false,
      });
    }

    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'video');
    // Nombre de candidats limité à l'utile : chaque page coûte le même prix (§13.2).
    url.searchParams.set('maxResults', String(maxResults));
    url.searchParams.set('q', query);
    url.searchParams.set('key', env.YOUTUBE_API_KEY);

    const body = await requestJson(url);
    const parsed = searchResponseSchema.safeParse(body);

    if (!parsed.success) {
      throw new YoutubeApiError({
        code: 'YOUTUBE_SEARCH_SHAPE',
        message: 'Réponse de recherche YouTube inexploitable',
        retryable: false,
      });
    }

    return parsed.data.items
      .filter((item): item is typeof item & { id: { videoId: string } } =>
        Boolean(item.id?.videoId),
      )
      .map((item) => ({
        videoId: item.id.videoId,
        title: item.snippet.title,
        channelTitle: item.snippet.channelTitle ?? null,
      }));
  },
};
