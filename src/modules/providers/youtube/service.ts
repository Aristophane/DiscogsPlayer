/**
 * Résolution YouTube (SPECIFICATION.md §13).
 *
 * Une recherche automatique n'a lieu que si le quota le permet (§13.3). Aucune sélection
 * manuelle de candidats en v0 simplifiée : le meilleur résultat est choisi automatiquement
 * par similarité de titre, avec les signaux négatifs de §15.2 — cohérent avec l'appariement
 * des vidéos Discogs (`catalog/video-match.ts`), qui applique la même logique.
 */
import { getEnv } from '@/lib/env';
import { moduleLogger } from '@/lib/logger';
import { hasNegativeSignalForTrack } from '@/modules/catalog/video-match';

import { liveYoutubeApi, YoutubeApiError, type YoutubeApi } from './api';
import { markExhausted, reserveUnits } from './quota';

const log = moduleLogger('resolution');

export type YoutubeSearchOutcome =
  | { status: 'found'; videoId: string; title: string }
  | { status: 'not_found' }
  | { status: 'quota_exhausted' };

/** Requête de base (§13.2) : artiste principal, titre de piste, album, année si connue. */
export function buildSearchQuery(params: {
  artist: string;
  trackTitle: string;
  albumTitle: string;
  year: number | null;
}): string {
  return [params.artist, params.trackTitle, params.albumTitle, params.year ?? '']
    .filter((part) => part !== '')
    .join(' ')
    .trim();
}

export function buildManualSearchUrl(query: string): string {
  const url = new URL('https://www.youtube.com/results');
  url.searchParams.set('search_query', query);
  return url.toString();
}

/**
 * Réutilise la même liste de signaux négatifs que l'appariement des vidéos Discogs
 * (`catalog/video-match.ts`) plutôt que d'en tenir une seconde : une divergence entre les
 * deux serait un bug silencieux — c'est précisément ce qui s'est produit en développement
 * quand cette liste, retapée séparément, avait perdu « live ».
 */
function isAcceptable(title: string, trackTitle: string): boolean {
  return !hasNegativeSignalForTrack(title, trackTitle);
}

/**
 * Recherche et retient le premier résultat acceptable. Réserve le quota avant l'appel et
 * ne le rembourse jamais après un appel effectivement émis (§12.3, SPEC-GAPS G-16) : que
 * Google ait ou non renvoyé un résultat utile, l'appel a été compté par Google.
 */
export async function searchTrack(
  params: { artist: string; trackTitle: string; albumTitle: string; year: number | null },
  api: YoutubeApi = liveYoutubeApi,
): Promise<YoutubeSearchOutcome> {
  const env = getEnv();
  const reserved = await reserveUnits(env.YOUTUBE_SEARCH_UNIT_COST, 'search');

  if (!reserved) {
    log.info({ params }, 'recherche YouTube refusée : quota insuffisant');
    return { status: 'quota_exhausted' };
  }

  const query = buildSearchQuery(params);

  try {
    const results = await api.search(query);
    const accepted = results.find((result) => isAcceptable(result.title, params.trackTitle));

    if (!accepted) {
      return { status: 'not_found' };
    }

    return { status: 'found', videoId: accepted.videoId, title: accepted.title };
  } catch (error) {
    if (error instanceof YoutubeApiError) {
      if (error.quotaExceeded) {
        // Google nous dit explicitement que le quota est épuisé : on ne le redécouvre
        // pas à la prochaine tentative (ADR-0002).
        await markExhausted();
        return { status: 'quota_exhausted' };
      }

      // Une panne YouTube (clé absente, réseau, réponse illisible) ne doit jamais faire
      // échouer la demande de lecture : l'utilisateur retombe sur le repli manuel.
      log.warn({ code: error.code, err: error }, 'recherche YouTube en échec, repli manuel');
      return { status: 'not_found' };
    }

    throw error;
  }
}
