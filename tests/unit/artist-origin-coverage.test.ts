import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDiscogsOrigin } from '@/modules/providers/discogs/artist-origin';
import { artistOriginApi, createCombinedArtistOriginApi } from '@/modules/providers/artist-origin';
import {
  buildMusicBrainzOriginQuery,
  ArtistOriginError,
} from '@/modules/providers/wikidata/artist-origin';
import {
  createMusicBrainzIdentityApi,
  parseMusicBrainzIdentity,
} from '@/modules/providers/musicbrainz/artist-identity';

const empty = { countries: [], sourceUrl: null };
const origin = { countries: ['South Africa'], sourceUrl: 'https://www.discogs.com/artist/5353905' };
const mbid = '72c536dc-7137-4477-a521-567eeb840fa8';
const resource = 'https://www.discogs.com/artist/59792';
const relation = { 'target-type': 'artist', type: 'discogs', artist: { id: mbid, country: 'FR' } };
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('couverture des origines sans inférence depuis les éditions', () => {
  it.each([
    [
      'Bernard Lavilliers',
      'French singer, born 7 October 1946 in Saint-Étienne, Loire, France.',
      'France',
    ],
    [
      'Bob Dylan',
      'Born: May 24, 1941, Duluth, Minnesota, USA; singer, songwriter, "song and dance man".',
      'United States',
    ],
    [
      'BCUC',
      'BCUC (Bantu Continua Uhuru Consciousness) is a band from Soweto, South Africa that draws inspiration from Indigenous music.',
      'South Africa',
    ],
  ])('reconnaît la description explicite de %s', (_name, profile, country) => {
    expect(parseDiscogsOrigin(profile)).toEqual([country]);
  });
  it.each([
    'A band inspired by French singers.',
    'French house producer based in Germany.',
    'Singer touring in France.',
    'Electronic artist. His father was a French singer.',
    'Born in France, moved to Japan.',
    'A group signed to a label from France.',
    'French-American singer.',
    'Born in Georgia.',
  ])('laisse une description ambiguë inconnue : %s', (profile) => {
    expect(parseDiscogsOrigin(profile)).toEqual([]);
  });
  it('utilise seulement le lien d’identité MusicBrainz, jamais son pays associé', () => {
    expect(parseMusicBrainzIdentity({ resource, relations: [relation] }, resource)).toBe(mbid);
    expect(
      parseMusicBrainzIdentity({ resource: resource + '1', relations: [relation] }, resource),
    ).toBeNull();
    expect(
      parseMusicBrainzIdentity(
        {
          resource,
          relations: [
            relation,
            { ...relation, artist: { id: '315eaf91-42c4-4bfd-876e-930ce59b4575' } },
          ],
        },
        resource,
      ),
    ).toBeNull();
    expect(buildMusicBrainzOriginQuery(mbid)).toContain(`wdt:P434 "${mbid}"`);
    expect(() => buildMusicBrainzOriginQuery('" UNION {}')).toThrow();
  });
  it('respecte le transport MusicBrainz et son délai après une limitation', async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ resource, relations: [relation] }))
      .mockResolvedValueOnce(new Response('', { status: 503, headers: { 'retry-after': '120' } }));
    const lookup = createMusicBrainzIdentityApi(fetcher);
    expect(await lookup('59792')).toBe(mbid);
    expect(String(fetcher.mock.calls[0]![0])).toContain('inc=artist-rels');
    const limited = expect(lookup('5353905')).rejects.toMatchObject({ retryAfterMs: 120_000 });
    await vi.advanceTimersByTimeAsync(1100);
    await limited;
    await expect(lookup('367370')).rejects.toBeInstanceOf(ArtistOriginError);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('passe aux sources suivantes après une absence ou une panne', async () => {
    const last = vi.fn().mockResolvedValue(origin);
    const lookup = createCombinedArtistOriginApi([
      {
        lookup: async () => {
          throw new ArtistOriginError(true);
        },
      },
      { lookup: async () => empty },
      { lookup: last },
    ]).lookup;
    expect(await lookup('5353905')).toEqual(origin);
    expect(last).toHaveBeenCalledWith('5353905');
  });
  it('ne met jamais en cache un résultat vide provoqué par une panne', async () => {
    await expect(
      createCombinedArtistOriginApi([
        {
          lookup: async () => {
            throw new ArtistOriginError(true, 120_000);
          },
        },
        { lookup: async () => empty },
      ]).lookup('5353905'),
    ).rejects.toMatchObject({ retryable: true, retryAfterMs: 120_000 });
    expect(
      await createCombinedArtistOriginApi([{ lookup: async () => empty }]).lookup('5353905'),
    ).toEqual(empty);
  });
  it('reste entièrement hors ligne en mode fixtures', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    expect(await artistOriginApi.lookup('5353905')).toEqual(empty);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
