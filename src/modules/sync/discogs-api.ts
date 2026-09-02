/**
 * Client de l'API Discogs pour l'import (SPECIFICATION.md §12).
 *
 * Deux exigences structurent ce module :
 * - SYNC-008 : les limites sont pilotées par les en-têtes renvoyés et `Retry-After`,
 *   jamais par une constante supposée ;
 * - §12.3 : une page en erreur n'est jamais interprétée comme une page vide — d'où des
 *   erreurs typées et non un tableau vide en cas de problème.
 *
 * L'interface `DiscogsApi` permet au mode fixtures (§23.3) et aux tests de remplacer
 * l'adaptateur externe sans changer une seule branche métier.
 */
import { z } from 'zod';

import { getEnv } from '@/lib/env';
import { moduleLogger } from '@/lib/logger';
import type { OAuthTokenPair } from '@/modules/auth/discogs-oauth';
import { buildAuthorizationHeader } from '@/modules/auth/discogs-oauth';

import { observeRateLimit, observeRateLimited, paced } from './pacer';

const log = moduleLogger('sync');

/** En dessous de ce reste, on cesse d'appeler avant d'atteindre zéro (§12.3). */
const RATE_LIMIT_SAFETY_MARGIN = 3;

export class DiscogsApiError extends Error {
  readonly status: number | undefined;
  readonly code: string;
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;

  constructor(params: {
    code: string;
    message: string;
    status?: number;
    retryable: boolean;
    retryAfterMs?: number;
    cause?: unknown;
  }) {
    super(params.message, params.cause === undefined ? undefined : { cause: params.cause });
    this.name = 'DiscogsApiError';
    this.code = params.code;
    this.status = params.status;
    this.retryable = params.retryable;
    this.retryAfterMs = params.retryAfterMs;
  }
}

const paginationSchema = z.object({
  page: z.number().int().positive(),
  pages: z.number().int().nonnegative(),
  items: z.number().int().nonnegative(),
  per_page: z.number().int().positive(),
});

const basicInformationSchema = z.object({
  id: z.number().int().positive(),
  master_id: z.number().int().nullable().optional(),
  title: z.string(),
  year: z.number().int().nullable().optional(),
  cover_image: z.string().nullable().optional(),
  thumb: z.string().nullable().optional(),
  formats: z.array(z.unknown()).nullable().optional(),
  genres: z.array(z.string()).nullable().optional(),
  styles: z.array(z.string()).nullable().optional(),
  artists: z
    .array(
      z.object({
        id: z.number().int().nullable().optional(),
        name: z.string(),
        join: z.string().nullable().optional(),
      }),
    )
    .nullable()
    .optional(),
});

const collectionPageSchema = z.object({
  pagination: paginationSchema,
  releases: z.array(
    z.object({
      id: z.number().int().positive(),
      instance_id: z.number().int().positive(),
      folder_id: z.number().int().nonnegative().nullable().optional(),
      rating: z.number().int().nullable().optional(),
      date_added: z.string().nullable().optional(),
      basic_information: basicInformationSchema,
    }),
  ),
});

const releaseSchema = z.object({
  id: z.number().int().positive(),
  master_id: z.number().int().nullable().optional(),
  title: z.string(),
  year: z.number().int().nullable().optional(),
  country: z.string().nullable().optional(),
  formats: z.array(z.unknown()).nullable().optional(),
  genres: z.array(z.string()).nullable().optional(),
  styles: z.array(z.string()).nullable().optional(),
  images: z
    .array(z.object({ type: z.string().optional(), uri: z.string().optional() }))
    .nullable()
    .optional(),
  artists: z
    .array(
      z.object({
        id: z.number().int().nullable().optional(),
        name: z.string(),
        join: z.string().nullable().optional(),
      }),
    )
    .nullable()
    .optional(),
  tracklist: z
    .array(
      z.object({
        position: z.string().nullable().optional(),
        title: z.string().nullable().optional(),
        duration: z.string().nullable().optional(),
        type_: z.string().nullable().optional(),
        extraartists: z.array(z.unknown()).nullable().optional(),
        sub_tracks: z
          .array(
            z.object({
              position: z.string().nullable().optional(),
              title: z.string().nullable().optional(),
              duration: z.string().nullable().optional(),
              type_: z.string().nullable().optional(),
            }),
          )
          .nullable()
          .optional(),
      }),
    )
    .nullable()
    .optional(),
  videos: z
    .array(
      z.object({
        uri: z.string(),
        title: z.string().nullable().optional(),
        duration: z.number().int().nullable().optional(),
      }),
    )
    .nullable()
    .optional(),
});

export type CollectionPage = z.infer<typeof collectionPageSchema>;
export type ReleaseDetails = z.infer<typeof releaseSchema>;

export type DiscogsApi = {
  getCollectionPage(
    tokens: OAuthTokenPair,
    username: string,
    page: number,
    perPage?: number,
  ): Promise<CollectionPage>;
  getRelease(discogsReleaseId: string, tokens?: OAuthTokenPair): Promise<ReleaseDetails>;
};

export type RateLimitSnapshot = {
  limit: number | null;
  remaining: number | null;
};

