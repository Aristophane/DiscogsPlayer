import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  artistOriginApi,
  ArtistOriginError,
  buildArtistOriginQuery,
  createArtistOriginApi,
  parseArtistOrigin,
} from '@/modules/providers/wikidata/artist-origin';

const binding = (id: string, country?: string, basis = 'origin') => ({
  artist: { type: 'uri', value: `http://www.wikidata.org/entity/${id}` },
  ...(country
    ? { countryName: { type: 'literal', value: country }, basis: { type: 'literal', value: basis } }
    : {}),
});
const response = (...bindings: ReturnType<typeof binding>[]) => ({ results: { bindings } });
afterEach(() => vi.useRealTimers());

describe('origine Wikidata par identité Discogs', () => {
  it('ne fait aucune recherche par nom et rejette les identifiants injectés', () => {
    expect(buildArtistOriginQuery('45467')).toContain('wdt:P1953 "45467"');
    for (const id of ['abc', '0', '12" UNION {}', '-4'])
      expect(() => buildArtistOriginQuery(id)).toThrow();
  });
  it('préfère le pays d’origine explicite puis la formation puis la naissance', () => {
    expect(
      parseArtistOrigin(response(binding('Q1', 'Senegal'), binding('Q1', 'France', 'birth'))),
    ).toEqual({ countries: ['Senegal'], sourceUrl: 'https://www.wikidata.org/wiki/Q1' });
    expect(
      parseArtistOrigin(
        response(binding('Q1', 'Mali', 'formation'), binding('Q1', 'France', 'birth')),
      ).countries,
    ).toEqual(['Mali']);
    expect(parseArtistOrigin(response(binding('Q1', 'Japan', 'birth'))).countries).toEqual([
      'Japan',
    ]);
  });
  it('garde les origines multiples documentées, sans choisir arbitrairement la première', () => {
    expect(
      parseArtistOrigin(
        response(binding('Q1', 'Mali'), binding('Q1', 'France'), binding('Q1', 'Mali')),
      ).countries,
    ).toEqual(['France', 'Mali']);
  });
  it('laisse inconnus les absences, collisions d’identités et réponses tronquées', () => {
    for (const data of [
      response(),
      response(binding('Q1')),
      response(binding('Q1', 'France'), binding('Q2')),
      response(...Array.from({ length: 100 }, () => binding('Q1', 'France'))),
    ]) {
      expect(parseArtistOrigin(data)).toEqual({ countries: [], sourceUrl: null });
    }
    expect(() => parseArtistOrigin({ error: 'timeout' })).toThrow();
    expect(() =>
      parseArtistOrigin(response({ artist: { type: 'uri', value: 'https://evil.example/Q1' } })),
    ).toThrow();
  });
  it('valide le JSON HTTP, transmet un User-Agent et respecte Retry-After', async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(response(binding('Q1', 'Senegal'))))
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '120' } }));
    const api = createArtistOriginApi(fetcher);
    expect((await api.lookup('123')).countries).toEqual(['Senegal']);
    expect(String(fetcher.mock.calls[0]![0])).toContain('query.wikidata.org/sparql');
    expect(fetcher.mock.calls[0]![1]?.headers).toHaveProperty('User-Agent');
    const limited = expect(api.lookup('456')).rejects.toMatchObject({
      retryable: true,
      retryAfterMs: 120_000,
    });
    await vi.advanceTimersByTimeAsync(1100);
    await limited;
    await expect(api.lookup('789')).rejects.toBeInstanceOf(ArtistOriginError);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('reste sans réseau en mode fixtures', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    expect(await artistOriginApi.lookup('123')).toEqual({ countries: [], sourceUrl: null });
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockRestore();
  });
});
