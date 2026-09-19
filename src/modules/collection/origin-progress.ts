import { z } from 'zod';

export const originProgressSchema = z.object({
  ownerId: z.string().uuid(),
  total: z.number().int().nonnegative(),
  known: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  unavailable: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  workerUpdateRequired: z.boolean(),
});
export type OriginProgress = z.infer<typeof originProgressSchema>;