/** Lecture des en-têtes de limite Discogs. Exportée pour être testée seule (SYNC-008). */
export function readRateLimit(headers: Headers): RateLimitSnapshot {
  const toNumber = (value: string | null): number | null => {
    if (value === null) {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  return {
    limit: toNumber(headers.get('x-discogs-ratelimit')),
    remaining: toNumber(headers.get('x-discogs-ratelimit-remaining')),
  };
}

/** `Retry-After` en millisecondes. Accepte les secondes et la forme date HTTP. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) {
    return null;
  }

  const seconds = Number(value.trim());
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

async function authorizedFetch(url: string, tokens: OAuthTokenPair | undefined): Promise<Response> {
  const env = getEnv();

  const params: Record<string, string> = {
    oauth_consumer_key: env.DISCOGS_CONSUMER_KEY,
    oauth_nonce: crypto.randomUUID(),
    oauth_signature_method: 'PLAINTEXT',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: '1.0',
    oauth_signature: `${encodeURIComponent(env.DISCOGS_CONSUMER_SECRET)}&${encodeURIComponent(
      tokens?.tokenSecret ?? '',
    )}`,
  };

  if (tokens) {
    params.oauth_token = tokens.token;
  }

  return fetch(url, {
    headers: {
      Authorization: buildAuthorizationHeader(params),
      'User-Agent': env.DISCOGS_USER_AGENT,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(20_000),
  });
}

async function requestJson(url: string, tokens: OAuthTokenPair | undefined): Promise<unknown> {
  let response: Response;

  try {
    // Toute la régulation de débit passe par ici : aucun appel Discogs ne contourne
    // le régulateur, sinon la cadence n'aurait aucune valeur (§12.3).
    response = await paced(() => authorizedFetch(url, tokens));
  } catch (cause) {
    // Panne réseau ou timeout : récupérable, surtout pas assimilable à une page vide.
    throw new DiscogsApiError({
      code: 'DISCOGS_UNREACHABLE',
      message: 'Discogs est injoignable',
      retryable: true,
      cause,
    });
  }

  if (response.status === 429) {
    const retryAfterMs = parseRetryAfter(response.headers.get('retry-after')) ?? 60_000;
    observeRateLimited(retryAfterMs);

    throw new DiscogsApiError({
      code: 'DISCOGS_RATE_LIMITED',
      message: 'Discogs limite temporairement les appels',
      status: 429,
      retryable: true,
      retryAfterMs,
    });
  }

  if (!response.ok) {
    // 4xx hors 429 : rejouer n'y changerait rien, sauf pour un 5xx.
    throw new DiscogsApiError({
      code: response.status >= 500 ? 'DISCOGS_SERVER_ERROR' : 'DISCOGS_REQUEST_REJECTED',
      message: `Discogs a répondu ${response.status}`,
      status: response.status,
      retryable: response.status >= 500,
    });
  }

  // §12.3 et SYNC-008 : la cadence suit la limite annoncée, pas une constante supposée.
  const rateLimit = readRateLimit(response.headers);
  observeRateLimit(rateLimit);

  if (rateLimit.remaining !== null && rateLimit.remaining <= RATE_LIMIT_SAFETY_MARGIN) {
    log.warn({ rateLimit }, 'limite Discogs proche');
  }

  try {
    return await response.json();
  } catch (cause) {
    throw new DiscogsApiError({
      code: 'DISCOGS_INVALID_JSON',
      message: 'Réponse Discogs illisible',
      retryable: true,
      cause,
    });
  }
}

function parseOrThrow<T>(schema: z.ZodType<T>, payload: unknown, code: string): T {
  const parsed = schema.safeParse(payload);

  if (!parsed.success) {
    throw new DiscogsApiError({
      code,
      message: 'Réponse Discogs inexploitable',
      // Une réponse mal formée ne se répare pas en réessayant.
      retryable: false,
    });
  }

  return parsed.data;
}

/** Adaptateur réel, utilisé quand `PROVIDERS_MODE=live`. */
export const liveDiscogsApi: DiscogsApi = {
  async getCollectionPage(tokens, username, page, perPage = 100) {
    const url = new URL(
      `${getEnv().DISCOGS_API_BASE_URL}/users/${encodeURIComponent(username)}/collection/folders/0/releases`,
    );
    url.searchParams.set('page', String(page));
    // 100 est le maximum autorisé : moins de pages, donc moins d'appels (§12.1).
    url.searchParams.set('per_page', String(perPage));
    url.searchParams.set('sort', 'added');
    url.searchParams.set('sort_order', 'asc');

    return parseOrThrow(
      collectionPageSchema,
      await requestJson(url.toString(), tokens),
      'DISCOGS_COLLECTION_SHAPE',
    );
  },

  async getRelease(discogsReleaseId, tokens) {
    const url = `${getEnv().DISCOGS_API_BASE_URL}/releases/${encodeURIComponent(discogsReleaseId)}`;

    return parseOrThrow(releaseSchema, await requestJson(url, tokens), 'DISCOGS_RELEASE_SHAPE');
  },
};
