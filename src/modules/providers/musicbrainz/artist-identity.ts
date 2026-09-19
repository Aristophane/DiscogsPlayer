import { z } from 'zod';
import { getEnv } from '@/lib/env';
import { parseRetryAfter } from '@/modules/sync/discogs-api';
import { ArtistOriginError } from '@/modules/providers/wikidata/artist-origin';

const urlSchema = z.object({
  resource: z.string().url(),
  relations: z.array(
    z.object({
      'target-type': z.string(),
      type: z.string(),
      artist: z.object({ id: z.string().uuid() }).optional(),
    }),
  ),
});

export function parseMusicBrainzIdentity(value: unknown, resource: string): string | null {
  const data = urlSchema.parse(value);
  if (data.resource !== resource) return null;
  const ids = new Set(
    data.relations.flatMap((relation) =>
      relation['target-type'] === 'artist' && relation.type === 'discogs' && relation.artist
        ? [relation.artist.id]
        : [],
    ),
  );
  return ids.size === 1 ? [...ids][0]! : null;
}

let chain: Promise<unknown> = Promise.resolve();
let nextAllowedAt = 0;

/** Exact URL identity only. MusicBrainz's associated country is not a birthplace. */
export function createMusicBrainzIdentityApi(fetcher: typeof fetch = fetch) {
  return async (discogsId: string): Promise<string | null> => {
    if (!/^[1-9]\d*$/.test(discogsId)) throw new ArtistOriginError(false);
    const run = chain.then(async () => {
      if (nextAllowedAt > Date.now() + 1100)
        throw new ArtistOriginError(true, nextAllowedAt - Date.now());
      if (nextAllowedAt > Date.now())
        await new Promise((resolve) => setTimeout(resolve, nextAllowedAt - Date.now()));
      try {
        const resource = `https://www.discogs.com/artist/${discogsId}`;
        const url = new URL('https://musicbrainz.org/ws/2/url');
        url.search = new URLSearchParams({ resource, inc: 'artist-rels', fmt: 'json' }).toString();
        const response = await fetcher(url, {
          headers: { Accept: 'application/json', 'User-Agent': getEnv().DISCOGS_USER_AGENT },
          signal: AbortSignal.timeout(20_000),
        });
        if (response.status === 404) return null;
        if (!response.ok) {
          const delay = parseRetryAfter(response.headers.get('retry-after')) ?? 60_000;
          if (response.status === 429 || response.status === 503)
            nextAllowedAt = Date.now() + delay;
          throw new ArtistOriginError(response.status === 429 || response.status >= 500, delay);
        }
        return parseMusicBrainzIdentity(await response.json(), resource);
      } catch (error) {
        if (error instanceof ArtistOriginError) throw error;
        throw new ArtistOriginError(true);
      } finally {
        nextAllowedAt = Math.max(nextAllowedAt, Date.now() + 1100);
      }
    });
    chain = run.catch(() => undefined);
    return run;
  };
}
