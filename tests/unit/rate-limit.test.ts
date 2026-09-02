import { describe, expect, it } from 'vitest';

import { parseRetryAfter, readRateLimit } from '@/modules/sync/discogs-api';
import { backoffMs } from '@/modules/sync/queue';

describe('en-têtes de limite Discogs (SYNC-008)', () => {
  it('lit la limite et le reste annoncés par Discogs', () => {
    const headers = new Headers({
      'x-discogs-ratelimit': '60',
      'x-discogs-ratelimit-remaining': '42',
    });

    expect(readRateLimit(headers)).toEqual({ limit: 60, remaining: 42 });
  });

  it('retourne null quand l’en-tête est absent, sans supposer de constante', () => {
    // SYNC-008 : ne jamais présumer « 60 par minute » — l'absence d'information est
    // une information, pas une valeur par défaut.
    expect(readRateLimit(new Headers())).toEqual({ limit: null, remaining: null });
  });

  it('ignore une valeur non numérique', () => {
    const headers = new Headers({ 'x-discogs-ratelimit-remaining': 'beaucoup' });

    expect(readRateLimit(headers).remaining).toBeNull();
  });
});

describe('parseRetryAfter (§12.3)', () => {
  it('accepte une durée en secondes', () => {
    expect(parseRetryAfter('30')).toBe(30_000);
    expect(parseRetryAfter(' 5 ')).toBe(5_000);
  });

  it('accepte une date HTTP', () => {
    const now = Date.parse('2026-09-02T10:00:00Z');
    expect(parseRetryAfter('Wed, 02 Sep 2026 10:00:30 GMT', now)).toBe(30_000);
  });

  it('ne renvoie jamais de délai négatif pour une date passée', () => {
    const now = Date.parse('2026-09-02T10:00:00Z');
    expect(parseRetryAfter('Wed, 02 Sep 2026 09:00:00 GMT', now)).toBe(0);
  });

  it('retourne null si l’en-tête est absent ou illisible', () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('bientôt')).toBeNull();
  });
});

describe('backoffMs (§9.4)', () => {
  it('croît exponentiellement avec les tentatives', () => {
    // Jitter figé à 1 pour comparer les délais nominaux.
    expect(backoffMs(1, 1)).toBe(1_000);
    expect(backoffMs(2, 1)).toBe(2_000);
    expect(backoffMs(3, 1)).toBe(4_000);
    expect(backoffMs(4, 1)).toBe(8_000);
  });

  it('applique un jitter entre 50 % et 100 % du délai', () => {
    expect(backoffMs(3, 0)).toBe(2_000);
    expect(backoffMs(3, 1)).toBe(4_000);
    expect(backoffMs(3, 0.5)).toBe(3_000);
  });

  it('plafonne le délai à cinq minutes', () => {
    expect(backoffMs(50, 1)).toBe(300_000);
  });

  it('reste positif pour une première tentative', () => {
    expect(backoffMs(0, 0)).toBeGreaterThan(0);
  });
});
