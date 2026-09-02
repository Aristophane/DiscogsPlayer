import { describe, expect, it } from 'vitest';

import { buildSearchUrl, canonicalizeSpotifyUrl } from '@/modules/providers/spotify/service';
import { buildManualSearchUrl, buildSearchQuery } from '@/modules/providers/youtube/service';

describe('canonicalizeSpotifyUrl (§14.4, §18.3)', () => {
  it('accepte un album et retire les paramètres de pistage', () => {
    expect(
      canonicalizeSpotifyUrl('https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy?si=abc123'),
    ).toEqual({
      type: 'album',
      id: '4aawyAB9vmqN3uQ7FjRGTy',
      canonicalUrl: 'https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy',
    });
  });

  it('accepte une piste et une playlist', () => {
    expect(canonicalizeSpotifyUrl('https://open.spotify.com/track/abc123XYZ00')?.type).toBe(
      'track',
    );
    expect(canonicalizeSpotifyUrl('https://open.spotify.com/playlist/abc123XYZ00')?.type).toBe(
      'playlist',
    );
  });

  it('refuse toute origine hors allowlist (§18.3)', () => {
    expect(canonicalizeSpotifyUrl('https://evil.example/album/abc123')).toBeNull();
    expect(canonicalizeSpotifyUrl('https://open.spotify.com.evil.example/album/abc')).toBeNull();
  });

  it('refuse le protocole non chiffré et les entités inconnues', () => {
    expect(canonicalizeSpotifyUrl('http://open.spotify.com/album/abc123')).toBeNull();
    expect(canonicalizeSpotifyUrl('https://open.spotify.com/artist/abc123')).toBeNull();
    expect(canonicalizeSpotifyUrl('https://open.spotify.com/')).toBeNull();
    expect(canonicalizeSpotifyUrl('pas une url')).toBeNull();
  });
});

describe('buildSearchUrl Spotify (§14.3)', () => {
  it('construit une recherche préremplie encodée', () => {
    const url = buildSearchUrl({ artist: 'Björk', trackTitle: 'Jóga' });
    expect(url).toBe('https://open.spotify.com/search/Bj%C3%B6rk%20J%C3%B3ga');
  });
});

describe('requête YouTube (§13.2)', () => {
  it('combine artiste, piste, album et année', () => {
    expect(
      buildSearchQuery({
        artist: 'Björk',
        trackTitle: 'Jóga',
        albumTitle: 'Homogenic',
        year: 1997,
      }),
    ).toBe('Björk Jóga Homogenic 1997');
  });

  it('omet une année inconnue sans laisser d’espace superflu', () => {
    expect(
      buildSearchQuery({ artist: 'Artiste', trackTitle: 'Titre', albumTitle: 'Album', year: null }),
    ).toBe('Artiste Titre Album');
  });

  it('construit une URL de recherche manuelle valide', () => {
    const url = buildManualSearchUrl('Björk Jóga');
    expect(url).toContain('youtube.com/results');
    expect(url).toContain('search_query=Bj%C3%B6rk');
  });
});
