import { getEnv } from '@/lib/env';
import { lookupDiscogsOrigin } from './discogs/artist-origin';
import { createMusicBrainzIdentityApi } from './musicbrainz/artist-identity';
import {
  ArtistOriginError,
  buildMusicBrainzOriginQuery,
  createArtistOriginApi,
  type ArtistOriginApi,
} from './wikidata/artist-origin';

export function createCombinedArtistOriginApi(
  providers: ArtistOriginApi[] = [
    createArtistOriginApi(),
    { lookup: lookupDiscogsOrigin },
    {
      async lookup(id) {
        const mbid = await createMusicBrainzIdentityApi()(id);
        return mbid
          ? createArtistOriginApi(fetch, buildMusicBrainzOriginQuery).lookup(mbid)
          : { countries: [], sourceUrl: null };
      },
    },
  ],
): ArtistOriginApi {
  return {
    async lookup(id) {
      if (!/^[1-9]\d*$/.test(id)) throw new ArtistOriginError(false);
      const errors: unknown[] = [];
      for (const provider of providers) {
        try {
          const result = await provider.lookup(id);
          if (result.countries.length && result.sourceUrl) return result;
        } catch (error) {
          errors.push(error);
        }
      }
      // An outage is not evidence of an unknown origin. Preserve the durable retry.
      if (errors.length) {
        const retryable = errors.some(
          (error) => !(error instanceof ArtistOriginError) || error.retryable,
        );
        const delay = Math.max(
          60_000,
          ...errors.map((error) =>
            error instanceof ArtistOriginError ? error.retryAfterMs : 60_000,
          ),
        );
        throw new ArtistOriginError(retryable, delay);
      }
      return { countries: [], sourceUrl: null };
    },
  };
}

export const artistOriginApi: ArtistOriginApi = {
  async lookup(id) {
    if (getEnv().PROVIDERS_MODE === 'fixtures') return { countries: [], sourceUrl: null };
    return createCombinedArtistOriginApi().lookup(id);
  },
};
