/**
 * Résolution Spotify sans Web API (SPECIFICATION.md §14).
 *
 * v0 n'utilise ni OAuth ni clé Spotify : une recherche préremplie ouverte dans un nouvel
 * onglet, et une URL collée en retour, validée par oEmbed (§14.5). Aucun appel n'est fait
 * sans que l'utilisateur ait explicitement indiqué posséder un compte Spotify à
 * l'onboarding (ADR-0006) — ce gate est appliqué par le module `resolution`, pas ici.
 */
import { z } from 'zod';

import { getEnv } from '@/lib/env';

export function buildSearchUrl(params: { artist: string; trackTitle: string }): string {
  const query = `${params.artist} ${params.trackTitle}`.trim();
  return `https://open.spotify.com/search/${encodeURIComponent(query)}`;
}

const ALLOWED_HOSTS = new Set(['open.spotify.com']);
const ENTITY_PATTERN = /^\/(album|track|playlist)\/([A-Za-z0-9]+)/;

export type SpotifyEntity = {
  type: 'album' | 'track' | 'playlist';
  id: string;
  canonicalUrl: string;
};

/**
 * Canonicalise une URL Spotify collée par l'utilisateur : origine stricte, extraction du
 * type et de l'identifiant, suppression des paramètres de pistage (§14.4, §18.3).
 */
export function canonicalizeSpotifyUrl(rawUrl: string): SpotifyEntity | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) {
    return null;
  }

  const match = ENTITY_PATTERN.exec(url.pathname);
  if (!match) {
    return null;
  }

  const type = match[1] as SpotifyEntity['type'];
  const id = match[2]!;

  return { type, id, canonicalUrl: `https://open.spotify.com/${type}/${id}` };
}

const oEmbedSchema = z.object({
  title: z.string().optional(),
  html: z.string().optional(),
  thumbnail_url: z.string().optional(),
});

export class SpotifyOEmbedError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SpotifyOEmbedError';
  }
}

/**
 * Valide une entité via l'endpoint oEmbed officiel : une réponse réussie prouve que le
 * contenu existe et est public (§14.5). On ne rend jamais le HTML reçu — seuls le type et
 * l'identifiant, déjà validés, construisent l'iframe côté client.
 */
export async function validateViaOEmbed(entity: SpotifyEntity): Promise<{ title: string | null }> {
  const url = new URL(getEnv().SPOTIFY_OEMBED_URL);
  url.searchParams.set('url', entity.canonicalUrl);

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  } catch (cause) {
    throw new SpotifyOEmbedError('Spotify est injoignable', { cause });
  }

  if (!response.ok) {
    throw new SpotifyOEmbedError(`Spotify a répondu ${response.status}`);
  }

  const parsed = oEmbedSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    throw new SpotifyOEmbedError('Réponse oEmbed inexploitable');
  }

  return { title: parsed.data.title ?? null };
}

/** URL d'intégration officielle, construite à partir de valeurs déjà validées (§18.4). */
export function embedUrl(entity: SpotifyEntity): string {
  return `https://open.spotify.com/embed/${entity.type}/${entity.id}`;
}
