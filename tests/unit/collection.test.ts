import { describe, expect, it } from 'vitest';

import { formatDuration, formatFormats } from '@/modules/catalog/release-service';
import { coverProxyUrl } from '@/modules/collection/cover';
import { decodeCursor, encodeCursor, parseSort } from '@/modules/collection/cursor';

describe('curseur de pagination (§17.3, G-15)', () => {
  it('fait un aller-retour sans perte', () => {
    const cursor = {
      k: '2026-01-01T00:00:00.000Z',
      i: '8f1a4c2e-9d3b-4f6a-8e21-5c7d9b0a1e34',
      s: 'date_added_desc' as const,
    };

    expect(decodeCursor(encodeCursor(cursor), 'date_added_desc')).toEqual(cursor);
  });

  it('conserve une clé de tri absente', () => {
    const cursor = { k: null, i: '8f1a4c2e-9d3b-4f6a-8e21-5c7d9b0a1e34', s: 'year_desc' as const };

    expect(decodeCursor(encodeCursor(cursor), 'year_desc')).toEqual(cursor);
  });

  it('rejette un curseur émis pour un autre tri', () => {
    // Sinon la pagination reprendrait à une position qui n'a plus de sens.
    const cursor = encodeCursor({
      k: 1990,
      i: '8f1a4c2e-9d3b-4f6a-8e21-5c7d9b0a1e34',
      s: 'year_desc',
    });

    expect(decodeCursor(cursor, 'title_asc')).toBeNull();
  });

  it('ramène à la première page plutôt que d’échouer sur un curseur illisible', () => {
    expect(decodeCursor('pas-du-base64!!', 'title_asc')).toBeNull();
    expect(decodeCursor(Buffer.from('{}').toString('base64url'), 'title_asc')).toBeNull();
    expect(decodeCursor(null, 'title_asc')).toBeNull();
    expect(decodeCursor('', 'title_asc')).toBeNull();
  });

  it('n’expose aucune donnée d’utilisateur', () => {
    const encoded = encodeCursor({
      k: 'x',
      i: '8f1a4c2e-9d3b-4f6a-8e21-5c7d9b0a1e34',
      s: 'title_asc',
    });
    const decoded = Buffer.from(encoded, 'base64url').toString('utf8');

    expect(decoded).not.toContain('user');
  });
});

describe('parseSort', () => {
  it('accepte les options connues', () => {
    expect(parseSort('title_asc')).toBe('title_asc');
    expect(parseSort('year_desc')).toBe('year_desc');
  });

  it('retombe sur le tri par défaut pour une valeur inconnue', () => {
    expect(parseSort('n_importe_quoi')).toBe('date_added_desc');
    expect(parseSort(null)).toBe('date_added_desc');
  });
});

describe('proxy de pochette (G-03, §18.3)', () => {
  it('réécrit une URL Discogs vers le proxy', () => {
    expect(coverProxyUrl('https://i.discogs.com/abc/rs:fit/q:90/image.jpeg')).toBe(
      '/api/images/i.discogs.com/abc/rs:fit/q:90/image.jpeg',
    );
  });

  it('conserve la chaîne de requête', () => {
    expect(coverProxyUrl('https://i.discogs.com/a/b.jpg?v=2')).toBe(
      '/api/images/i.discogs.com/a/b.jpg?v=2',
    );
  });

  it('refuse toute origine hors allowlist', () => {
    expect(coverProxyUrl('https://evil.example/pochette.jpg')).toBeNull();
    expect(coverProxyUrl('https://i.discogs.com.evil.example/x.jpg')).toBeNull();
  });

  it('refuse le protocole non chiffré et les URL invalides', () => {
    expect(coverProxyUrl('http://i.discogs.com/a.jpg')).toBeNull();
    expect(coverProxyUrl('pas une url')).toBeNull();
    expect(coverProxyUrl(null)).toBeNull();
    expect(coverProxyUrl('')).toBeNull();
  });
});

describe('formatDuration', () => {
  it('formate minutes et secondes', () => {
    expect(formatDuration(225)).toBe('3:45');
    expect(formatDuration(65)).toBe('1:05');
  });

  it('ajoute les heures quand il en faut', () => {
    expect(formatDuration(3723)).toBe('1:02:03');
  });

  it('rend une chaîne vide pour une durée inconnue', () => {
    // Afficher « 0:00 » laisserait croire à une piste vide.
    expect(formatDuration(null)).toBe('');
    expect(formatDuration(0)).toBe('');
  });
});

describe('formatFormats (§7.4)', () => {
  it('assemble nom, quantité et descriptions', () => {
    expect(
      formatFormats([{ name: 'Vinyl', qty: '2', descriptions: ['LP', 'Album', 'Reissue'] }]),
    ).toBe('2 × Vinyl, LP, Album, Reissue');
  });

  it('omet la quantité quand il n’y a qu’un support', () => {
    expect(formatFormats([{ name: 'CD', qty: '1', descriptions: ['Album'] }])).toBe('CD, Album');
  });

  it('tolère un JSONB inattendu sans planter la fiche', () => {
    expect(formatFormats(null)).toBe('');
    expect(formatFormats('vinyl')).toBe('');
    expect(formatFormats([null, 42, { descriptions: ['Album'] }])).toBe('Album');
  });
});
