/**
 * Mode Radio (ADR-0006 points 2 et 3).
 *
 * Aucun appel réseau réel : le client YouTube est un double contrôlable (§22.3).
 */
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '@/db/client';
import {
  collectionInstances,
  discogsReleases,
  radioSessionTracks,
  radioSessions,
  users,
} from '@/db/schema';
import { upsertUserFromDiscogs } from '@/modules/auth/service';
import { applyReleaseDetails } from '@/modules/catalog/service';
import type { YoutubeApi, YoutubeSearchResult } from '@/modules/providers/youtube/api';
import { createSession, draw, getActiveSession } from '@/modules/radio/service';

const ALICE = { id: 998_000_001, username: 'alice_radio' };
const TOKENS = { token: 'jeton', tokenSecret: 'secret' };

const R = (n: number) => 9980000 + n;

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
  await db.delete(discogsReleases).where(
    inArray(
      discogsReleases.discogsReleaseId,
      Array.from({ length: 10 }, (_, i) => String(R(i + 1))),
    ),
  );
}

/** Une édition avec `trackCount` pistes ; `withVideo` apparie la première par titre. */
async function seedRelease(params: {
  n: number;
  userId: string;
  genre: string;
  trackCount: number;
  withVideo: boolean;
}) {
  const tracks = Array.from({ length: params.trackCount }, (_, i) => ({
    position: `A${i + 1}`,
    title: `Piste ${params.n}-${i + 1}`,
    duration: '3:00',
    type_: 'track',
  }));

  const releaseId = await applyReleaseDetails({
    id: R(params.n),
    title: `Album ${params.n}`,
    genres: [params.genre],
    artists: [{ id: params.n, name: `Artiste ${params.n}` }],
    tracklist: tracks,
    videos: params.withVideo
      ? [
          {
            // Un identifiant YouTube fait exactement 11 caractères (§13.5) : un faux id
            // trop court serait rejeté par `youtubeIdFromUrl` et retomberait, à tort,
            // sur la recherche — piège rencontré en écrivant ce test.
            uri: `https://www.youtube.com/watch?v=vid${String(params.n).padStart(8, '0')}`,
            title: `Artiste ${params.n} - ${tracks[0]!.title}`,
            duration: 180,
          },
        ]
      : [],
  });

  await db.insert(collectionInstances).values({
    userId: params.userId,
    releaseId,
    discogsInstanceId: `998${params.n}0001`,
    isActive: true,
  });

  return releaseId;
}

let aliceId: string;

beforeEach(async () => {
  await cleanup();
  aliceId = (await upsertUserFromDiscogs(ALICE, TOKENS)).id;
});

afterAll(async () => {
  await cleanup();
  await sql.end();
});

describe('priorité aux pistes déjà résolues (ADR-0006 point 3)', () => {
  it('tire une piste appariée à une vidéo Discogs sans appeler YouTube', async () => {
    await seedRelease({ n: 1, userId: aliceId, genre: 'Rock', trackCount: 1, withVideo: true });
    const session = await createSession(aliceId, aliceId, {});
    const api = new FakeYoutubeApi();

    const result = await draw(aliceId, session.id, api);

    expect(result.status).toBe('track');
    if (result.status === 'track') {
      expect(result.playback).toMatchObject({ status: 'resolved', provider: 'youtube' });
    }
    expect(api.calls).toBe(0);
  });

  it('passe par la recherche seulement pour les éditions sans vidéo', async () => {
    await seedRelease({ n: 1, userId: aliceId, genre: 'Rock', trackCount: 1, withVideo: false });
    const session = await createSession(aliceId, aliceId, {});
    const api = new FakeYoutubeApi();
    api.results = [{ videoId: 'abc12345678', title: 'Artiste 1 - Piste 1-1', channelTitle: null }];

    const result = await draw(aliceId, session.id, api);

    expect(result.status).toBe('track');
    expect(api.calls).toBe(1);
  });
});

describe('absence de répétition dans une session', () => {
  it('ne tire jamais deux fois la même piste', async () => {
    for (let n = 1; n <= 3; n += 1) {
      await seedRelease({ n, userId: aliceId, genre: 'Rock', trackCount: 2, withVideo: true });
    }
    const session = await createSession(aliceId, aliceId, {});
    const api = new FakeYoutubeApi();

    const drawn: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const result = await draw(aliceId, session.id, api);
      expect(result.status).toBe('track');
      if (result.status === 'track') {
        drawn.push(result.trackId);
      }
    }

    expect(new Set(drawn).size).toBe(6);
  });

  it('se termine et propose de recommencer une fois toutes les pistes vues', async () => {
    await seedRelease({ n: 1, userId: aliceId, genre: 'Rock', trackCount: 1, withVideo: true });
    const session = await createSession(aliceId, aliceId, {});
    const api = new FakeYoutubeApi();

    await draw(aliceId, session.id, api);
    const exhausted = await draw(aliceId, session.id, api);

    expect(exhausted).toEqual({ status: 'exhausted' });
    expect(await getActiveSession(aliceId)).toBeNull();
  });

  it('avec une seule piste jamais résolue, s’épuise dans le même appel plutôt que de boucler', async () => {
    // Le tirage retente en interne jusqu'à épuisement du bassin : avec une seule piste,
    // l'échec de la tentative 0 et la disparition du bassin à la tentative 1 se produisent
    // tous deux dans ce même appel — pas la peine d'un second `draw()` pour le constater.
    await seedRelease({ n: 1, userId: aliceId, genre: 'Rock', trackCount: 1, withVideo: false });
    const session = await createSession(aliceId, aliceId, {});
    const api = new FakeYoutubeApi();
    api.results = [];

    expect(await draw(aliceId, session.id, api)).toEqual({ status: 'exhausted' });
  });

  it('avec plusieurs pistes toutes irrésolues, s’arrête à la borne de tentatives (« unavailable »)', async () => {
    // Plus de pistes que la borne de tentatives par tirage : la boucle abandonne avant
    // d'épuiser le bassin, ce qui doit produire « unavailable » (quota probable), pas
    // « exhausted » (qui signifierait qu'il ne reste plus rien à essayer).
    for (let n = 1; n <= 8; n += 1) {
      await seedRelease({ n, userId: aliceId, genre: 'Rock', trackCount: 1, withVideo: false });
    }
    const session = await createSession(aliceId, aliceId, {});
    const api = new FakeYoutubeApi();
    api.results = [];

    expect(await draw(aliceId, session.id, api)).toEqual({ status: 'unavailable' });
  });
});

