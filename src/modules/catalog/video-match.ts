/**
 * Appariement des vidéos Discogs aux pistes (SPECIFICATION.md §13.1 étape 3, §15).
 *
 * Les vidéos d'une édition Discogs ne sont **pas** indexées par piste — c'est une simple
 * liste, souvent incomplète, parfois avec plusieurs vidéos pour le même titre (clips,
 * captations, rééditions). Vérifié sur la collection réelle : le nombre de vidéos égale
 * rarement le nombre de pistes, donc un mappage par position serait faux la plupart du
 * temps. L'appariement se fait par similarité de texte sur le titre, avec les signaux
 * négatifs de §15.2.
 */
import { normalizeText } from './normalize';

/** Termes qui disqualifient une vidéo pour une lecture d'album studio (§15.2). */
const NEGATIVE_SIGNALS = [
  'live',
  'cover',
  'karaoke',
  'reaction',
  'tutorial',
  'slowed',
  'sped up',
  'remix',
  'edit',
  'remaster',
  'full album',
  // Contenu non musical qu'un simple 45 tours à vidéo unique peut malgré tout porter
  // (repli à vidéo unique, ci-dessous) : une interview n'est pas la piste.
  'interview',
  'documentary',
  'trailer',
  'teaser',
  'behind the scenes',
  'making of',
  'unboxing',
];

export type VideoCandidate = {
  id: string;
  title: string | null;
  durationSeconds: number | null;
};

export type TrackForMatch = {
  id: string;
  title: string;
  durationSeconds: number | null;
};

/**
 * Similarité de Jaccard entre le titre normalisé d'une vidéo et celui d'une piste :
 * mots communs rapportés à l'union des deux ensembles de mots.
 *
 * Pas une distance d'édition : les titres de vidéos ajoutent presque toujours l'artiste
 * et des mots-clés (« Official Video »...), qu'une distance d'édition pénaliserait à
 * tort. Et pas un simple rapport à la taille de la piste : un titre de piste très court
 * (« Love ») serait alors « contenu » dans n'importe quel titre de vidéo suffisamment
 * long, produisant de faux positifs. Jaccard pénalise naturellement un titre de vidéo
 * qui contient le mot mais porte surtout autre chose.
 */
function titleOverlap(videoTitle: string, trackTitle: string): number {
  const videoWords = new Set(normalizeText(videoTitle).split(' ').filter(Boolean));
  const trackWords = new Set(normalizeText(trackTitle).split(' ').filter(Boolean));

  if (trackWords.size === 0 || videoWords.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const word of trackWords) {
    if (videoWords.has(word)) {
      intersection += 1;
    }
  }

  const union = trackWords.size + videoWords.size - intersection;
  return intersection / union;
}

/**
 * Exportée pour être réutilisée par la recherche YouTube (`providers/youtube/service.ts`) :
 * une seule liste de signaux négatifs, jamais deux copies qui pourraient diverger.
 */
export function hasNegativeSignalForTrack(videoTitle: string, trackTitle: string): boolean {
  const normalizedVideo = normalizeText(videoTitle);
  const normalizedTrack = normalizeText(trackTitle);

  return NEGATIVE_SIGNALS.some(
    (signal) => normalizedVideo.includes(signal) && !normalizedTrack.includes(signal),
  );
}

/**
 * En dessous de ce score, une vidéo n'est pas retenue pour une piste précise.
 *
 * Calibré sur la collection réelle : un titre de vidéo « Artiste - Titre » ajoute
 * presque toujours 1 à 4 mots au titre de la piste, ce qui plafonne Jaccard bien avant 1
 * même sur une correspondance juste. 0,34 laisse passer ces cas sans rouvrir la porte à
 * un titre d'un seul mot noyé dans un titre de vidéo long (score < 0,15 dans ce cas).
 */
const MATCH_THRESHOLD = 0.34;

export type MatchResult = { trackId: string; videoId: string; score: number };

/**
 * Apparie chaque piste à sa meilleure vidéo, sans réutiliser une vidéo déjà attribuée à
 * une piste mieux notée — deux pistes ne doivent pas partager la même vidéo si une
 * alternative existe.
 */
export function matchVideosToTracks(
  tracks: readonly TrackForMatch[],
  videos: readonly VideoCandidate[],
): MatchResult[] {
  const candidates: MatchResult[] = [];

  for (const track of tracks) {
    for (const video of videos) {
      if (!video.title || hasNegativeSignalForTrack(video.title, track.title)) {
        continue;
      }

      const score = titleOverlap(video.title, track.title);
      if (score >= MATCH_THRESHOLD) {
        candidates.push({ trackId: track.id, videoId: video.id, score });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const usedVideos = new Set<string>();
  const usedTracks = new Set<string>();
  const results: MatchResult[] = [];

  for (const candidate of candidates) {
    if (usedVideos.has(candidate.videoId) || usedTracks.has(candidate.trackId)) {
      continue;
    }
    results.push(candidate);
    usedVideos.add(candidate.videoId);
    usedTracks.add(candidate.trackId);
  }

  return results;
}

/**
 * Repli pour une édition à vidéo unique et piste non appariée par titre (§13.1) : le cas
 * courant d'un simple 45 tours avec une seule vidéo promotionnelle. On ne l'attribue qu'à
 * la toute première piste jouable, jamais à une piste au hasard.
 */
export function fallbackSingleVideoMatch(
  tracks: readonly TrackForMatch[],
  videos: readonly VideoCandidate[],
  alreadyMatchedTrackIds: ReadonlySet<string>,
): MatchResult | null {
  if (videos.length !== 1) {
    return null;
  }

  const firstUnmatched = tracks.find((track) => !alreadyMatchedTrackIds.has(track.id));
  const video = videos[0];

  if (
    !firstUnmatched ||
    !video ||
    hasNegativeSignalForTrack(video.title ?? '', firstUnmatched.title)
  ) {
    return null;
  }

  return { trackId: firstUnmatched.id, videoId: video.id, score: 0 };
}
