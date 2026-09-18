import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { discogsArtists } from '@/db/schema';
import type { ArtistOrigin } from '@/modules/providers/wikidata/artist-origin';

export async function artistOriginIsFresh(discogsArtistId: string): Promise<boolean> {
  const [artist] = await db
    .select({ checkedAt: discogsArtists.originCheckedAt })
    .from(discogsArtists)
    .where(eq(discogsArtists.discogsArtistId, discogsArtistId))
    .limit(1);
  return !!artist?.checkedAt && artist.checkedAt.getTime() > Date.now() - 30 * 86_400_000;
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
      originNextCheckAt: new Date(now.getTime() + 30 * 86_400_000),
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
    .set({ originNextCheckAt: new Date(Date.now() + Math.max(3_600_000, delayMs)) })
    .where(eq(discogsArtists.discogsArtistId, discogsArtistId));
}
