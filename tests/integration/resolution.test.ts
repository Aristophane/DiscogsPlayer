/**
 * Résolution média (SPECIFICATION.md §13, §14, ADR-0006, ADR-0007).
 *
 * Aucun appel réseau réel : le client YouTube est un double contrôlable (§22.3).
 */
import { eq, inArray, sql as drizzleSql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '@/db/client';
import { discogsReleases, providerQuotaWindows, trackResolutions, users } from '@/db/schema';
import { upsertUserFromDiscogs } from '@/modules/auth/service';
import { applyReleaseDetails } from '@/modules/catalog/service';
import type { YoutubeApi, YoutubeSearchResult } from '@/modules/providers/youtube/api';
import { nextPacificMidnightUtc } from '@/modules/providers/youtube/quota';
import { resolveTrack } from '@/modules/resolution/service';

const ALICE = { id: 996_000_001, username: 'alice_resolution' };
const TOKENS = { token: 'jeton', tokenSecret: 'secret' };

const R = (n: number) => 9960000 + n;

class FakeYoutubeApi implements YoutubeApi {
  calls = 0;
  results: YoutubeSearchResult[] = [];

  async search(): Promise<YoutubeSearchResult[]> {
    this.calls += 1;
    return this.results;
  }
}

async function cleanup() {
  await db.delete(users).where(eq(users.discogsUserId, String(ALICE.id)));
  await db
    .delete(discogsReleases)
    .where(inArray(discogsReleases.discogsReleaseId, [String(R(1)), String(R(2)), String(R(3))]));
}

async function releaseWithVideo(discogsReleaseId: number, videoTitle: string | null) {
  const releaseId = await applyReleaseDetails({
    id: discogsReleaseId,
    title: `Album ${discogsReleaseId}`,
    artists: [{ id: 1, name: 'Artiste Test' }],
    tracklist: [{ position: 'A1', title: 'Première Piste', duration: '3:20', type_: 'track' }],
    videos: videoTitle
      ? [{ uri: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: videoTitle, duration: 200 }]
      : [],
  });

  const tracks = await db.execute<{ id: string }>(
    drizzleSql`select id from discogs_tracks where release_id = ${releaseId}::uuid limit 1`,
  );

  return { releaseId, trackId: tracks[0]!.id };
}

beforeEach(cleanup);

afterAll(async () => {
  await cleanup();
  await sql.end();
});

async function createUser(spotifyEnabled: 'unset' | 'yes' | 'no' = 'unset') {
  const user = await upsertUserFromDiscogs(ALICE, TOKENS);
  await db.update(users).set({ spotifyEnabled }).where(eq(users.id, user.id));
  return user.id;
}

describe('résolution par vidéo Discogs (§13.1 étape 3, gratuite)', () => {
  it('résout depuis la vidéo Discogs sans appeler YouTube', async () => {
    const userId = await createUser();
    const { trackId } = await releaseWithVideo(R(1), 'Artiste Test - Première Piste');
    const api = new FakeYoutubeApi();

    const result = await resolveTrack(userId, trackId, api);

    expect(result).toEqual({
      status: 'resolved',
      provider: 'youtube',
      videoId: 'dQw4w9WgXcQ',
      title: 'Artiste Test - Première Piste',
    });
    expect(api.calls).toBe(0);
  });

  it('met en cache la résolution : un second appel ne rejoue pas l’appariement ni la recherche', async () => {
    const userId = await createUser();
    const { trackId } = await releaseWithVideo(R(1), 'Artiste Test - Première Piste');
    const api = new FakeYoutubeApi();

    await resolveTrack(userId, trackId, api);
    const second = await resolveTrack(userId, trackId, api);

    expect(second?.status).toBe('resolved');
    expect(api.calls).toBe(0);

    const cached = await db
      .select()
      .from(trackResolutions)
      .where(eq(trackResolutions.trackId, trackId));
    expect(cached).toHaveLength(1);
  });
});

describe('repli recherche YouTube (§13.1 étape 4)', () => {
  it('cherche sur YouTube quand aucune vidéo Discogs ne correspond', async () => {
    const userId = await createUser();
    // Vidéo présente mais sans rapport avec le titre de la piste : pas d'appariement.
    const { trackId } = await releaseWithVideo(R(1), 'Artiste Test - Interview Backstage');
    const api = new FakeYoutubeApi();
    api.results = [
      { videoId: 'abc12345678', title: 'Artiste Test - Première Piste', channelTitle: null },
    ];

    const result = await resolveTrack(userId, trackId, api);

    expect(result).toEqual({
      status: 'resolved',
      provider: 'youtube',
      videoId: 'abc12345678',
      title: 'Artiste Test - Première Piste',
    });
    expect(api.calls).toBe(1);
  });

  it('écarte un résultat visiblement live pour une piste studio (§15.2)', async () => {
    const userId = await createUser();
    const { trackId } = await releaseWithVideo(R(1), null);
    const api = new FakeYoutubeApi();
    api.results = [
      { videoId: 'live1234567', title: 'Artiste Test - Première Piste (Live)', channelTitle: null },
    ];

    const result = await resolveTrack(userId, trackId, api);

    expect(result?.status).toBe('unresolved');
  });

  it('propose le lien de recherche YouTube quand rien n’est trouvé', async () => {
    const userId = await createUser();
    const { trackId } = await releaseWithVideo(R(1), null);
    const api = new FakeYoutubeApi();

    const result = await resolveTrack(userId, trackId, api);

    expect(result?.status).toBe('unresolved');
    if (result?.status === 'unresolved') {
      expect(result.youtubeSearchUrl).toContain('youtube.com/results');
      expect(result.quotaExhausted).toBe(false);
    }
  });
});

describe('repli Spotify conditionné à l’onboarding (ADR-0006)', () => {
  it('ne propose pas Spotify si l’utilisateur n’a pas indiqué de compte', async () => {
    const userId = await createUser('unset');
    const { trackId } = await releaseWithVideo(R(1), null);

    const result = await resolveTrack(userId, trackId, new FakeYoutubeApi());

    expect(result?.status).toBe('unresolved');
    if (result?.status === 'unresolved') {
      expect(result.spotifySearchUrl).toBeNull();
    }
  });

  it('propose Spotify si l’utilisateur a indiqué avoir un compte', async () => {
    const userId = await createUser('yes');
    const { trackId } = await releaseWithVideo(R(1), null);

    const result = await resolveTrack(userId, trackId, new FakeYoutubeApi());

    expect(result?.status).toBe('unresolved');
    if (result?.status === 'unresolved') {
      expect(result.spotifySearchUrl).toContain('open.spotify.com/search/');
    }
  });

  it('ne propose pas Spotify si l’utilisateur a explicitement décliné', async () => {
    const userId = await createUser('no');
    const { trackId } = await releaseWithVideo(R(1), null);

    const result = await resolveTrack(userId, trackId, new FakeYoutubeApi());

    if (result?.status === 'unresolved') {
      expect(result.spotifySearchUrl).toBeNull();
    }
  });
});

describe('quota épuisé (§6.6, ADR-0002)', () => {
  it('bascule sur le repli manuel sans planter quand la réserve est nulle', async () => {
    const userId = await createUser();
    const { trackId } = await releaseWithVideo(R(1), null);

    // Sature la fenêtre du jour pour forcer un refus de réservation. La fenêtre doit
    // coïncider exactement avec celle que `reserveUnits` calculera pour "maintenant",
    // sinon il en créerait une nouvelle, vide, et le test ne prouverait rien.
    const windowEnd = nextPacificMidnightUtc(new Date());
    const windowStart = new Date(windowEnd.getTime() - 24 * 3_600_000);
    await db
      .insert(providerQuotaWindows)
      .values({
        provider: 'youtube',
        operation: 'youtube.units',
        windowStart,
        windowEnd,
        configuredLimit: 100,
        estimatedUsed: 100,
      })
      .onConflictDoUpdate({
        target: [
          providerQuotaWindows.provider,
          providerQuotaWindows.operation,
          providerQuotaWindows.windowStart,
        ],
        // `configuredLimit` doit aussi être forcé : un test antérieur peut avoir déjà
        // créé la fenêtre du jour avec la limite par défaut (10000), et l'`upsert`
        // ne toucherait sinon jamais à cette colonne.
        set: { estimatedUsed: 100, configuredLimit: 100 },
      });

    const api = new FakeYoutubeApi();
    const result = await resolveTrack(userId, trackId, api);

    expect(result?.status).toBe('unresolved');
    if (result?.status === 'unresolved') {
      expect(result.quotaExhausted).toBe(true);
    }
    expect(api.calls).toBe(0);

    await db.delete(providerQuotaWindows).where(eq(providerQuotaWindows.windowStart, windowStart));
  });
});

describe('isolation multi-utilisateur (§18.5)', () => {
  it('la préférence Spotify d’un utilisateur n’affecte pas un autre', async () => {
    const withSpotify = await createUser('yes');

    const bob = { id: 996_000_002, username: 'bob_resolution' };
    const bobUser = await upsertUserFromDiscogs(bob, TOKENS);
    await db.update(users).set({ spotifyEnabled: 'unset' }).where(eq(users.id, bobUser.id));

    const { trackId } = await releaseWithVideo(R(1), null);

    const aliceResult = await resolveTrack(withSpotify, trackId, new FakeYoutubeApi());
    const bobResult = await resolveTrack(bobUser.id, trackId, new FakeYoutubeApi());

    if (aliceResult?.status === 'unresolved') {
      expect(aliceResult.spotifySearchUrl).not.toBeNull();
    }
    if (bobResult?.status === 'unresolved') {
      expect(bobResult.spotifySearchUrl).toBeNull();
    }

    await db.delete(users).where(eq(users.discogsUserId, String(bob.id)));
  });
});
