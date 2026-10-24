import { createHash } from 'node:crypto';
import { and, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { feedEditions, feedPosts, feedSourceCache } from '@/db/schema';
import { ApiError } from '@/lib/api-error';
import { moduleLogger } from '@/lib/logger';
import { listCollectionSyncUserIds } from '@/modules/auth/service';
import { listFeedCandidates, visibleFeedReleases } from '@/modules/collection/service';
import { listGrantsReceivedBy } from '@/modules/sharing/service';
import { enqueue } from '@/modules/sync/queue';
import {
  feedContentSchema,
  feedCursorSchema,
  feedDay,
  sourceStorySchema,
  type FeedContent,
  type FeedPage,
  type SourceStory,
} from './contracts';
import { fetchMusicNews, fetchWikipediaStory, newsMentionsArtist, plainText } from './sources';
import { ANECDOTE_VERSION, MIN_ANECDOTE_SCORE, selectWikipediaAnecdotes } from './anecdotes';

export const TASK_REFRESH_FEED = 'feed.refresh_daily';
const PAGE_SIZE = 12;
const DAY_MS = 86_400_000;
// Storage positions stay immutable; this separate display order puts stories first.
const displayRank = sql<number>`case ${feedPosts.content}->>'kind'
  when 'artist' then 0 when 'album' then 0 when 'news' then 1
  when 'addition' then 2 when 'listen' then 3 else 4 end`;
// Apply the same limits to old editions, without deleting history or changing IDs.
const displayEligible = sql`case ${feedPosts.content}->>'kind'
  when 'listen' then not exists (
    select 1 from feed_posts prior where prior.user_id = ${feedPosts.userId}
    and prior.content->>'kind' = 'listen'
    and ((prior.day = ${feedPosts.day} and prior.position < ${feedPosts.position})
      or (prior.day < ${feedPosts.day} and prior.day >= (${feedPosts.day}::date - 14)::text
        and (prior.content->>'artists' = ${feedPosts.content}->>'artists'
          or prior.discogs_release_id = ${feedPosts.discogsReleaseId}))))
  when 'stat' then not exists (
    select 1 from feed_posts prior where prior.user_id = ${feedPosts.userId}
    and prior.content->>'kind' = 'stat'
    and ((prior.day = ${feedPosts.day} and prior.position < ${feedPosts.position})
      or (prior.day < ${feedPosts.day} and prior.day > (${feedPosts.day}::date - 7)::text)))
  when 'addition' then (
    not exists (select 1 from feed_posts prior where prior.user_id = ${feedPosts.userId}
      and prior.day = ${feedPosts.day} and prior.content->>'kind' = 'addition'
      and prior.content->>'artists' = ${feedPosts.content}->>'artists'
      and prior.position < ${feedPosts.position})
    and (select count(distinct prior.content->>'artists') from feed_posts prior
      where prior.user_id = ${feedPosts.userId} and prior.day = ${feedPosts.day}
      and prior.content->>'kind' = 'addition' and prior.position <= ${feedPosts.position}) <= 2)
  when 'news' then not exists (
    select 1 from feed_posts prior where prior.user_id = ${feedPosts.userId}
    and prior.day = ${feedPosts.day} and prior.content->>'kind' = 'news'
    and prior.content->>'artists' = ${feedPosts.content}->>'artists'
    and ((prior.content->'story'->>'language' = 'fr' and ${feedPosts.content}->'story'->>'language' <> 'fr')
      or (prior.content->'story'->>'language' = ${feedPosts.content}->'story'->>'language'
        and prior.position < ${feedPosts.position})))
  else true end`;
const log = moduleLogger('feed');
type Candidate = Awaited<ReturnType<typeof listFeedCandidates>>[number];
const artistRefsSchema = z.array(
  z.object({ id: z.string().regex(/^[1-9]\d*$/), name: z.string() }),
);
const digest = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32);

