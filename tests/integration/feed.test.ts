import { createHash } from 'node:crypto';
import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, sql } from '@/db/client';
import {
  collectionInstances,
  collectionShares,
  discogsArtists,
  discogsReleaseArtists,
  discogsReleases,
  feedEditions,
  feedPosts,
  feedSourceCache,
  tasks,
  users,
} from '@/db/schema';
import {
  enrichDailyFeed,
  ensureDailyFeed,
  getFeedPage,
  wikipediaStoryKey,
} from '@/modules/feed/service';
import { getCollectionMarketOverview } from '@/modules/collection/service';
import type { FeedContent, SourceStory } from '@/modules/feed/contracts';

const NOW = new Date('2026-10-17T12:00:00Z');
const DAY = '2026-10-17';
const USER_IDS = ['test-feed-own', 'test-feed-friend', 'test-feed-private'];
const RELEASE_IDS = Array.from({ length: 24 }, (_, n) => `test-feed-${n}`);
let own: string;
let friend: string;
let stranger: string;
let releaseIds: string[];

async function cleanup() {
  const accounts = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.discogsUserId, USER_IDS));
  for (const { id } of accounts)
    await db.delete(tasks).where(like(tasks.dedupeKey, `feed:${id}:%`));
  await db.delete(users).where(inArray(users.discogsUserId, USER_IDS));
  await db.delete(discogsReleases).where(inArray(discogsReleases.discogsReleaseId, RELEASE_IDS));
  await db.delete(discogsArtists).where(eq(discogsArtists.discogsArtistId, '997740001'));
  await db
    .delete(feedSourceCache)
    .where(
      inArray(feedSourceCache.key, [
        'wiki:artist:997740001',
        'wiki:album:997740002',
        'wiki:v2:artist:997740001',
        'wiki:v2:album:997740002',
        'music-news',
      ]),
    );
}

beforeEach(async () => {
  await cleanup();
  const accounts = await db
    .insert(users)
    .values(USER_IDS.map((id) => ({ discogsUserId: id, discogsUsername: id })))
    .returning();
  [own, friend, stranger] = accounts.map(({ id }) => id) as [string, string, string];
  await db.insert(collectionShares).values({ ownerId: friend, granteeId: own });
  const releases = await db
    .insert(discogsReleases)
    .values(
      RELEASE_IDS.map((id, n) => ({
        discogsReleaseId: id,
        title: `Disque ${n}`,
        artistsText: 'Artiste Exemple',
        masterId: '997740002',
        communityHave: n + 1,
        communityWant: n * 2,
        lowestPriceEur: '10.00',
        numForSale: 2,
      })),
    )
    .returning();
  releaseIds = releases.map(({ id }) => id);
  await db.insert(collectionInstances).values(
    releaseIds.map((id, n) => ({
      userId: n < 8 ? own : n < 20 ? friend : stranger,
      releaseId: id,
      discogsInstanceId: `test-feed-instance-${n}`,
      dateAdded: new Date('2026-10-16T12:00:00Z'),
    })),
  );
  const [artist] = await db
    .insert(discogsArtists)
    .values({
      discogsArtistId: '997740001',
      name: 'Artiste Exemple',
      nameNormalized: 'artiste exemple',
    })
    .returning();
  await db
    .insert(discogsReleaseArtists)
    .values(releaseIds.map((id) => ({ releaseId: id, artistId: artist!.id, position: 0 })));
});

afterAll(async () => {
  await cleanup();
  await sql.end();
});

function story(kind: SourceStory['kind']): SourceStory {
  return {
    kind,
    title: kind === 'news' ? 'Artiste Exemple annonce un concert' : 'Histoire de test',
    text:
      kind === 'artist'
        ? 'Le nom du groupe est né d’une plaisanterie entre les musiciens. Un ami avait mal compris leur ancien nom sur une affiche et ce surnom inattendu finit par remplacer le nom officiel.'
        : kind === 'album'
          ? 'Pendant l’enregistrement du disque, une panne de courant interrompt la séance. Le groupe décide de conserver le bruit de cet accident sur la bande et en fait le début du morceau.'
          : 'Un extrait sourcé de test. '.repeat(12),
    sourceName: kind === 'news' ? 'Presse test' : 'Wikipédia',
    sourceUrl: `https://fr.wikipedia.org/wiki/Test_feed_${kind}`,
    language: 'fr',
    publishedAt: null,
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  };
}
const sources = () => ({
  wikipedia: vi.fn(async ({ kind }: { kind: 'album' | 'artist'; id: string }) => [story(kind)]),
  news: vi.fn(async () => [story('news')]),
});

