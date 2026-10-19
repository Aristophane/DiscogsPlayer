/** Politique de variété, indépendante de la base et des fournisseurs. */
export type RadioCandidate = {
  trackId: string;
  releaseId: string;
  artistKey: string;
  recordingKey: string;
  videoId: string | null;
};

export type RadioHistoryEntry = RadioCandidate & {
  sessionId: string;
  playedAt: Date;
};

const RECENT_TRACKS = 50;
const ARTIST_SPACING = 3;
const ALBUM_SPACING = 5;

function sameRecording(a: RadioCandidate, b: RadioCandidate): boolean {
  return (
    a.trackId === b.trackId ||
    a.recordingKey === b.recordingKey ||
    (a.videoId !== null && a.videoId === b.videoId)
  );
}

export function wasPlayedInSession(
  candidate: RadioCandidate,
  history: RadioHistoryEntry[],
  sessionId: string,
): boolean {
  return history.some((entry) => entry.sessionId === sessionId && sameRecording(candidate, entry));
}

/**
 * L'historique ne contient que les lectures résolues, de la plus récente à la plus
 * ancienne. Les contraintes de variété sont des préférences : un petit filtre reste
 * jouable. À égalité, tirer artiste puis album évite de favoriser les longs albums.
 */
export function selectRadioCandidate(
  candidates: RadioCandidate[],
  history: RadioHistoryEntry[],
  sessionId: string,
  random: () => number = Math.random,
): RadioCandidate | null {
  const keys = (candidate: RadioCandidate) => [
    `track:${candidate.trackId}`,
    `recording:${candidate.recordingKey}`,
    ...(candidate.videoId === null ? [] : [`video:${candidate.videoId}`]),
  ];
  const currentSession = new Set<string>();
  const recent = new Set<string>();
  const lastPlayedAt = new Map<string, number>();
  const recentArtists = new Set(history.slice(0, ARTIST_SPACING).map((entry) => entry.artistKey));
  const recentAlbums = new Set(history.slice(0, ALBUM_SPACING).map((entry) => entry.releaseId));
  history.forEach((entry, index) => {
    for (const key of keys(entry)) {
      if (!lastPlayedAt.has(key)) lastPlayedAt.set(key, entry.playedAt.getTime());
      if (index < RECENT_TRACKS) recent.add(key);
      if (entry.sessionId === sessionId) currentSession.add(key);
    }
  });

  let bestRank: number[] | null = null;
  let best: RadioCandidate[] = [];
  for (const candidate of candidates) {
    const candidateKeys = keys(candidate);
    if (candidateKeys.some((key) => currentSession.has(key))) {
      continue;
    }
    const rank = [
      candidateKeys.some((key) => recent.has(key)) ? 1 : 0,
      candidate.videoId === null ? 1 : 0,
      recentArtists.has(candidate.artistKey) ? 1 : 0,
      recentAlbums.has(candidate.releaseId) ? 1 : 0,
      Math.max(0, ...candidateKeys.map((key) => lastPlayedAt.get(key) ?? 0)),
    ];
    const difference =
      bestRank === null
        ? -1
        : (rank.map((value, index) => value - bestRank![index]!).find((value) => value !== 0) ?? 0);
    if (difference < 0) {
      bestRank = rank;
      best = [candidate];
    } else if (difference === 0) {
      best.push(candidate);
    }
  }

  const pick = <T>(items: T[]): T | undefined => items[Math.floor(random() * items.length)];
  const artists = [...Map.groupBy(best, (candidate) => candidate.artistKey).values()];
  const artist = pick(artists);
  if (!artist) {
    return null;
  }
  const albums = [...Map.groupBy(artist, (candidate) => candidate.releaseId).values()];
  return pick(pick(albums)!) ?? null;
}