/** Keep identity stable when a source adds a new revision or citation number. */
function wikipediaArticleKey(story: SourceStory): string {
  const url = new URL(story.sourceUrl);
  const article =
    url.searchParams.get('title') ?? decodeURIComponent(url.pathname.replace(/^\/wiki\//, ''));
  return `${url.origin}:${article.replaceAll('_', ' ')}`;
}

export function wikipediaStoryKey(story: SourceStory): string {
  const text = story.text
    .normalize('NFKC')
    .replace(/\[\d+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();
  return `story:${digest(`${wikipediaArticleKey(story)}:${text}`)}`;
}

function curatedStory(story: SourceStory): SourceStory | null {
  if (story.kind === 'news')
    return { ...story, title: plainText(story.title), text: plainText(story.text) };
  if (story.editorial?.version === ANECDOTE_VERSION)
    return story.editorial.score >= MIN_ANECDOTE_SCORE ? story : null;
  const anecdote = selectWikipediaAnecdotes(story.text, story.kind, story.language)[0];
  return anecdote
    ? {
        ...story,
        text: anecdote.text,
        editorial: {
          version: ANECDOTE_VERSION,
          score: anecdote.score,
          topic: anecdote.topic,
          section: anecdote.section,
        },
      }
    : null;
}

async function scope(userId: string) {
  const grants = await listGrantsReceivedBy(userId);
  return {
    ownerIds: [userId, ...grants.map(({ ownerId }) => ownerId)],
    names: new Map(grants.map(({ ownerId, ownerUsername }) => [ownerId, ownerUsername])),
  };
}

function content(
  candidate: Candidate,
  names: Map<string, string>,
  kind: FeedContent['kind'],
  metric: 'price' | 'rating' = 'price',
): FeedContent {
  return feedContentSchema.parse({
    kind,
    title: candidate.title,
    artists: candidate.artists,
    coverUrl: candidate.coverUrl,
    year: candidate.year,
    ownerUsername: names.get(candidate.ownerId) ?? null,
    addedAt: candidate.addedAt ? new Date(candidate.addedAt).toISOString() : null,
    story: null,
    statistic:
      kind === 'stat'
        ? {
            price: candidate.price,
            have: candidate.have,
            want: candidate.want,
            metric,
            rating: candidate.rating,
            ratingCount: candidate.ratingCount,
          }
        : null,
  });
}

async function appendPosts(
  userId: string,
  day: string,
  records: { candidate: Candidate; content: FeedContent; key: string }[],
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`feed:${userId}:${day}`}))`);
    const [edition] = await tx
      .select()
      .from(feedEditions)
      .where(and(eq(feedEditions.userId, userId), eq(feedEditions.day, day)))
      .limit(1);
    if (!edition) return;
    const [last] = await tx
      .select({ position: feedPosts.position })
      .from(feedPosts)
      .where(eq(feedPosts.editionId, edition.id))
      .orderBy(sql`${feedPosts.position} desc`)
      .limit(1);
    let position = (last?.position ?? -1) + 1;
    const existing = await tx
      .select({ content: feedPosts.content })
      .from(feedPosts)
      .where(eq(feedPosts.editionId, edition.id));
    const published = existing.flatMap(({ content }) => {
      const parsed = feedContentSchema.safeParse(content);
      if (
        !parsed.success ||
        !parsed.data.story ||
        parsed.data.story.sourceName !== 'Wikipédia' ||
        parsed.data.story.kind === 'news'
      )
        return [];
      const story = curatedStory(parsed.data.story);
      return story ? [story] : [];
    });
    const publishedArticles = new Set(published.map(wikipediaArticleKey));
    let anecdoteCount = published.length;
    for (const record of records) {
      const story = record.content.story;
      const isAnecdote = !!story?.editorial && story.kind !== 'news';
      if (isAnecdote && (anecdoteCount >= 4 || publishedArticles.has(wikipediaArticleKey(story))))
        continue;
      const inserted = await tx
        .insert(feedPosts)
        .values({
          editionId: edition.id,
          userId,
          ownerId: record.candidate.ownerId,
          discogsReleaseId: record.candidate.discogsReleaseId,
          day,
          position: position++,
          contentKey: record.key,
          content: feedContentSchema.parse(record.content),
        })
        .onConflictDoNothing()
        .returning({ id: feedPosts.id });
      if (inserted.length && isAnecdote) {
        anecdoteCount++;
        publishedArticles.add(wikipediaArticleKey(story));
      }
    }
  });
}

async function addLocalPosts(userId: string, day: string, now: Date) {
  const { ownerIds, names } = await scope(userId);
  const candidates = await listFeedCandidates(ownerIds, `${userId}:${day}`);
  // Un disque partagé par plusieurs amis n'est suggéré qu'une fois dans une édition.
  const seen = new Set<string>();
  const selected = candidates.filter((item) => {
    if (seen.has(item.discogsReleaseId)) return false;
    seen.add(item.discogsReleaseId);
    return true;
  });
  const previous = await db
    .select({ content: feedPosts.content, key: feedPosts.contentKey, day: feedPosts.day })
    .from(feedPosts)
    .where(
      and(
        eq(feedPosts.userId, userId),
        sql`${feedPosts.day} >= ${feedDay(new Date(now.getTime() - 14 * DAY_MS))}`,
      ),
    );
  const recent = previous.flatMap((row) => {
    const parsed = feedContentSchema.safeParse(row.content);
    return parsed.success ? [{ ...row, content: parsed.data }] : [];
  });
  const additionKey = (item: Candidate) =>
    `addition:${item.ownerId}:${item.discogsReleaseId}:${item.addedAt}`;
  const publishedKeys = new Set(previous.map(({ key }) => key));
  const additionArtists = new Set<string>();
  const additions = candidates
    .filter(
      (item) =>
        item.ownerId !== userId &&
        item.addedAt &&
        new Date(item.addedAt).getTime() <= now.getTime() &&
        new Date(item.addedAt).getTime() > now.getTime() - 14 * DAY_MS &&
        !publishedKeys.has(additionKey(item)),
    )
    .sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? ''))
    .filter((item) => {
      if (additionArtists.has(item.artists)) return false;
      additionArtists.add(item.artists);
      return true;
    })
    .slice(0, 2);
  const featured = selected
    .filter(
      (item) =>
        !additions.some(({ artists }) => artists === item.artists) &&
        !recent.some(
          ({ content: post }) => post.kind === 'listen' && post.artists === item.artists,
        ),
    )
    .slice(0, 1);
  const posts: { candidate: Candidate; content: FeedContent; key: string }[] = [];
  for (let index = 0; index < 2; index++) {
    const addition = additions[index];
    if (addition)
      posts.push({
        candidate: addition,
        content: content(addition, names, 'addition'),
        key: additionKey(addition),
      });
    const suggestion = featured[index];
    if (suggestion)
      posts.push({
        candidate: suggestion,
        content: content(suggestion, names, 'listen'),
        key: `listen:${day}:${suggestion.discogsReleaseId}`,
      });
  }
  const ranked = selected
    .filter((item) => item.price !== null && Number(item.price) > 0)
    .sort((a, b) => Number(b.price) - Number(a.price));
  const rated = selected
    .filter(
      (item) =>
        item.rating !== null &&
        item.rating > 0 &&
        item.ratingCount !== null &&
        item.ratingCount > 0,
    )
    .sort(
      (a, b) =>
        b.rating! - a.rating! ||
        b.ratingCount! - a.ratingCount! ||
        a.discogsReleaseId.localeCompare(b.discogsReleaseId),
    );
  const lastStat = recent
    .filter((row) => row.content.kind === 'stat')
    .sort((a, b) => b.day.localeCompare(a.day))[0];
  const preferRating = lastStat?.content.statistic?.metric !== 'rating' || !ranked.length;
  const metric = rated.length && preferRating ? 'rating' : 'price';
  const stat = metric === 'rating' ? rated[0] : ranked[0];
  if (
    stat &&
    !recent.some(
      (row) =>
        row.content.kind === 'stat' && row.day > feedDay(new Date(now.getTime() - 7 * DAY_MS)),
    )
  )
    posts.push({
      candidate: stat,
      content: content(stat, names, 'stat', metric),
      key: `stat:${day}:${stat.discogsReleaseId}`,
    });
  await appendPosts(userId, day, posts);
  return { candidates: selected, names };
}

/** Un instantané par jour ; les sources externes sont chargées uniquement par le worker. */
export async function ensureDailyFeed(userId: string, now = new Date()): Promise<void> {
  const day = feedDay(now);
  const [created] = await db
    .insert(feedEditions)
    .values({ userId, day })
    .onConflictDoNothing()
    .returning();
  if (created) await addLocalPosts(userId, day, now);
  const [edition] = await db
    .select()
    .from(feedEditions)
    .where(and(eq(feedEditions.userId, userId), eq(feedEditions.day, day)))
    .limit(1);
  const upgrade = !!edition && edition.editorialVersion < ANECDOTE_VERSION;
  const retry =
    !!edition &&
    edition.status === 'partial' &&
    edition.enrichmentAttempts < 3 &&
    !!edition.retryAt &&
    edition.retryAt <= now;
  if (edition && (upgrade || retry) && edition.status !== 'pending')
    await db
      .update(feedEditions)
      .set({ status: 'pending', ...(upgrade ? { enrichmentAttempts: 0 } : {}) })
      .where(eq(feedEditions.id, edition.id));
  if (edition && (edition.status === 'pending' || upgrade || retry))
    await enqueue({
      type: TASK_REFRESH_FEED,
      payload: { userId, day },
      dedupeKey: `feed:${userId}:${day}`,
      priority: -20,
      keepExisting: true,
    });
}

export async function scheduleDailyFeeds(now = new Date()) {
  for (const userId of await listCollectionSyncUserIds()) {
    // Une erreur isolée sera retentée au prochain cycle ; le worker continue sa file.
    try {
      await ensureDailyFeed(userId, now);
    } catch {
      log.warn({ userId }, 'planification du fil impossible, nouvel essai au prochain cycle');
    }
  }
}

type Sources = { wikipedia: typeof fetchWikipediaStory; news: typeof fetchMusicNews };
const liveSources: Sources = { wikipedia: fetchWikipediaStory, news: fetchMusicNews };

/** Cache mutualisé ; une panne conserve un extrait existant sans enregistrer une absence. */
async function cachedStories(
  key: string,
  load: () => Promise<SourceStory[]>,
  now: Date,
  ttlMs: number,
) {
  const [cached] = await db
    .select()
    .from(feedSourceCache)
    .where(eq(feedSourceCache.key, key))
    .limit(1);
  const previous = cached ? z.array(sourceStorySchema).safeParse(cached.content) : null;
  if (cached && cached.expiresAt > now && previous?.success)
    return { stories: previous.data, failed: false };
  try {
    const stories = z.array(sourceStorySchema).parse(await load());
    await db
      .insert(feedSourceCache)
      .values({
        key,
        content: stories,
        expiresAt: new Date(now.getTime() + (stories.length ? ttlMs : DAY_MS)),
      })
      .onConflictDoUpdate({
        target: feedSourceCache.key,
        set: {
          content: stories,
          expiresAt: new Date(now.getTime() + (stories.length ? ttlMs : DAY_MS)),
        },
      });
    return { stories, failed: false };
  } catch {
    return { stories: previous?.success ? previous.data : [], failed: true };
  }
}

export async function enrichDailyFeed(
  userId: string,
  day: string,
  sources: Sources = liveSources,
  now = new Date(),
) {
  const [edition] = await db
    .select()
    .from(feedEditions)
    .where(and(eq(feedEditions.userId, userId), eq(feedEditions.day, day)))
    .limit(1);
  if (!edition || (edition.status !== 'pending' && edition.editorialVersion >= ANECDOTE_VERSION))
    return;
  const existing = await db
    .select({ id: feedPosts.id })
    .from(feedPosts)
    .where(eq(feedPosts.editionId, edition.id))
    .limit(1);
  // L'import initial peut avoir été traité juste avant cette tâche de moindre priorité.
  if (!existing.length && day === feedDay(now)) await addLocalPosts(userId, day, now);
  const { ownerIds, names } = await scope(userId);
  const candidates = await listFeedCandidates(ownerIds, `${userId}:${day}`);
  const records: { candidate: Candidate; content: FeedContent; key: string }[] = [];
  let partial = false;
  const subjects = new Set<string>();
  const pool: { candidate: Candidate; story: SourceStory; subjectKey: string; key: string }[] = [];
  const artistSubjects: { candidate: Candidate; kind: 'artist' | 'album'; id: string }[] = [];
  const albumSubjects: typeof artistSubjects = [];
  for (const candidate of candidates) {
    const refs = artistRefsSchema.safeParse(candidate.artistRefs);
    if (refs.success)
      for (const ref of refs.data) {
        const key = `artist:${ref.id}`;
        if (!subjects.has(key)) {
          subjects.add(key);
          artistSubjects.push({ candidate, kind: 'artist', id: ref.id });
        }
      }
    if (candidate.masterId && /^[1-9]\d*$/.test(candidate.masterId))
      if (!subjects.has(`album:${candidate.masterId}`)) {
        subjects.add(`album:${candidate.masterId}`);
        albumSubjects.push({ candidate, kind: 'album', id: candidate.masterId });
      }
  }
  // Explore artists across the collection before spending requests on album masters.
  // Two requests at a time and a deadline keep this below the worker's lock timeout.
  const queue = [...artistSubjects.slice(0, 12), ...albumSubjects.slice(0, 4)];
  const started = Date.now();
  for (let offset = 0; offset < queue.length; offset += 2) {
    if (Date.now() - started > 75_000) {
      partial = true;
      break;
    }
    const batch = await Promise.all(
      queue.slice(offset, offset + 2).map(async ({ candidate, kind, id }) => {
        const subject = { kind, id };
        const key = `wiki:v3:${kind}:${id}`;
        const result = await cachedStories(
          key,
          () => sources.wikipedia(subject),
          now,
          30 * 86_400_000,
        );
        return { candidate, kind, key, result };
      }),
    );
    for (const { candidate, kind, key, result } of batch) {
      partial ||= result.failed;
      for (const source of result.stories.slice(0, 3)) {
        if (source.kind !== kind) continue;
        const story = curatedStory(source);
        if (story) pool.push({ candidate, story, subjectKey: key, key: wikipediaStoryKey(story) });
      }
    }
  }
  const previous = pool.length
    ? await db
        .select({ key: feedPosts.contentKey })
        .from(feedPosts)
        .where(
          and(
            eq(feedPosts.userId, userId),
            inArray(
              feedPosts.contentKey,
              pool.map(({ key }) => key),
            ),
          ),
        )
    : [];
  const seenStories = new Set(previous.map(({ key }) => key));
  // Legacy keys included oldid. Keep their IDs and positions while preventing the
  // same curated passage from being published again under the new stable key.
  const legacy = pool.length
    ? await db
        .select({ content: feedPosts.content })
        .from(feedPosts)
        .where(
          and(
            eq(feedPosts.userId, userId),
            sql`${feedPosts.content}->'story'->>'sourceName' = 'Wikipédia'`,
            sql`${feedPosts.content}->'story'->>'kind' in ('album', 'artist')`,
            sql`${feedPosts.content}->'story'->'editorial' is null`,
          ),
        )
    : [];
  for (const row of legacy) {
    const parsed = feedContentSchema.safeParse(row.content);
    const story = parsed.success && parsed.data.story ? curatedStory(parsed.data.story) : null;
    if (story) seenStories.add(wikipediaStoryKey(story));
  }
  const selectedSubjects = new Set<string>();
  const selectedTopics = new Set<string>();
  const ranked = pool.sort(
    (a, b) =>
      Number(b.story.language === 'fr') - Number(a.story.language === 'fr') ||
      (b.story.editorial?.score ?? 0) - (a.story.editorial?.score ?? 0) ||
      a.key.localeCompare(b.key),
  );
  for (const uniqueTopics of [true, false]) {
    for (const item of ranked) {
      if (records.length >= 4) break;
      const topic = item.story.editorial!.topic;
      if (
        seenStories.has(item.key) ||
        selectedSubjects.has(item.subjectKey) ||
        (uniqueTopics && selectedTopics.has(topic))
      )
        continue;
      records.push({
        candidate: item.candidate,
        content: { ...content(item.candidate, names, item.story.kind), story: item.story },
        key: item.key,
      });
      seenStories.add(item.key);
      selectedSubjects.add(item.subjectKey);
      selectedTopics.add(topic);
    }
  }
  const news = await cachedStories(
    'music-news',
    () => sources.news(undefined, now),
    now,
    6 * 3_600_000,
  );
  partial ||= news.failed;
  const newsArtists = new Set<string>();
  for (const source of [...news.stories].sort(
    (a, b) => Number(b.language === 'fr') - Number(a.language === 'fr'),
  )) {
    const story = curatedStory(source)!;
    if (story.publishedAt && feedDay(new Date(story.publishedAt)) > day) continue;
    const candidate = candidates.find((item) => {
      const refs = artistRefsSchema.safeParse(item.artistRefs);
      return (
        refs.success && refs.data.some((artist) => newsMentionsArtist(story.title, artist.name))
      );
    });
    if (!candidate || newsArtists.has(candidate.artists)) continue;
    newsArtists.add(candidate.artists);
    records.push({
      candidate,
      content: { ...content(candidate, names, 'news'), story },
      key: `news:${digest(story.sourceUrl)}`,
    });
    if (records.filter(({ content }) => content.kind === 'news').length >= 4) break;
  }
  await appendPosts(userId, day, records);
  await db
    .update(feedEditions)
    .set({
      status: partial ? 'partial' : 'ready',
      editorialVersion: ANECDOTE_VERSION,
      enrichmentAttempts: sql`${feedEditions.enrichmentAttempts} + 1`,
      retryAt: partial ? new Date(now.getTime() + 15 * 60_000) : null,
    })
    .where(eq(feedEditions.id, edition.id));
}

export async function markFeedPartial(userId: string, day: string) {
  await db
    .update(feedEditions)
    .set({
      status: 'partial',
      editorialVersion: ANECDOTE_VERSION,
      enrichmentAttempts: sql`${feedEditions.enrichmentAttempts} + 1`,
      retryAt: new Date(Date.now() + 15 * 60_000),
    })
    .where(and(eq(feedEditions.userId, userId), eq(feedEditions.day, day)));
}

export async function getFeedPage(
  userId: string,
  rawCursor?: string,
  now = new Date(),
  limit = PAGE_SIZE,
): Promise<FeedPage> {
  const pageSize = Math.min(Math.max(Math.floor(limit), 1), 100);
  let cursor: z.infer<typeof feedCursorSchema> | null = null;
  if (rawCursor) {
    try {
      cursor = feedCursorSchema.parse(
        JSON.parse(Buffer.from(rawCursor, 'base64url').toString('utf8')),
      );
    } catch {
      throw new ApiError({
        code: 'FEED_CURSOR_INVALID',
        message: 'Curseur du fil invalide.',
        status: 400,
      });
    }
  }
  if (cursor && cursor.rank === undefined) {
    const [anchor] = await db
      .select({ rank: displayRank })
      .from(feedPosts)
      .where(
        and(
          eq(feedPosts.userId, userId),
          eq(feedPosts.day, cursor.day),
          eq(feedPosts.position, cursor.position),
        ),
      )
      .limit(1);
    cursor.rank = anchor?.rank ?? 4;
  }
  const day = feedDay(now);
  const { ownerIds } = await scope(userId);
  const items: FeedPage['items'] = [];
  let hasMore = false;
  // Les éléments retirés ou révoqués ne doivent ni fuiter ni bloquer la pagination.
  for (let batch = 0; batch < 10; batch++) {
    const after = cursor
      ? sql`(${feedPosts.day} < ${cursor.day} or (${feedPosts.day} = ${cursor.day}
          and (${displayRank} > ${cursor.rank} or (${displayRank} = ${cursor.rank} and ${feedPosts.position} > ${cursor.position}))))`
      : sql`true`;
    const rows = await db
      .select({ ...getTableColumns(feedPosts), displayRank })
      .from(feedPosts)
      .where(
        and(
          eq(feedPosts.userId, userId),
          inArray(feedPosts.ownerId, ownerIds),
          sql`${feedPosts.day} <= ${day}`,
          displayEligible,
          after,
        ),
      )
      .orderBy(sql`${feedPosts.day} desc`, displayRank, feedPosts.position)
      .limit(50);
    const visible = new Set(
      (
        await visibleFeedReleases(
          ownerIds,
          rows.map(({ discogsReleaseId }) => discogsReleaseId),
        )
      ).map((item) => `${item.ownerId}:${item.discogsReleaseId}`),
    );
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]!;
      const parsed = feedContentSchema.safeParse(row.content);
      cursor = {
        day: row.day,
        position: row.position,
        rank: row.displayRank,
      };
      if (
        parsed.success &&
        parsed.data.story?.sourceName === 'Wikipédia' &&
        parsed.data.story.kind !== 'news'
      ) {
        const story = curatedStory(parsed.data.story);
        if (!story) continue;
        parsed.data.story = story;
      }
      if (parsed.success && parsed.data.story?.kind === 'news')
        parsed.data.story = curatedStory(parsed.data.story);
      if (visible.has(`${row.ownerId}:${row.discogsReleaseId}`) && parsed.success)
        items.push({
          ...parsed.data,
          id: row.id,
          ownerId: row.ownerId,
          discogsReleaseId: row.discogsReleaseId,
          day: row.day,
        });
      if (items.length === pageSize) {
        hasMore = index < rows.length - 1 || rows.length === 50;
        break;
      }
    }
    if (items.length === pageSize) break;
    if (rows.length < 50) {
      hasMore = false;
      break;
    }
    hasMore = true;
  }
  const [edition] = await db
    .select({ status: feedEditions.status })
    .from(feedEditions)
    .where(and(eq(feedEditions.userId, userId), eq(feedEditions.day, day)))
    .limit(1);
  return {
    items,
    nextCursor:
      hasMore && cursor ? Buffer.from(JSON.stringify(cursor)).toString('base64url') : null,
    status: edition?.status ?? 'pending',
    day,
  };
}
