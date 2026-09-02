import { describe, expect, it } from 'vitest';

import { nextPacificMidnightUtc } from '@/modules/providers/youtube/quota';

describe('nextPacificMidnightUtc (§22.1, §13.3)', () => {
  it('calcule minuit Pacifique en hiver (PST, UTC-8)', () => {
    // 2 septembre... non, choisissons une date d'hiver pour PST : 15 janvier 2026, 10h UTC.
    const now = new Date('2026-01-15T10:00:00Z');
    const reset = nextPacificMidnightUtc(now);

    // Minuit PST = 08:00 UTC le jour suivant.
    expect(reset.toISOString()).toBe('2026-01-16T08:00:00.000Z');
  });

  it('calcule minuit Pacifique en été (PDT, UTC-7)', () => {
    const now = new Date('2026-07-15T10:00:00Z');
    const reset = nextPacificMidnightUtc(now);

    // Minuit PDT = 07:00 UTC le jour suivant.
    expect(reset.toISOString()).toBe('2026-07-16T07:00:00.000Z');
  });

  it('reste dans le même jour si on est juste après minuit Pacifique', () => {
    // 00:30 PST = 08:30 UTC.
    const now = new Date('2026-01-15T08:30:00Z');
    const reset = nextPacificMidnightUtc(now);

    expect(reset.toISOString()).toBe('2026-01-16T08:00:00.000Z');
  });

  it('franchit correctement le changement d’heure de printemps (PST → PDT)', () => {
    // Aux États-Unis en 2026, le passage à l'heure d'été a lieu le 8 mars.
    const beforeChange = new Date('2026-03-07T20:00:00Z'); // encore PST
    const afterChange = new Date('2026-03-09T20:00:00Z'); // déjà PDT

    expect(nextPacificMidnightUtc(beforeChange).toISOString()).toBe('2026-03-08T08:00:00.000Z');
    expect(nextPacificMidnightUtc(afterChange).toISOString()).toBe('2026-03-10T07:00:00.000Z');
  });

  it('franchit correctement le changement d’heure d’automne (PDT → PST)', () => {
    // Aux États-Unis en 2026, l'heure d'été se termine le 1er novembre à 2h locales.
    // `beforeChange` (1h locale) est encore en PDT, mais le minuit suivant (Nov 2 local)
    // est déjà en PST : c'est exactement le cas qu'un simple décalage figé raterait.
    const beforeChange = new Date('2026-11-01T08:00:00Z'); // 01:00 PDT, avant la bascule
    const afterChange = new Date('2026-11-02T20:00:00Z'); // 12:00 PST, après la bascule

    expect(nextPacificMidnightUtc(beforeChange).toISOString()).toBe('2026-11-02T08:00:00.000Z');
    expect(nextPacificMidnightUtc(afterChange).toISOString()).toBe('2026-11-03T08:00:00.000Z');
  });
});
