import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/radio-sessions/route';
import { createSession } from '@/modules/radio/service';

vi.mock('@/modules/auth/current-user', () => ({
  requireUser: async () => ({ id: 'me', activeCollectionOwnerId: 'friend-being-viewed' }),
}));
vi.mock('@/modules/auth/cookies', () => ({ hasTrustedOrigin: () => true }));
vi.mock('@/modules/radio/service', () => ({ createSession: vi.fn() }));

beforeEach(() => {
  vi.mocked(createSession).mockReset();
  vi.mocked(createSession).mockResolvedValue({
    id: 'session',
    collectionOwnerId: 'me',
    includeFriends: false,
    filterGenres: [],
    filterStyles: [],
    completedAt: null,
  });
});

function request(body: unknown) {
  return new Request('http://localhost:3004/api/radio-sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('création des deux radios', () => {
  it('utilise ma collection même pendant la consultation de celle d’un ami', async () => {
    expect((await POST(request({}))).status).toBe(201);
    expect(createSession).toHaveBeenCalledWith('me', 'me', {});
  });

  it('transmet le choix de mélanger les amis sans accepter de propriétaire fourni par le client', async () => {
    expect(
      (await POST(request({ includeFriends: true, collectionOwnerId: 'other', genres: ['Jazz'] })))
        .status,
    ).toBe(201);
    expect(createSession).toHaveBeenCalledWith('me', 'me', {
      includeFriends: true,
      genres: ['Jazz'],
    });
  });

  it('rejette une valeur de mode invalide', async () => {
    expect((await POST(request({ includeFriends: 'yes' }))).status).toBe(400);
    expect(createSession).not.toHaveBeenCalled();
  });
});
