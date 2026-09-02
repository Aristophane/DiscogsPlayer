/**
 * File de tâches (SPECIFICATION.md §9.4) : concurrence, backoff, reprise des verrous.
 */
import { eq, like } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '@/db/client';
import { tasks } from '@/db/schema';
import { claim, complete, enqueue, fail, recoverExpiredLocks } from '@/modules/sync/queue';

const TYPE = 'test.queue';

/** Uniquement les tâches créées par ce fichier : la base de dev contient du vrai. */
async function cleanup() {
  await db.delete(tasks).where(like(tasks.type, 'test.%'));
}

beforeEach(cleanup);

afterAll(async () => {
  await cleanup();
  await sql.end();
});

describe('déduplication (§12.2)', () => {
  it('refuse une seconde tâche vivante portant la même clé', async () => {
    const first = await enqueue({ type: TYPE, payload: { n: 1 }, dedupeKey: 'test:release:1' });
    const second = await enqueue({ type: TYPE, payload: { n: 2 }, dedupeKey: 'test:release:1' });

    expect(first).not.toBeNull();
    // Deux utilisateurs possédant la même édition ne déclenchent qu'un seul chargement.
    expect(second).toBeNull();
  });

  it('autorise une nouvelle tâche une fois la précédente terminée', async () => {
    const first = await enqueue({ type: TYPE, payload: {}, dedupeKey: 'test:release:2' });
    await complete(first!);

    const second = await enqueue({ type: TYPE, payload: {}, dedupeKey: 'test:release:2' });

    expect(second).not.toBeNull();
  });

  it('n’applique aucune déduplication sans clé', async () => {
    const first = await enqueue({ type: TYPE, payload: {} });
    const second = await enqueue({ type: TYPE, payload: {} });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first).not.toBe(second);
  });
});

describe('réclamation concurrente (FOR UPDATE SKIP LOCKED)', () => {
  it('ne livre jamais deux fois la même tâche à deux workers', async () => {
    for (let i = 0; i < 10; i += 1) {
      await enqueue({ type: TYPE, payload: { i } });
    }

    // Deux workers réclament simultanément : SKIP LOCKED doit les faire se croiser
    // sans blocage et sans recouvrement.
    const [a, b] = await Promise.all([
      claim('worker-a', 5, { types: [TYPE] }),
      claim('worker-b', 5, { types: [TYPE] }),
    ]);

    const ids = [...a, ...b].map((task) => task.id);
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
  });

  it('ne réclame pas une tâche dont l’heure d’éligibilité n’est pas venue', async () => {
    await enqueue({
      type: TYPE,
      payload: {},
      runAfter: new Date(Date.now() + 3_600_000),
    });

    expect(await claim('worker', 10, { types: [TYPE] })).toHaveLength(0);
  });

  it('incrémente le compteur de tentatives à chaque réclamation', async () => {
    await enqueue({ type: TYPE, payload: {} });

    const [task] = await claim('worker', 1, { types: [TYPE] });

    expect(task?.attemptCount).toBe(1);
  });
});

describe('échecs et reprogrammation', () => {
  it('reprogramme une erreur récupérable avec un délai', async () => {
    await enqueue({ type: TYPE, payload: {} });
    const [task] = await claim('worker', 1, { types: [TYPE] });

    const outcome = await fail(task!, {
      code: 'DISCOGS_RATE_LIMITED',
      message: 'limité',
      retryable: true,
      retryAfterMs: 60_000,
    });

    expect(outcome).toBe('retry');

    const rows = await db.select().from(tasks).where(eq(tasks.id, task!.id));
    expect(rows[0]?.status).toBe('retry_wait');
    // `Retry-After` prime sur le backoff calculé (§12.3).
    expect(rows[0]!.runAfter.getTime()).toBeGreaterThan(Date.now() + 30_000);
  });

  it('abandonne immédiatement une erreur non récupérable', async () => {
    await enqueue({ type: TYPE, payload: {} });
    const [task] = await claim('worker', 1, { types: [TYPE] });

    const outcome = await fail(task!, {
      code: 'DISCOGS_REQUEST_REJECTED',
      message: 'refusé',
      retryable: false,
    });

    expect(outcome).toBe('failed');

    const rows = await db.select().from(tasks).where(eq(tasks.id, task!.id));
    expect(rows[0]?.status).toBe('failed');
    expect(rows[0]?.lastErrorCode).toBe('DISCOGS_REQUEST_REJECTED');
  });

  it('abandonne une fois les tentatives épuisées', async () => {
    await enqueue({ type: TYPE, payload: {}, maxAttempts: 1 });
    const [task] = await claim('worker', 1, { types: [TYPE] });

    expect(
      await fail(task!, {
        code: 'X',
        message: 'récupérable mais dernière chance',
        retryable: true,
      }),
    ).toBe('failed');
  });

  it('tronque un message d’erreur trop long avant de le stocker', async () => {
    await enqueue({ type: TYPE, payload: {} });
    const [task] = await claim('worker', 1, { types: [TYPE] });

    await fail(task!, { code: 'X', message: 'a'.repeat(2_000), retryable: false });

    const rows = await db.select().from(tasks).where(eq(tasks.id, task!.id));
    expect(rows[0]!.lastErrorMessage!.length).toBeLessThanOrEqual(500);
  });
});

describe('reprise des verrous expirés (§9.4)', () => {
  it('libère une tâche abandonnée par un worker mort', async () => {
    await enqueue({ type: TYPE, payload: {} });
    const [task] = await claim('worker-mort', 1, { types: [TYPE] });

    // Le worker est tué : la tâche reste `running` avec un verrou qui vieillit.
    await db
      .update(tasks)
      .set({ lockedAt: new Date(Date.now() - 600_000) })
      .where(eq(tasks.id, task!.id));

    expect(await recoverExpiredLocks(300, { types: [TYPE] })).toBe(1);

    const reclaimed = await claim('worker-vivant', 1, { types: [TYPE] });
    expect(reclaimed[0]?.id).toBe(task!.id);
  });

  it('ne touche pas à un verrou encore frais', async () => {
    await enqueue({ type: TYPE, payload: {} });
    await claim('worker-actif', 1, { types: [TYPE] });

    expect(await recoverExpiredLocks(300, { types: [TYPE] })).toBe(0);
  });
});
