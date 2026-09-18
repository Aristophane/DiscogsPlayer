import { z } from 'zod';

const albumSchema = z.object({
  discogsReleaseId: z.string(),
  title: z.string(),
  artists: z.string(),
  coverUrl: z.string().nullable(),
});

export const highlightsSchema = z.object({
  wanted: z.array(
    albumSchema.extend({
      communityHave: z.number().int().nonnegative().nullable(),
      communityWant: z.number().int().nonnegative().nullable(),
      lowestPriceEur: z.string().nullable(),
      statisticsFetchedAt: z.coerce.date().nullable(),
    }),
  ),
  valuable: z.array(
    albumSchema.extend({
      communityHave: z.number().int().nonnegative().nullable(),
      communityWant: z.number().int().nonnegative().nullable(),
      lowestPriceEur: z.string().nullable(),
      statisticsFetchedAt: z.coerce.date().nullable(),
    }),
  ),
  total: z.number().int().nonnegative(),
  fetched: z.number().int().nonnegative(),
  fresh: z.number().int().nonnegative(),
});

export type Highlights = z.infer<typeof highlightsSchema>;

export const spotlightSchema = z.object({
  item: albumSchema.extend({ year: z.number().int().nullable() }).nullable(),
});

export type Spotlight = z.infer<typeof spotlightSchema>['item'];
