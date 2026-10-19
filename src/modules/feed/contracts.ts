import { z } from 'zod';
import { ANECDOTE_TOPICS } from './anecdotes';

export const httpsUrl = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  });

export const sourceStorySchema = z.object({
  kind: z.enum(['album', 'artist', 'news']),
  title: z.string().min(1).max(500),
  text: z.string().max(2400),
  sourceName: z.string().min(1).max(100),
  sourceUrl: httpsUrl,
  language: z.enum(['fr', 'en']),
  publishedAt: z.string().datetime().nullable(),
  licenseUrl: httpsUrl.nullable(),
  editorial: z
    .object({
      version: z.literal(1),
      score: z.number().int().min(0).max(100),
      topic: z.enum(ANECDOTE_TOPICS),
      section: z.string().max(200).nullable(),
    })
    .optional(),
});
export type SourceStory = z.infer<typeof sourceStorySchema>;

export const feedContentSchema = z.object({
  kind: z.enum(['addition', 'listen', 'stat', 'album', 'artist', 'news']),
  title: z.string().min(1).max(500),
  artists: z.string(),
  coverUrl: z.string().nullable(),
  year: z.number().int().nullable(),
  ownerUsername: z.string().nullable(),
  addedAt: z.string().datetime().nullable(),
  story: sourceStorySchema.nullable(),
  statistic: z
    .object({
      price: z.string().nullable(),
      have: z.number().nullable(),
      want: z.number().nullable(),
    })
    .nullable(),
});
export type FeedContent = z.infer<typeof feedContentSchema>;
export const feedItemSchema = feedContentSchema.extend({
  id: z.string().uuid(),
  ownerId: z.string().uuid(),
  discogsReleaseId: z.string(),
  day: z.string(),
});
export type FeedItem = z.infer<typeof feedItemSchema>;
export const feedPageSchema = z.object({
  items: z.array(feedItemSchema),
  nextCursor: z.string().nullable(),
  status: z.enum(['pending', 'ready', 'partial']),
  day: z.string(),
});
export type FeedPage = z.infer<typeof feedPageSchema>;

export function feedDay(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  return ['year', 'month', 'day']
    .map((key) => parts.find(({ type }) => type === key)!.value)
    .join('-');
}

export const feedCursorSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  position: z.number().int().nonnegative().max(2_147_483_647),
});
