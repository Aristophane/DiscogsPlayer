import { describe, expect, it } from 'vitest';

import { createPacerState, updatePacer } from '@/modules/sync/pacer';

describe('régulation du débit Discogs (§12.3, SYNC-008)', () => {
  it('déduit la cadence de la limite annoncée par Discogs', () => {
    const state = updatePacer(createPacerState(), { limit: 60, remaining: 50 }, 1_000);

    // 60 appels par minute → un appel toutes les secondes.
    expect(state.intervalMs).toBe(1_000);
    expect(state.nextAllowedAt).toBe(2_000);
  });

  it('s’adapte à une limite plus basse', () => {
    const state = updatePacer(createPacerState(), { limit: 25, remaining: 20 }, 0);

    expect(state.intervalMs).toBe(2_400);
  });

  it('conserve la cadence prudente quand Discogs n’annonce rien', () => {
    // SYNC-008 : pas d'en-tête ne veut pas dire « pas de limite ».
    const state = updatePacer(createPacerState(), { limit: null, remaining: null }, 0);

    expect(state.intervalMs).toBe(1_100);
  });

  it('marque une pause franche avant d’atteindre zéro', () => {
    const state = updatePacer(createPacerState(), { limit: 60, remaining: 2 }, 1_000);

    // Cinq secondes plutôt qu'une : on laisse la fenêtre se reconstituer au lieu de
    // dépenser le dernier appel et d'encaisser un 429.
    expect(state.nextAllowedAt).toBe(6_000);
  });

  it('ne pause pas tant que la fenêtre est confortable', () => {
    const state = updatePacer(createPacerState(), { limit: 60, remaining: 40 }, 5_000);

    expect(state.nextAllowedAt).toBe(6_000);
  });
});
