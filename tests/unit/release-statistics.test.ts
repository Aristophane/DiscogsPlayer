import { afterEach, describe, expect, it, vi } from 'vitest';
import { liveDiscogsApi } from '@/modules/sync/discogs-api';

vi.mock('@/modules/sync/pacer', () => ({
  paced: (callback: () => unknown) => callback(),
  observeRateLimit: vi.fn(),
  observeRateLimited: vi.fn(),
}));

afterEach(() => vi.unstubAllGlobals());

describe('statistiques de la réponse Discogs', () => {
  it('conserve les vrais zéros et demande explicitement des euros', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 12,
          title: 'Album',
          community: { have: 0, want: 1250, rating: { average: 4.72, count: 124 } },
          lowest_price: 42.5,
          num_for_sale: 3,
        }),
      ),
    );
    vi.stubGlobal('fetch', fetcher);
    expect(await liveDiscogsApi.getRelease('12')).toMatchObject({
      community: { have: 0, want: 1250, rating: { average: 4.72, count: 124 } },
      lowest_price: 42.5,
      num_for_sale: 3,
    });
    expect(new URL(fetcher.mock.calls[0]![0] as string).searchParams.get('curr_abbr')).toBe('EUR');
  });

  it.each([
    {},
    { community: null, lowest_price: null, num_for_sale: null },
    { community: { have: null, want: 0 } },
    { community: { rating: null } },
    { community: { rating: { average: 0, count: 0 } } },
  ])('tolère des statistiques absentes : %j', async (stats) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 12, title: 'Album', ...stats }))),
    );
    await expect(liveDiscogsApi.getRelease('12')).resolves.toMatchObject({ id: 12 });
  });

  it.each([
    { community: { have: -1 } },
    { community: { want: '12' } },
    { lowest_price: -5 },
    { community: { rating: { average: 6, count: 5 } } },
    { community: { rating: { average: '4.5', count: 5 } } },
    { community: { rating: { average: 4.5, count: -1 } } },
  ])('rejette les valeurs malformées : %j', async (stats) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 12, title: 'Album', ...stats }))),
    );
    await expect(liveDiscogsApi.getRelease('12')).rejects.toMatchObject({
      code: 'DISCOGS_RELEASE_SHAPE',
    });
  });
});