describe('filtres Genre et Style', () => {
  it('ne tire que dans le périmètre filtré', async () => {
    await seedRelease({ n: 1, userId: aliceId, genre: 'Rock', trackCount: 1, withVideo: true });
    await seedRelease({ n: 2, userId: aliceId, genre: 'Jazz', trackCount: 1, withVideo: true });

    const session = await createSession(aliceId, aliceId, { genres: ['Jazz'] });
    const api = new FakeYoutubeApi();

    const first = await draw(aliceId, session.id, api);
    const second = await draw(aliceId, session.id, api);

    expect(first.status).toBe('track');
    // Une seule piste Jazz : le second tirage est épuisé, jamais la piste Rock.
    expect(second).toEqual({ status: 'exhausted' });
  });
});

describe('gestion des sessions', () => {
  it('n’autorise qu’une seule radio active par utilisateur', async () => {
    await seedRelease({ n: 1, userId: aliceId, genre: 'Rock', trackCount: 1, withVideo: true });

    const first = await createSession(aliceId, aliceId, {});
    const second = await createSession(aliceId, aliceId, { genres: ['Jazz'] });

    expect(second.id).not.toBe(first.id);

    const active = await db.select().from(radioSessions).where(eq(radioSessions.userId, aliceId));
    expect(active.filter((row) => row.completedAt === null)).toHaveLength(1);
  });

  it('refuse de tirer dans la radio d’un autre utilisateur (§18.5)', async () => {
    await seedRelease({ n: 1, userId: aliceId, genre: 'Rock', trackCount: 1, withVideo: true });
    const session = await createSession(aliceId, aliceId, {});

    const bob = await upsertUserFromDiscogs({ id: 998_000_002, username: 'bob_radio' }, TOKENS);

    expect(await draw(bob.id, session.id, new FakeYoutubeApi())).toEqual({ status: 'exhausted' });

    await db.delete(users).where(eq(users.discogsUserId, '998000002'));
  });

  it('trace les pistes jouées avec un ordre croissant', async () => {
    for (let n = 1; n <= 2; n += 1) {
      await seedRelease({ n, userId: aliceId, genre: 'Rock', trackCount: 1, withVideo: true });
    }
    const session = await createSession(aliceId, aliceId, {});
    const api = new FakeYoutubeApi();

    await draw(aliceId, session.id, api);
    await draw(aliceId, session.id, api);

    const history = await db
      .select()
      .from(radioSessionTracks)
      .where(eq(radioSessionTracks.sessionId, session.id))
      .orderBy(radioSessionTracks.playOrder);

    expect(history.map((row) => row.playOrder)).toEqual([1, 2]);
    expect(history.every((row) => row.resolved)).toBe(true);
  });
});

describe('relance et historique récent (demande produit)', () => {
  it('évite de rouvrir sur le titre qui a démarré la session précédente', async () => {
    // Une seule piste appariée par vidéo (groupe « déjà résolue ») : sans exclusion de
    // l'historique récent, le tri `(exists resolution) desc, random()` la choisirait
    // systématiquement en premier — `random()` n'a aucun effet sur un groupe à un seul
    // élément. C'est exactement le défaut signalé.
    await seedRelease({ n: 1, userId: aliceId, genre: 'Rock', trackCount: 1, withVideo: true });
    for (let n = 2; n <= 6; n += 1) {
      await seedRelease({ n, userId: aliceId, genre: 'Rock', trackCount: 1, withVideo: false });
    }
    const api = new FakeYoutubeApi();
    api.results = [{ videoId: 'abc12345678', title: 'x', channelTitle: null }];

    const first = await createSession(aliceId, aliceId, {});
    const firstDraw = await draw(aliceId, first.id, api);
    expect(firstDraw.status).toBe('track');

    // Relancer la radio ferme la session active et en ouvre une nouvelle, vide : rien
    // dans *cette* session n'exclut plus la piste tirée juste avant.
    const second = await createSession(aliceId, aliceId, {});
    const secondDraw = await draw(aliceId, second.id, api);
    expect(secondDraw.status).toBe('track');

    if (firstDraw.status === 'track' && secondDraw.status === 'track') {
      expect(secondDraw.trackId).not.toBe(firstDraw.trackId);
    }
  });

  it('rejoue quand même l’historique récent si le périmètre filtré ne laisse rien d’autre', async () => {
    // « Dans la mesure du possible » (demande produit) : une seule piste éligible au
    // total ne doit jamais se solder par un épuisement à tort.
    await seedRelease({ n: 1, userId: aliceId, genre: 'Rock', trackCount: 1, withVideo: true });
    const api = new FakeYoutubeApi();

    const first = await createSession(aliceId, aliceId, {});
    await draw(aliceId, first.id, api);

    const second = await createSession(aliceId, aliceId, {});
    const result = await draw(aliceId, second.id, api);

    expect(result.status).toBe('track');
  });
});
