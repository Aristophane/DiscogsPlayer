import { describe, expect, it } from 'vitest';

import {
  cleanArtistName,
  formatArtistCredit,
  normalizeText,
  parseDuration,
  parseTracklist,
  youtubeIdFromUrl,
} from '@/modules/catalog/normalize';

describe('normalizeText (COLL-003)', () => {
  it('ignore les accents et la casse', () => {
    expect(normalizeText('Björk')).toBe('bjork');
    expect(normalizeText('Sigur Rós')).toBe('sigur ros');
    expect(normalizeText('Édith Piaf')).toBe(normalizeText('edith piaf'));
  });

  it('réduit la ponctuation à des espaces', () => {
    expect(normalizeText('Godspeed You! Black Emperor')).toBe('godspeed you black emperor');
    expect(normalizeText('  A.M.  ')).toBe('a m');
  });

  it('conserve les chiffres, qui distinguent des titres', () => {
    expect(normalizeText('Blade Runner 2049')).toBe('blade runner 2049');
  });
});

describe('cleanArtistName', () => {
  it('retire le suffixe d’homonymie Discogs', () => {
    expect(cleanArtistName('Nirvana (2)')).toBe('Nirvana');
    expect(cleanArtistName('Eden (13)')).toBe('Eden');
  });

  it('ne touche pas à une parenthèse qui fait partie du nom', () => {
    expect(cleanArtistName('Sunn O))) ')).toBe('Sunn O)))');
    expect(cleanArtistName('The The (band)')).toBe('The The (band)');
  });
});

describe('parseDuration (§22.1)', () => {
  it('interprète les formats Discogs courants', () => {
    expect(parseDuration('3:45')).toBe(225);
    expect(parseDuration('1:02:03')).toBe(3723);
    expect(parseDuration('45')).toBe(45);
    expect(parseDuration('0:30')).toBe(30);
  });

  it('retourne null plutôt que zéro quand la durée est absente', () => {
    // Zéro signifierait « piste instantanée » : une durée inconnue n'est pas une durée nulle.
    expect(parseDuration('')).toBeNull();
    expect(parseDuration(null)).toBeNull();
    expect(parseDuration(undefined)).toBeNull();
    expect(parseDuration('  ')).toBeNull();
  });

  it('rejette ce qui n’est pas une durée', () => {
    expect(parseDuration('trois minutes')).toBeNull();
    expect(parseDuration('1:2:3:4')).toBeNull();
    expect(parseDuration('-3:45')).toBeNull();
  });
});

describe('formatArtistCredit', () => {
  it('respecte les mots de liaison Discogs', () => {
    expect(formatArtistCredit([{ name: 'Simon', join: '&' }, { name: 'Garfunkel' }])).toBe(
      'Simon & Garfunkel',
    );
  });

  it('colle la virgule au nom qui précède', () => {
    expect(
      formatArtistCredit([{ name: 'Miles Davis', join: ',' }, { name: 'John Coltrane' }]),
    ).toBe('Miles Davis, John Coltrane');
  });

  it('nettoie les suffixes d’homonymie au passage', () => {
    expect(formatArtistCredit([{ name: 'Nirvana (2)' }])).toBe('Nirvana');
  });

  it('ignore le mot de liaison du dernier artiste', () => {
    expect(
      formatArtistCredit([
        { name: 'A', join: '&' },
        { name: 'B', join: '&' },
      ]),
    ).toBe('A & B');
  });
});

describe('parseTracklist (§10.2)', () => {
  it('numérote les pistes dans l’ordre reçu', () => {
    const tracks = parseTracklist([
      { position: 'A1', title: 'Un', duration: '3:00' },
      { position: 'A2', title: 'Deux', duration: '4:00' },
    ]);

    expect(tracks.map((track) => track.ordinal)).toEqual([0, 1]);
    expect(tracks.map((track) => track.discogsPosition)).toEqual(['A1', 'A2']);
    expect(tracks[1]?.durationSeconds).toBe(240);
  });

  it('conserve les headings sans les rendre lisibles', () => {
    const tracks = parseTracklist([
      { title: 'Face A', type_: 'heading' },
      { position: 'A1', title: 'Un', type_: 'track' },
    ]);

    expect(tracks[0]?.type).toBe('heading');
    expect(tracks[0]?.discogsPosition).toBe('');
    expect(tracks[1]?.type).toBe('track');
  });

  it('remonte les sous-pistes d’une entrée index, sinon elles seraient invisibles', () => {
    const tracks = parseTracklist([
      {
        position: 'A',
        title: 'Suite',
        type_: 'index',
        sub_tracks: [
          { position: 'A1', title: 'Mouvement I', duration: '5:00' },
          { position: 'A2', title: 'Mouvement II', duration: '6:00' },
        ],
      },
    ]);

    expect(tracks).toHaveLength(3);
    expect(tracks[0]?.type).toBe('index');
    expect(tracks[1]?.title).toBe('Mouvement I');
    expect(tracks[2]?.ordinal).toBe(2);
  });

  it('normalise les titres pour la recherche', () => {
    const tracks = parseTracklist([{ position: 'A1', title: 'Où Est La Mer ?' }]);

    expect(tracks[0]?.titleNormalized).toBe('ou est la mer');
  });

  it('tolère une tracklist vide', () => {
    expect(parseTracklist([])).toEqual([]);
  });
});

describe('youtubeIdFromUrl', () => {
  it('extrait l’identifiant des formes officielles', () => {
    expect(youtubeIdFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeIdFromUrl('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeIdFromUrl('https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=x')).toBe(
      'dQw4w9WgXcQ',
    );
  });

  it('refuse une autre origine (§13.5)', () => {
    expect(youtubeIdFromUrl('https://evil.example/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(youtubeIdFromUrl('pas une url')).toBeNull();
  });

  it('refuse un identifiant de longueur invalide', () => {
    expect(youtubeIdFromUrl('https://youtu.be/trop-court')).toBeNull();
  });
});
