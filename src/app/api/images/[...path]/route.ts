/**
 * Proxy d'images Discogs (SPEC-GAPS G-03).
 *
 * Les images Discogs sont servies avec des restrictions de hotlinking et l'API exige un
 * `User-Agent` identifiant : les référencer directement depuis le navigateur produit des
 * pochettes manquantes en production. On les relaie donc côté serveur.
 *
 * Défenses SSRF (§18.3) : allowlist d'origines exacte, aucune redirection suivie, timeout
 * court, taille de réponse plafonnée, type de contenu vérifié.
 */
import { NextResponse } from 'next/server';

import { requestId } from '@/lib/logger';
import { getEnv } from '@/lib/env';
import { ApiError } from '@/lib/api-error';
import { getCurrentUser } from '@/modules/auth/current-user';

export const dynamic = 'force-dynamic';

/** Hôtes d'images Discogs. Toute autre origine est refusée sans exception. */
const ALLOWED_HOSTS = new Set(['i.discogs.com', 'img.discogs.com', 'st.discogs.com']);

const ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** 8 Mo : très au-delà d'une pochette, très en deçà d'un fichier hostile. */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Segments autorisés dans un chemin d'image Discogs.
 *
 * Les URL Discogs contiennent des segments de transformation comme `rs:fit` ou `q:90` :
 * les percent-encoder casse la requête côté Discogs. On les laisse donc passer tels
 * quels, mais on refuse tout ce qui pourrait sortir du chemin — `/`, `%`, `..`.
 */
const SAFE_SEGMENT = /^[A-Za-z0-9._:@~-]+$/;

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse | Response> {
  const id = requestId(request.headers);

  // Une pochette n'est pas publique : elle appartient au contexte d'une collection.
  const user = await getCurrentUser();
  if (!user) {
    return new ApiError({
      code: 'AUTH_REQUIRED',
      message: 'Connectez-vous pour accéder à cette ressource.',
      status: 401,
    }).toResponse(id);
  }

  const { path } = await context.params;
  const [host, ...rest] = path;

  if (!host || !ALLOWED_HOSTS.has(host) || rest.length === 0) {
    return new ApiError({
      code: 'IMAGE_ORIGIN_REJECTED',
      message: 'Image indisponible.',
      status: 400,
    }).toResponse(id);
  }

  if (!rest.every((segment) => SAFE_SEGMENT.test(segment) && segment !== '..')) {
    return new ApiError({
      code: 'IMAGE_PATH_REJECTED',
      message: 'Image indisponible.',
      status: 400,
    }).toResponse(id);
  }

  // Reconstruction par l'API URL, jamais par concaténation naïve (§18.3).
  const target = new URL(`https://${host}/${rest.join('/')}`);
  target.search = new URL(request.url).search;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      headers: { 'User-Agent': getEnv().DISCOGS_USER_AGENT, Accept: 'image/*' },
      // `manual` : on ne suit aucune redirection, qui pourrait sortir de l'allowlist.
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return new ApiError({
      code: 'IMAGE_UNREACHABLE',
      message: 'Image indisponible.',
      status: 502,
      retryable: true,
    }).toResponse(id);
  }

  if (!upstream.ok || !upstream.body) {
    return new ApiError({
      code: 'IMAGE_NOT_FOUND',
      message: 'Image indisponible.',
      status: upstream.status === 404 ? 404 : 502,
    }).toResponse(id);
  }

  const contentType = upstream.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return new ApiError({
      code: 'IMAGE_TYPE_REJECTED',
      message: 'Image indisponible.',
      status: 415,
    }).toResponse(id);
  }

  const declaredLength = Number(upstream.headers.get('content-length') ?? '0');
  if (declaredLength > MAX_BYTES) {
    return new ApiError({
      code: 'IMAGE_TOO_LARGE',
      message: 'Image indisponible.',
      status: 413,
    }).toResponse(id);
  }

  // Une pochette ne change jamais pour une URL donnée : cache long, mais privé — la
  // réponse dépend d'une session (§20.3, ne pas mettre en cache publiquement).
  return new Response(upstream.body, {
    headers: {
      'content-type': contentType,
      'cache-control': 'private, max-age=86400, immutable',
      'x-request-id': id,
    },
  });
}
