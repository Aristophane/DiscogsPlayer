/**
 * Normalisation et parsing du catalogue Discogs (§15.1, §22.1).
 *
 * Fonctions pures, sans accès base : ce sont les briques que le Lot 6 réutilisera pour
 * le scoring de confiance, et elles doivent rester déterministes et testables seules.
 */

/**
 * Forme comparable d'un texte : sans accent, sans casse, ponctuation réduite.
 * COLL-003 — « bjork » doit trouver « Björk », « Sigur Ros » trouver « Sigur Rós ».
 */
export function normalizeText(value: string): string {
  return (
    value
      .normalize('NFD')
      // Après NFD, les diacritiques sont des marques combinantes isolées.
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
  );
}

/**
 * Discogs suffixe les artistes homonymes d'un numéro entre parenthèses — « Nirvana (2) ».
 * Ce marqueur est un détail de base de données, pas une partie du nom.
 */
export function cleanArtistName(name: string): string {
  return name.replace(/\s*\(\d+\)\s*$/, '').trim();
}

/**
 * Durée Discogs vers secondes. Formats rencontrés : `3:45`, `1:02:03`, `45`, ou vide.
 * Une valeur non interprétable vaut `null` — jamais 0, qui signifierait « instantané ».
 */
export function parseDuration(raw: string | null | undefined): number | null {
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }

  const parts = trimmed.split(':');
  if (parts.length > 3) {
    return null;
  }

  let seconds = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part.trim())) {
      return null;
    }
    seconds = seconds * 60 + Number(part.trim());
  }

  return seconds;
}

/**
 * Assemble le crédit artiste tel qu'il s'affiche, en respectant les mots de liaison
 * Discogs (`join`) : « Simon & Garfunkel », « Bowie Feat. Queen ».
 */
export function formatArtistCredit(
  artists: readonly { name: string; join?: string | null | undefined }[],
): string {
  return artists
    .map((artist, index) => {
      const name = cleanArtistName(artist.name);
      const join = artist.join?.trim();

      if (index === artists.length - 1 || !join) {
        return name;
      }

      // Une virgule se colle au nom, un mot de liaison prend des espaces.
      return join === ',' ? `${name},` : `${name} ${join}`;
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type ParsedTrack = {
  ordinal: number;
  discogsPosition: string;
  title: string;
  titleNormalized: string;
  durationSeconds: number | null;
  type: 'track' | 'heading' | 'index';
};

/**
 * Aplatit une tracklist Discogs en pistes ordonnées.
 *
 * Les entrées `heading` et `index` sont conservées — elles structurent l'affichage — mais
 * ne sont pas lisibles (§10.2). Les sous-pistes d'une entrée `index` sont remontées au
 * même niveau, sinon elles seraient invisibles alors qu'elles sont, elles, lisibles.
 */
type TracklistEntry = {
  position?: string | null | undefined;
  title?: string | null | undefined;
  duration?: string | null | undefined;
  type_?: string | null | undefined;
};

export function parseTracklist(
  entries: readonly (TracklistEntry & {
    sub_tracks?: readonly TracklistEntry[] | null | undefined;
  })[],
): ParsedTrack[] {
  const tracks: ParsedTrack[] = [];

  const push = (entry: TracklistEntry) => {
    const rawType = entry.type_ ?? 'track';
    const type: ParsedTrack['type'] =
      rawType === 'heading' || rawType === 'index' ? rawType : 'track';
    const title = (entry.title ?? '').trim();

    tracks.push({
      ordinal: tracks.length,
      discogsPosition: (entry.position ?? '').trim(),
      title,
      titleNormalized: normalizeText(title),
      durationSeconds: parseDuration(entry.duration),
      type,
    });
  };

  for (const entry of entries) {
    push(entry);

    for (const sub of entry.sub_tracks ?? []) {
      push(sub);
    }
  }

  return tracks;
}

/** Identifiant YouTube d'une URL de vidéo Discogs, `null` si ce n'est pas YouTube. */
export function youtubeIdFromUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '');

  if (host === 'youtu.be') {
    const id = url.pathname.slice(1);
    return /^[\w-]{11}$/.test(id) ? id : null;
  }

  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    const id = url.searchParams.get('v');
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  }

  return null;
}
