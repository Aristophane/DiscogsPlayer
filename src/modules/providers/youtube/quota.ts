/**
 * Quota YouTube en unités, pas en appels (ADR-0002, corrige SPECIFICATION.md §13.3).
 *
 * `search.list` coûte 100 unités, `videos.list` 1, sur un compartiment unique de
 * 10 000 unités/jour remis à zéro à minuit `America/Los_Angeles`. Une réserve est
 * inaccessible aux recherches : les validations restent possibles même recherches coupées.
 */
import { sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { providerQuotaWindows } from '@/db/schema';
import { getEnv } from '@/lib/env';

const OPERATION = 'youtube.units';

function wallClockParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  // `hour` peut valoir 24 à minuit pile selon l'implémentation ICU : ramené à 0.
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

/**
 * Décalage (ms) entre l'heure murale du fuseau à `instant` et `instant` lui-même, exprimé
 * comme si cette heure murale était de l'UTC. `actual = wallAsUtc - offset`.
 */
function offsetMsAt(instant: Date, timeZone: string): number {
  const wall = wallClockParts(instant, timeZone);
  const wallAsUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  return wallAsUtc - instant.getTime();
}

/**
 * Minuit America/Los_Angeles suivant `now`, en UTC.
 *
 * Un simple décalage mesuré à `now` se trompe quand la bascule DST a lieu *entre* `now`
 * et le minuit visé — par exemple juste après 1 h du matin un jour de passage à l'heure
 * d'hiver, où `now` est encore en heure d'été mais le minuit suivant, non. On mesure donc
 * le décalage à la cible elle-même, avec une itération pour converger (l'offset ne prend
 * que deux valeurs possibles, une itération suffit toujours).
 */
export function nextPacificMidnightUtc(now: Date, timeZone = 'America/Los_Angeles'): Date {
  const today = wallClockParts(now, timeZone);
  const tomorrowMidnightAsUtc = Date.UTC(today.year, today.month - 1, today.day + 1);

  const firstOffset = offsetMsAt(new Date(tomorrowMidnightAsUtc), timeZone);
  const candidate = tomorrowMidnightAsUtc - firstOffset;

  const secondOffset = offsetMsAt(new Date(candidate), timeZone);
  if (secondOffset === firstOffset) {
    return new Date(candidate);
  }

  return new Date(tomorrowMidnightAsUtc - secondOffset);
}

export type QuotaStatus = {
  limit: number;
  used: number;
  remaining: number;
  searchesRemainingEstimated: number;
  resetsAt: Date;
  exhausted: boolean;
};

async function currentWindow(now: Date) {
  const env = getEnv();
  const windowEnd = nextPacificMidnightUtc(now);
  const windowStart = new Date(windowEnd.getTime() - 24 * 3_600_000);

  const rows = await db
    .insert(providerQuotaWindows)
    .values({
      provider: 'youtube',
      operation: OPERATION,
      windowStart,
      windowEnd,
      configuredLimit: env.YOUTUBE_DAILY_QUOTA_UNITS,
    })
    .onConflictDoNothing()
    .returning();

  if (rows[0]) {
    return rows[0];
  }

  const existing = await db
    .select()
    .from(providerQuotaWindows)
    .where(
      sql`${providerQuotaWindows.provider} = 'youtube'
        and ${providerQuotaWindows.operation} = ${OPERATION}
        and ${providerQuotaWindows.windowStart} = ${windowStart.toISOString()}::timestamptz`,
    )
    .limit(1);

  return existing[0]!;
}

export async function getQuotaStatus(now = new Date()): Promise<QuotaStatus> {
  const env = getEnv();
  const window = await currentWindow(now);
  const remaining = Math.max(0, window.configuredLimit - window.estimatedUsed);
  const searchBudget = Math.max(0, remaining - env.YOUTUBE_SEARCH_RESERVE_UNITS);

  return {
    limit: window.configuredLimit,
    used: window.estimatedUsed,
    remaining,
    searchesRemainingEstimated: Math.floor(searchBudget / env.YOUTUBE_SEARCH_UNIT_COST),
    resetsAt: window.windowEnd,
    exhausted: window.exhaustedAt !== null,
  };
}

/**
 * Réserve `cost` unités avant un appel, atomiquement (§10.6). `search` doit respecter la
 * réserve ; une validation `videos.list` peut la consommer (§13.3).
 */
export async function reserveUnits(
  cost: number,
  kind: 'search' | 'videos',
  now = new Date(),
): Promise<boolean> {
  const env = getEnv();
  const window = await currentWindow(now);
  const reserve = kind === 'search' ? env.YOUTUBE_SEARCH_RESERVE_UNITS : 0;

  const updated = await db
    .update(providerQuotaWindows)
    .set({ estimatedUsed: sql`${providerQuotaWindows.estimatedUsed} + ${cost}`, updatedAt: now })
    .where(
      sql`${providerQuotaWindows.provider} = 'youtube'
        and ${providerQuotaWindows.operation} = ${OPERATION}
        and ${providerQuotaWindows.windowStart} = ${window.windowStart.toISOString()}::timestamptz
        and ${providerQuotaWindows.estimatedUsed} + ${cost} <= ${providerQuotaWindows.configuredLimit} - ${reserve}`,
    )
    .returning({ id: providerQuotaWindows.windowStart });

  return updated.length > 0;
}

/** Rembourse une réservation : uniquement si l'appel n'a jamais été émis (SPEC-GAPS G-16). */
export async function refundUnits(cost: number, now = new Date()): Promise<void> {
  const window = await currentWindow(now);

  await db
    .update(providerQuotaWindows)
    .set({
      estimatedUsed: sql`greatest(0, ${providerQuotaWindows.estimatedUsed} - ${cost})`,
      updatedAt: now,
    })
    .where(
      sql`${providerQuotaWindows.provider} = 'youtube'
        and ${providerQuotaWindows.operation} = ${OPERATION}
        and ${providerQuotaWindows.windowStart} = ${window.windowStart.toISOString()}::timestamptz`,
    );
}

/** Une réponse `quotaExceeded` de Google écrase l'estimation (ADR-0002). */
export async function markExhausted(now = new Date()): Promise<void> {
  const window = await currentWindow(now);

  await db
    .update(providerQuotaWindows)
    .set({ estimatedUsed: window.configuredLimit, exhaustedAt: now, updatedAt: now })
    .where(
      sql`${providerQuotaWindows.provider} = 'youtube'
        and ${providerQuotaWindows.operation} = ${OPERATION}
        and ${providerQuotaWindows.windowStart} = ${window.windowStart.toISOString()}::timestamptz`,
    );
}
