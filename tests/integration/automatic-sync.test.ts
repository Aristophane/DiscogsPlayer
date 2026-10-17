import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '@/db/client';
import { discogsCredentials, syncRuns, tasks, users } from '@/db/schema';
import { listCollectionSyncUserIds, upsertUserFromDiscogs } from '@/modules/auth/service';
import { consumeInvite, createInvite } from '@/modules/sharing/service';
import { scheduleAutomaticCollectionSyncs } from '@/modules/sync/scheduler';
import { startSync } from '@/modules/sync/service';

const IDENTITIES = [
  { id: 995_400_001, username: 'auto_own' },
  { id: 995_400_002, username: 'auto_friend' },
  { id: 995_400_003, username: 'auto_disconnected' },
  { id: 995_400_004, username: 'auto_deleted' },
];
const TEST_IDS = IDENTITIES.map(({ id }) => String(id));
const NOW = new Date('2026-10-17T12:00:00Z');
const DAY_MS = 24 * 3_600_000;
let ownId: string;
let friendId: string;
let disconnectedId: string;
let deletedId: string;

async function cleanup() {
  const testUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.discogsUserId, TEST_IDS));
  if (testUsers.length) {
    await db.delete(tasks).where(
      inArray(
        tasks.dedupeKey,
        testUsers.map(({ id }) => `sync:${id}`),
      ),
    );
  }
  await db.delete(users).where(inArray(users.discogsUserId, TEST_IDS));
}

async function finishRun(runId: string, userId: string, status: 'completed' | 'failed', at: Date) {
  await db.update(syncRuns).set({ status, completedAt: at }).where(eq(syncRuns.id, runId));
  await db
    .update(tasks)
    .set({ status })
    .where(eq(tasks.dedupeKey, `sync:${userId}`));
}

beforeEach(async () => {
  await cleanup();
  const accounts = [];
  for (const identity of IDENTITIES) {
    accounts.push(await upsertUserFromDiscogs(identity, { token: 'jeton', tokenSecret: 'secret' }));
  }
  [ownId, friendId, disconnectedId, deletedId] = accounts.map(({ id }) => id) as [
    string,
    string,
    string,
    string,
  ];
  await db.delete(discogsCredentials).where(eq(discogsCredentials.userId, disconnectedId));
  await db.update(users).set({ deletedAt: NOW }).where(eq(users.id, deletedId));
});

afterAll(async () => {
  await cleanup();
  await sql.end();
});

describe('synchronisation automatique des collections', () => {
  it('planifie sa collection et celle d’un ami connecté, sans visite ni doublon par partage', async () => {
    const invite = await createInvite(friendId);
    await consumeInvite(invite.token, ownId);

    await scheduleAutomaticCollectionSyncs(NOW);
    await scheduleAutomaticCollectionSyncs(NOW);

    const runs = await db
      .select()
      .from(syncRuns)
      .where(inArray(syncRuns.userId, [ownId, friendId]));
    expect(runs).toHaveLength(2);
    expect(runs.map(({ userId }) => userId).sort()).toEqual([ownId, friendId].sort());
    expect(runs.every(({ kind, status }) => kind === 'scheduled' && status === 'queued')).toBe(
      true,
    );

    const queued = await db
      .select()
      .from(tasks)
      .where(
        inArray(
          tasks.dedupeKey,
          [ownId, friendId].map((id) => `sync:${id}`),
        ),
      );
    expect(queued).toHaveLength(2);
    for (const run of runs) {
      expect(queued.find(({ dedupeKey }) => dedupeKey === `sync:${run.userId}`)?.payload).toEqual({
        syncRunId: run.id,
        userId: run.userId,
      });
    }
  });

  it('exclut les comptes supprimés et les comptes sans identifiants Discogs', async () => {
    const eligible = await listCollectionSyncUserIds();
    expect(eligible).toEqual(expect.arrayContaining([ownId, friendId]));
    expect(eligible).not.toContain(disconnectedId);
    expect(eligible).not.toContain(deletedId);

    await scheduleAutomaticCollectionSyncs(NOW);
    expect(
      await db
        .select()
        .from(syncRuns)
        .where(inArray(syncRuns.userId, [disconnectedId, deletedId])),
    ).toHaveLength(0);
  });

  it('ne crée qu’un run et une tâche lors de demandes concurrentes', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => startSync(ownId, 'scheduled', NOW)),
    );
    expect(results.filter(({ created }) => created)).toHaveLength(1);
    expect(new Set(results.map(({ run }) => run.id)).size).toBe(1);
    expect(
      await db
        .select()
        .from(tasks)
        .where(eq(tasks.dedupeKey, `sync:${ownId}`)),
    ).toHaveLength(1);
  });

  it('attend 24 heures après la dernière synchronisation terminée', async () => {
    const first = await startSync(ownId, 'scheduled', NOW);
    const completedAt = new Date(NOW.getTime() + 5 * 60_000);
    await finishRun(first.run.id, ownId, 'completed', completedAt);

    expect(
      (await startSync(ownId, 'scheduled', new Date(completedAt.getTime() + DAY_MS - 1))).created,
    ).toBe(false);
    expect(
      (await startSync(ownId, 'scheduled', new Date(completedAt.getTime() + DAY_MS))).created,
    ).toBe(true);
  });

  it('respecte aussi une synchronisation manuelle récente et conserve le déclenchement manuel', async () => {
    const manual = await startSync(ownId, 'manual', NOW);
    await finishRun(manual.run.id, ownId, 'completed', NOW);
    expect((await startSync(ownId, 'scheduled', new Date(NOW.getTime() + 1_000))).created).toBe(
      false,
    );
    expect((await startSync(ownId, 'manual', new Date(NOW.getTime() + 2_000))).created).toBe(true);
  });

  it('ne relance pas un échec définitif chaque minute et permet un nouvel essai manuel', async () => {
    const first = await startSync(ownId, 'scheduled', NOW);
    await finishRun(first.run.id, ownId, 'failed', NOW);

    expect((await startSync(ownId, 'scheduled', new Date(NOW.getTime() + 60_000))).created).toBe(
      false,
    );
    expect((await startSync(ownId, 'manual', new Date(NOW.getTime() + 60_000))).created).toBe(true);
  });

  it('retente automatiquement un échec définitif après 24 heures', async () => {
    const first = await startSync(ownId, 'scheduled', NOW);
    await finishRun(first.run.id, ownId, 'failed', NOW);
    expect((await startSync(ownId, 'scheduled', new Date(NOW.getTime() + DAY_MS))).created).toBe(
      true,
    );
  });
});
