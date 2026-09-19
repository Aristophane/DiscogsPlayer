import { eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { discogsArtists } from '@/db/schema';
import type { ArtistOrigin } from '@/modules/providers/wikidata/artist-origin';

export async function artistOriginIsFresh(discogsArtistId: string): Promise<boolean> {
  const [artist] = await db
    .select({
      checkedAt: discogsArtists.originCheckedAt,
      countries: discogsArtists.originCountries,
      version: discogsArtists.originLookupVersion,
    })
    .from(discogsArtists)
    .where(eq(discogsArtists.discogsArtistId, discogsArtistId))
    .limit(1);
  if (!artist?.checkedAt) return false;
  if (!artist.countries.length && artist.version < 2) return false;
  return artist.checkedAt.getTime() > Date.now() - (artist.countries.length ? 30 : 1) * 86_400_000;
}

export async function saveArtistOrigin(
  discogsArtistId: string,
  origin: ArtistOrigin,
): Promise<void> {
  const now = new Date();
  await db
    .update(discogsArtists)
    .set({
      originCountries: origin.countries,
      originSourceUrl: origin.sourceUrl,
      originCheckedAt: now,
      originLookupVersion: 2,
      originNextCheckAt: new Date(now.getTime() + (origin.countries.length ? 30 : 1) * 86_400_000),
    })
    .where(eq(discogsArtists.discogsArtistId, discogsArtistId));
}

/** Preserve previous results on outage; avoid enqueueing a new failed batch on every visit. */
export async function postponeArtistOrigin(
  discogsArtistId: string,
  delayMs: number,
): Promise<void> {
  await db
    .update(discogsArtists)
    .set({
      originNextCheckAt: new Date(Date.now() + Math.max(3_600_000, delayMs)),
      originLookupVersion: 2,
      originCheckedAt: sql`case when cardinality(${discogsArtists.originCountries}) = 0 then null else ${discogsArtists.originCheckedAt} end`,
    })
    .where(eq(discogsArtists.discogsArtistId, discogsArtistId));
}