describe('fil quotidien personnel', () => {
  it('reconnaît un récit historique malgré son ancienne clé et un nouveau permalien', async () => {
    const previousDay = '2026-10-16';
    const legacyStory: SourceStory = {
      ...story('artist'),
      sourceUrl: 'https://fr.wikipedia.org/w/index.php?title=Test_feed_artist&oldid=123',
    };
    const legacyContent: FeedContent = {
      kind: 'artist',
      title: 'Disque 0',
      artists: 'Artiste Exemple',
      coverUrl: null,
      year: null,
      ownerUsername: null,
      addedAt: null,
      story: legacyStory,
      statistic: null,
    };
    const [previousEdition] = await db
      .insert(feedEditions)
      .values({ userId: own, day: previousDay, status: 'ready', editorialVersion: 0 })
      .returning();
    const [legacyPost] = await db
      .insert(feedPosts)
      .values({
        editionId: previousEdition!.id,
        userId: own,
        ownerId: own,
        discogsReleaseId: RELEASE_IDS[0]!,
        day: previousDay,
        position: 0,
        contentKey: `story:${createHash('sha256')
          .update(legacyStory.sourceUrl + legacyStory.text)
          .digest('hex')
          .slice(0, 32)}`,
        content: legacyContent,
      })
      .returning();

    await ensureDailyFeed(own, NOW);
    await enrichDailyFeed(own, DAY, sources(), NOW);
    const page = await getFeedPage(own, undefined, NOW, 100);
    const artistStories = page.items.filter(({ kind }) => kind === 'artist');
    expect(artistStories).toHaveLength(1);
    expect(artistStories[0]!.id).toBe(legacyPost!.id);
    expect(artistStories[0]!.day).toBe(previousDay);
    expect(artistStories[0]!.story!.text).toBe(legacyStory.text);
    expect(page.items.some(({ kind, day }) => kind === 'album' && day === DAY)).toBe(true);
  });

  it('reprend une édition déjà insérée sans ajouter une deuxième anecdote du même sujet', async () => {
    const alternate: SourceStory = {
      ...story('artist'),
      text: 'Pour la pochette du disque, le photographe veut saisir un oiseau devant le studio. Par hasard, un chien entre dans le cadre et le groupe décide de garder cette photo inattendue.',
    };
    const api = sources();
    api.wikipedia.mockImplementation(async ({ kind }) =>
      kind === 'artist' ? [story(kind), alternate] : [story(kind)],
    );
    await ensureDailyFeed(own, NOW);
    await enrichDailyFeed(own, DAY, api, NOW);
    const before = await getFeedPage(own, undefined, NOW, 100);
    const artistStories = before.items.filter(({ kind }) => kind === 'artist');
    expect(artistStories).toHaveLength(1);

    // Simule une interruption après l’insertion des cartes, avant la validation de l’édition.
    await db
      .update(feedEditions)
      .set({ status: 'pending', editorialVersion: 0 })
      .where(eq(feedEditions.userId, own));
    await enrichDailyFeed(own, DAY, api, NOW);
    const after = await getFeedPage(own, undefined, NOW, 100);
    expect(after.status).toBe('ready');
    expect(after.items.map(({ id }) => id)).toEqual(before.items.map(({ id }) => id));
    expect(after.items.filter(({ kind }) => kind === 'artist')).toHaveLength(1);
    expect(api.wikipedia).toHaveBeenCalledTimes(2);
  });

  it('met à niveau l’édition courante et ignore les anciens extraits en cache sans déplacer les publications', async () => {
    await ensureDailyFeed(own, NOW);
    await db
      .update(feedEditions)
      .set({ status: 'ready', editorialVersion: 0 })
      .where(eq(feedEditions.userId, own));
    await db.insert(feedSourceCache).values({
      key: 'wiki:artist:997740001',
      content: [
        {
          ...story('artist'),
          text: 'Une biographie générale sans histoire particulière. '.repeat(5),
        },
      ],
      expiresAt: new Date(NOW.getTime() + 30 * 86_400_000),
    });
    const before = await getFeedPage(own, undefined, NOW);
    await ensureDailyFeed(own, NOW);
    expect((await getFeedPage(own, undefined, NOW)).status).toBe('pending');
    const api = sources();
    await enrichDailyFeed(own, DAY, api, NOW);
    const after = await getFeedPage(own, undefined, NOW);
    expect(after.status).toBe('ready');
    expect(after.items.slice(0, before.items.length).map(({ id }) => id)).toEqual(
      before.items.map(({ id }) => id),
    );
    expect(api.wikipedia).toHaveBeenCalledWith({ kind: 'artist', id: '997740001' });
    expect(
      after.items
        .filter(({ kind }) => kind === 'artist' || kind === 'album')
        .every(({ story }) => story?.editorial?.score && story.editorial.score >= 26),
    ).toBe(true);
    await ensureDailyFeed(own, NOW);
    expect((await getFeedPage(own, undefined, NOW)).status).toBe('ready');
  });

  it('fait tourner les anecdotes inédites du cache et ignore un changement de révision seul', async () => {
    const second = {
      ...story('artist'),
      text: 'Pour la pochette du disque, le photographe veut saisir un oiseau devant le studio. Par hasard, un chien entre dans le cadre et le groupe décide de garder cette photo inattendue.',
    };
    const api = sources();
    api.wikipedia.mockImplementation(async ({ kind }) =>
      kind === 'artist' ? [story(kind), second] : [story(kind)],
    );
    await ensureDailyFeed(own, NOW);
    await enrichDailyFeed(own, DAY, api, NOW);
    const first = (await getFeedPage(own, undefined, NOW, 100)).items.filter(
      ({ kind }) => kind === 'artist',
    );
    expect(first).toHaveLength(1);
    const tomorrow = new Date('2026-10-18T12:00:00Z');
    await ensureDailyFeed(own, tomorrow);
    await enrichDailyFeed(own, '2026-10-18', api, tomorrow);
    const next = (await getFeedPage(own, undefined, tomorrow, 100)).items.filter(
      ({ day, kind }) => day === '2026-10-18' && kind === 'artist',
    );
    expect(next).toHaveLength(1);
    expect(next[0]!.story!.text).not.toBe(first[0]!.story!.text);
    expect(api.wikipedia).toHaveBeenCalledTimes(2);
    expect(
      wikipediaStoryKey({
        ...story('artist'),
        sourceUrl: 'https://fr.wikipedia.org/w/index.php?title=Artiste_Test&oldid=1',
      }),
    ).toBe(
      wikipediaStoryKey({
        ...story('artist'),
        sourceUrl: 'https://fr.wikipedia.org/wiki/Artiste_Test?oldid=999',
      }),
    );
  });

  it('écarte une biographie ordinaire et conserve uniquement les récits qui dépassent le seuil', async () => {
    await ensureDailyFeed(own, NOW);
    const api = sources();
    api.wikipedia.mockImplementation(async ({ kind }) => [
      {
        ...story(kind),
        text: 'Cet artiste est un chanteur français né le 12 juin 1950 à Paris. Son premier album paraît en 1980, suivi par un deuxième en 1981 et un troisième en 1982.',
      },
    ]);
    await enrichDailyFeed(own, DAY, api, NOW);
    const page = await getFeedPage(own, undefined, NOW, 100);
    expect(page.items.some(({ kind }) => kind === 'album' || kind === 'artist')).toBe(false);
    expect(page.items.some(({ kind }) => kind === 'listen')).toBe(true);
    expect(page.status).toBe('ready');
  });
  it('conserve la sélection et ses identifiants au rechargement et ne révèle aucune collection privée', async () => {
    await Promise.all([ensureDailyFeed(own, NOW), ensureDailyFeed(own, NOW)]);
    const first = await getFeedPage(own, undefined, NOW);
    await ensureDailyFeed(own, NOW);
    expect((await getFeedPage(own, undefined, NOW)).items).toEqual(first.items);
    expect(first.items.length).toBeGreaterThan(0);
    expect(first.items.every(({ ownerId }) => [own, friend].includes(ownerId))).toBe(true);
    expect(await db.select().from(feedEditions).where(eq(feedEditions.userId, own))).toHaveLength(
      1,
    );
    expect(
      await db
        .select()
        .from(tasks)
        .where(eq(tasks.dedupeKey, `feed:${own}:${DAY}`)),
    ).toHaveLength(1);
    expect((await getFeedPage(stranger, undefined, NOW)).items).toEqual([]);
  });

  it('ajoute les sources sans déplacer les cartes locales, les met en cache et déduplique les actualités', async () => {
    await ensureDailyFeed(own, NOW);
    const before = await getFeedPage(own, undefined, NOW);
    const api = sources();
    await enrichDailyFeed(own, DAY, api, NOW);
    const page = await getFeedPage(own, undefined, NOW);
    expect(page.items.slice(0, before.items.length).map(({ id }) => id)).toEqual(
      before.items.map(({ id }) => id),
    );
    expect(page.items.some(({ story }) => story?.kind === 'news')).toBe(true);
    expect(page.status).toBe('ready');
    await ensureDailyFeed(friend, NOW);
    await enrichDailyFeed(friend, DAY, api, NOW);
    expect(api.wikipedia).toHaveBeenCalledTimes(2);
    expect(api.news).toHaveBeenCalledTimes(1);
  });

  it('parcourt plusieurs journées sans doublon et retire immédiatement les partages révoqués et éditions retirées', async () => {
    for (const day of ['2026-10-15', '2026-10-16', DAY]) {
      const now = new Date(`${day}T12:00:00Z`);
      await ensureDailyFeed(own, now);
      await enrichDailyFeed(own, day, sources(), now);
    }
    const all = [];
    let cursor: string | undefined;
    do {
      const page = await getFeedPage(own, cursor, NOW);
      all.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(all.length).toBeGreaterThan(12);
    expect(new Set(all.map(({ id }) => id)).size).toBe(all.length);
    expect(all.filter(({ kind }) => kind === 'news')).toHaveLength(1);
    await db
      .update(collectionShares)
      .set({ revokedAt: NOW })
      .where(eq(collectionShares.ownerId, friend));
    await db
      .update(collectionInstances)
      .set({ isActive: false })
      .where(eq(collectionInstances.releaseId, releaseIds[0]!));
    const visible = await getFeedPage(own, undefined, NOW);
    expect(visible.items.every(({ ownerId }) => ownerId === own)).toBe(true);
    expect(visible.items.some(({ discogsReleaseId }) => discogsReleaseId === RELEASE_IDS[0])).toBe(
      false,
    );
  });

  it('conserve les suggestions pendant une panne et refuse un curseur invalide', async () => {
    await ensureDailyFeed(own, NOW);
    const failing = {
      wikipedia: vi.fn(async () => {
        throw new Error('source en panne');
      }),
      news: vi.fn(async () => {
        throw new Error('source en panne');
      }),
    };
    await enrichDailyFeed(own, DAY, failing, NOW);
    const page = await getFeedPage(own, undefined, NOW);
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.status).toBe('partial');
    await expect(getFeedPage(own, 'invalide', NOW)).rejects.toMatchObject({ status: 400 });
  });

  it('calcule le repère des prix sur les exemplaires et distingue les prix absents', async () => {
    await db.insert(collectionInstances).values({
      userId: own,
      releaseId: releaseIds[0]!,
      discogsInstanceId: 'test-feed-extra-copy',
    });
    await db
      .update(discogsReleases)
      .set({ numForSale: 0 })
      .where(eq(discogsReleases.id, releaseIds[1]!));
    const summary = await getCollectionMarketOverview(own);
    expect(summary).toMatchObject({ editions: 8, copies: 9, priced: 7 });
    expect(Number(summary.total)).toBe(80);
    expect(summary.rarest[0]?.discogsReleaseId).toBe(RELEASE_IDS[0]);
  });
});
