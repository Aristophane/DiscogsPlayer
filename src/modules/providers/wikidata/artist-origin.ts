import { z } from 'zod';
import { getEnv } from '@/lib/env';
import { parseRetryAfter } from '@/modules/sync/discogs-api';

const literal = z.object({ type: z.literal('literal'), value: z.string() });
const entity = z.object({
  type: z.literal('uri'),
  value: z.string().regex(/^https?:\/\/www\.wikidata\.org\/entity\/Q\d+$/),
});
const responseSchema = z.object({
  results: z.object({
    bindings: z.array(
      z.object({
        artist: entity,
        countryName: literal.optional(),
        basis: literal.optional(),
      }),
    ),
  }),
});

export type ArtistOrigin = { countries: string[]; sourceUrl: string | null };
export type ArtistOriginApi = { lookup(discogsArtistId: string): Promise<ArtistOrigin> };

export class ArtistOriginError extends Error {
  constructor(
    public readonly retryable: boolean,
    public readonly retryAfterMs = 60_000,
  ) {
    super('Wikidata artist origin unavailable');
  }
}

/** Exact identity, no name matching or inference from biography, nationality or pressing. */
export function buildArtistOriginQuery(discogsArtistId: string): string {
  if (!/^[1-9]\d*$/.test(discogsArtistId)) throw new ArtistOriginError(false);
  return `PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT DISTINCT ?artist ?countryName ?basis WHERE {
  ?artist wdt:P1953 "${discogsArtistId}" .
  OPTIONAL {
    { ?artist wdt:P495 ?country . BIND("origin" AS ?basis) }
    UNION { ?artist wdt:P740 ?place . ?place wdt:P17? ?country . BIND("formation" AS ?basis) }
    UNION { ?artist wdt:P19 ?place . ?place wdt:P17? ?country . BIND("birth" AS ?basis) }
    ?country wdt:P297 ?iso ; rdfs:label ?countryName .
    FILTER(LANG(?countryName) = "en")
  }
} LIMIT 100`;
}

export function parseArtistOrigin(value: unknown): ArtistOrigin {
  const rows = responseSchema.parse(value).results.bindings;
  // Multiple entities attached to the same Discogs ID are ambiguous, even if one has an origin.
  const identities = new Set(rows.map((row) => row.artist.value.replace(/^http:/, 'https:')));
  if (identities.size !== 1 || rows.length >= 100) return { countries: [], sourceUrl: null };
  for (const basis of ['origin', 'formation', 'birth']) {
    const countries = [
      ...new Set(
        rows
          .filter((row) => row.basis?.value === basis)
          .flatMap((row) => (row.countryName?.value.trim() ? [row.countryName.value.trim()] : [])),
      ),
    ].sort();
    if (countries.length)
      return { countries, sourceUrl: [...identities][0]!.replace('/entity/', '/wiki/') };
  }
  return { countries: [], sourceUrl: null };
}

let chain: Promise<unknown> = Promise.resolve();
let nextAllowedAt = 0;

/** One request at a time per worker, at least one second apart, including provider cooldown. */
export function createArtistOriginApi(fetcher: typeof fetch = fetch): ArtistOriginApi {
  return {
    lookup(discogsArtistId) {
      const query = buildArtistOriginQuery(discogsArtistId);
      const run = chain.then(async () => {
        // Cooldowns belong to the durable task queue; do not hold a worker lock while waiting.
        if (nextAllowedAt > Date.now() + 1100)
          throw new ArtistOriginError(true, nextAllowedAt - Date.now());
        if (nextAllowedAt > Date.now())
          await new Promise((resolve) => setTimeout(resolve, nextAllowedAt - Date.now()));
        try {
          const url = new URL('https://query.wikidata.org/sparql');
          url.searchParams.set('query', query);
          url.searchParams.set('format', 'json');
          const response = await fetcher(url, {
            headers: {
              Accept: 'application/sparql-results+json',
              'User-Agent': getEnv().DISCOGS_USER_AGENT,
            },
            signal: AbortSignal.timeout(20_000),
          });
          if (!response.ok) {
            const delay = parseRetryAfter(response.headers.get('retry-after')) ?? 60_000;
            if (response.status === 429 || response.status === 503)
              nextAllowedAt = Date.now() + delay;
            throw new ArtistOriginError(response.status === 429 || response.status >= 500, delay);
          }
          return parseArtistOrigin(await response.json());
        } catch (error) {
          if (error instanceof ArtistOriginError) throw error;
          throw new ArtistOriginError(true);
        } finally {
          nextAllowedAt = Math.max(nextAllowedAt, Date.now() + 1100);
        }
      });
      chain = run.catch(() => undefined);
      return run;
    },
  };
}

export const artistOriginApi: ArtistOriginApi = {
  async lookup(id) {
    // All fixture runs stay offline; deterministic provider responses are injected in tests.
    if (getEnv().PROVIDERS_MODE === 'fixtures') return { countries: [], sourceUrl: null };
    return createArtistOriginApi().lookup(id);
  },
};
