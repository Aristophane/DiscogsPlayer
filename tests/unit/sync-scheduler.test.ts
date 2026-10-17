import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listUserIds, startSync } = vi.hoisted(() => ({
  listUserIds: vi.fn(),
  startSync: vi.fn(),
}));

vi.mock('@/modules/auth/service', () => ({ listCollectionSyncUserIds: listUserIds }));
vi.mock('@/modules/sync/service', () => ({ startSync }));

import { scheduleAutomaticCollectionSyncs } from '@/modules/sync/scheduler';

beforeEach(() => vi.resetAllMocks());

describe('planificateur de synchronisation', () => {
  it('continue avec les autres comptes si une planification échoue', async () => {
    const now = new Date();
    listUserIds.mockResolvedValue(['erreur', 'ami', 'déjà-à-jour']);
    startSync
      .mockRejectedValueOnce(new Error('compte supprimé pendant le cycle'))
      .mockResolvedValueOnce({ created: true })
      .mockResolvedValueOnce({ created: false });

    expect(await scheduleAutomaticCollectionSyncs(now)).toBe(1);
    expect(startSync).toHaveBeenNthCalledWith(2, 'ami', 'scheduled', now);
    expect(startSync).toHaveBeenNthCalledWith(3, 'déjà-à-jour', 'scheduled', now);
  });
});
