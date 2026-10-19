import { createHash } from 'node:crypto';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
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
import { fetchMusicNews, fetchWikipediaStory, newsMentionsArtist } from './sources';
import { ANECDOTE_VERSION, MIN_ANECDOTE_SCORE, selectWikipediaAnecdotes } from './anecdotes';

export const TASK_REFRESH_FEED = 'feed.refresh_daily';
const PAGE_SIZE = 12;
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
  if (story.kind === 'news') return story;
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
        ? { price: candidate.price, have: candidate.have, want: candidate.want }
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
  const additions = candidates
    .filter(
      (item) =>
        item.ownerId !== userId &&
        item.addedAt &&
        new Date(item.addedAt).getTime() <= now.getTime() &&
        new Date(item.addedAt).getTime() > now.getTime() - 14 * 86_400_000,
    )
    .sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? ''))
    .slice(0, 4);
  const featured: Candidate[] = [];
  for (const ownerId of ownerIds) {
    const item = selected.find((candidate) => candidate.ownerId === ownerId);
    if (item) featured.push(item);
    if (featured.length === 4) break;
  }
  for (const item of selected) {
    if (featured.length === 4) break;
    if (!featured.includes(item)) featured.push(item);
  }
  const posts: { candidate: Candidate; content: FeedContent; key: string }[] = [];
  for (let index = 0; index < 4; index++) {
    const addition = additions[index];
    if (addition)
      posts.push({
        candidate: addition,
        content: content(addition, names, 'addition'),
        key: `addition:${addition.ownerId}:${addition.discogsReleaseId}:${addition.addedAt}`,
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
  const stat = ranked[0];
  if (stat)
    posts.push({
      candidate: stat,
      content: content(stat, names, 'stat'),
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
  if (edition && edition.editorialVersion < ANECDOTE_VERSION && edition.status !== 'pending')
    await db
      .update(feedEditions)
      .set({ status: 'pending' })
      .where(
        and(eq(feedEditions.id, edition.id), lt(feedEditions.editorialVersion, ANECDOTE_VERSION)),
      );
  if (edition && (edition.status === 'pending' || edition.editorialVersion < ANECDOTE_VERSION))
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
      .values({ key, content: stories, expiresAt: new Date(now.getTime() + ttlMs) })
      .onConflictDoUpdate({
        target: feedSourceCache.key,
        set: { content: stories, expiresAt: new Date(now.getTime() + ttlMs) },
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
  for (const candidate of candidates) {
    const refs = artistRefsSchema.safeParse(candidate.artistRefs);
    const subjectsForRelease: { kind: 'album' | 'artist'; id: string }[] = [];
    if (candidate.masterId && /^[1-9]\d*$/.test(candidate.masterId))
      subjectsForRelease.push({ kind: 'album', id: candidate.masterId });
    if (refs.success && refs.data[0])
      subjectsForRelease.push({ kind: 'artist', id: refs.data[0].id });
    for (const subject of subjectsForRelease) {
      const key = `wiki:v2:${subject.kind}:${subject.id}`;
      if (subjects.has(key) || subjects.size >= 6) continue;
      subjects.add(key);
      const result = await cachedStories(
        key,
        () => sources.wikipedia(subject),
        now,
        30 * 86_400_000,
      );
      partial ||= result.failed;
      for (const source of result.stories.slice(0, 3)) {
        if (source.kind !== subject.kind) continue;
        const story = curatedStory(source);
        if (story) pool.push({ candidate, story, subjectKey: key, key: wikipediaStoryKey(story) });
      }
    }
    if (subjects.size >= 6) break;
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
  for (const story of news.stories) {
    if (story.publishedAt && feedDay(new Date(story.publishedAt)) > day) continue;
    const candidate = candidates.find((item) => {
      const refs = artistRefsSchema.safeParse(item.artistRefs);
      return (
        refs.success && refs.data.some((artist) => newsMentionsArtist(story.title, artist.name))
      );
    });
    if (!candidate) continue;
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
    .set({ status: partial ? 'partial' : 'ready', editorialVersion: ANECDOTE_VERSION })
    .where(eq(feedEditions.id, edition.id));
}

export async function markFeedPartial(userId: string, day: string) {
  await db
    .update(feedEditions)
    .set({ status: 'partial', editorialVersion: ANECDOTE_VERSION })
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
  const day = feedDay(now);
  const { ownerIds } = await scope(userId);
  const items: FeedPage['items'] = [];
  let hasMore = false;
  // Les éléments retirés ou révoqués ne doivent ni fuiter ni bloquer la pagination.
  for (let batch = 0; batch < 10; batch++) {
    const after = cursor
      ? sql`(${feedPosts.day} < ${cursor.day} or (${feedPosts.day} = ${cursor.day} and ${feedPosts.position} > ${cursor.position}))`
      : sql`true`;
    const rows = await db
      .select()
      .from(feedPosts)
      .where(
        and(
          eq(feedPosts.userId, userId),
          inArray(feedPosts.ownerId, ownerIds),
          sql`${feedPosts.day} <= ${day}`,
          after,
        ),
      )
      .orderBy(sql`${feedPosts.day} desc`, feedPosts.position)
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
      cursor = { day: row.day, position: row.position };
      const parsed = feedContentSchema.safeParse(row.content);
      if (
        parsed.success &&
        parsed.data.story?.sourceName === 'Wikipédia' &&
        parsed.data.story.kind !== 'news'
      ) {
        const story = curatedStory(parsed.data.story);
        if (!story) continue;
        parsed.data.story = story;
      }
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
