/**
 * File de tâches PostgreSQL (SPECIFICATION.md §9.4).
 *
 * Réclamation concurrente par `FOR UPDATE SKIP LOCKED` : plusieurs workers peuvent tirer
 * de la même file sans se bloquer ni traiter deux fois la même tâche.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { tasks } from '@/db/schema';
import { moduleLogger } from '@/lib/logger';

const log = moduleLogger('worker');

export type TaskRow = {
  id: string;
  type: string;
  payload: unknown;
  attemptCount: number;
  maxAttempts: number;
};

export type EnqueueOptions = {
  type: string;
  payload: unknown;
  /** Une seule tâche vivante par clé (§12.2) : la seconde met à jour, pas ne duplique. */
  dedupeKey?: string;
  runAfter?: Date;
  maxAttempts?: number;
  /** Plus haut passe en premier dans `claim()` (§9.4, Lot 6bis). `0` par défaut. */
  priority?: number;
};

/**
 * Ajoute une tâche, ou met à jour celle déjà vivante portant la même clé de
 * déduplication (§12.2).
 *
 * Écrit en SQL brut : la cible de conflit est l'index unique **partiel**
 * `tasks_dedupe_key_active_idx` (une tâche par clé, parmi celles encore vivantes), que le
 * constructeur de requêtes Drizzle ne sait pas exprimer pour `onConflictDoUpdate`. Le
 * conflit ne peut porter que sur `dedupe_key` — `id` est généré côté base — donc une
 * tâche sans clé de déduplication s'insère toujours simplement.
 *
 * Sur conflit, la priorité ne redescend jamais (`greatest`) : un clic utilisateur peut
 * faire remonter une tâche déjà programmée par l'import en arrière-plan devant la file,
 * jamais l'inverse. `run_after` prend le plus proche des deux pour la même raison — une
 * demande explicite ne doit pas rester derrière un backoff déjà entamé par un échec
 * précédent.
 */
export async function enqueue(options: EnqueueOptions): Promise<string | null> {
  const priority = options.priority ?? 0;
  const runAfter = options.runAfter ?? new Date();
  const maxAttempts = options.maxAttempts ?? 5;
  const dedupeKey = options.dedupeKey ?? null;

  const rows = await db.execute<{ id: string }>(sql`
    insert into ${tasks} (type, payload, dedupe_key, run_after, max_attempts, priority)
    values (
      ${options.type},
      ${JSON.stringify(options.payload)}::jsonb,
      ${dedupeKey},
      ${runAfter.toISOString()}::timestamptz,
      ${maxAttempts},
      ${priority}
    )
    on conflict (dedupe_key) where status in ('queued', 'running', 'retry_wait')
    do update set
      priority = greatest(${tasks}.priority, excluded.priority),
      run_after = least(${tasks}.run_after, excluded.run_after),
      updated_at = now()
    returning id
  `);

  return rows[0]?.id ?? null;
}

/**
 * Réclame jusqu'à `limit` tâches éligibles et les marque `running`.
 *
 * `SKIP LOCKED` fait sauter les lignes déjà verrouillées par un autre worker plutôt que
 * d'attendre : c'est ce qui rend la file concurrente sans coordination externe.
 */
export async function claim(
  workerId: string,
  limit: number,
  options: { types?: readonly string[]; now?: Date } = {},
): Promise<TaskRow[]> {
  // Filtre optionnel par type : permet de dédier un worker à un fournisseur et donc de
  // borner la concurrence par fournisseur (§9.4).
  const typeFilter =
    options.types && options.types.length > 0
      ? sql`and ${tasks.type} in ${sql.raw(`(${options.types.map((type) => `'${type.replace(/'/g, "''")}'`).join(', ')})`)}`
      : sql``;

  // L'heure de référence est celle de PostgreSQL, jamais celle du processus : `run_after`
  // est écrit par la base, et une dérive d'horloge entre worker et base rendrait une
  // tâche fraîchement insérée invisible pendant quelques millisecondes.
  const clock =
    options.now === undefined ? sql`now()` : sql`${options.now.toISOString()}::timestamptz`;

  const claimed = await db.execute<{
    id: string;
    type: string;
    payload: unknown;
    attempt_count: number;
    max_attempts: number;
  }>(sql`
    update ${tasks}
    set status = 'running',
        locked_at = ${clock},
        locked_by = ${workerId},
        attempt_count = ${tasks.attemptCount} + 1,
        updated_at = ${clock}
    where ${tasks.id} in (
      select ${tasks.id}
      from ${tasks}
      where ${tasks.status} in ('queued', 'retry_wait')
        and ${tasks.runAfter} <= ${clock}
        ${typeFilter}
      order by ${tasks.priority} desc, ${tasks.runAfter}
      limit ${limit}
      for update skip locked
    )
    returning ${tasks.id}, ${tasks.type}, ${tasks.payload},
              ${tasks.attemptCount} as attempt_count,
              ${tasks.maxAttempts} as max_attempts
  `);

  return claimed.map((row) => ({
    id: row.id,
    type: row.type,
    payload: row.payload,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
  }));
}

export async function complete(taskId: string, now = new Date()): Promise<void> {
  await db
    .update(tasks)
    .set({ status: 'completed', lockedAt: null, lockedBy: null, updatedAt: now })
    .where(eq(tasks.id, taskId));
}

/**
 * Délai avant nouvelle tentative : exponentiel, plafonné, avec jitter (§9.4).
 * Le jitter évite que toutes les tâches d'un même incident reviennent en même temps.
 */
export function backoffMs(attempt: number, random = Math.random()): number {
  const base = Math.min(1_000 * 2 ** Math.max(0, attempt - 1), 5 * 60_000);
  // Jitter « full » : entre 50 % et 100 % du délai nominal.
  return Math.round(base * (0.5 + 0.5 * random));
}

/**
 * Enregistre un échec : reprogrammation tant qu'il reste des tentatives, abandon sinon.
 * `retryAfterMs` prend le pas sur le backoff quand le fournisseur l'a explicitement
 * demandé (429 avec `Retry-After`, §12.3).
 */
export async function fail(
  task: TaskRow,
  error: { code: string; message: string; retryable: boolean; retryAfterMs?: number | undefined },
  now = new Date(),
): Promise<'retry' | 'failed'> {
  const canRetry = error.retryable && task.attemptCount < task.maxAttempts;

  if (!canRetry) {
    await db
      .update(tasks)
      .set({
        status: 'failed',
        lockedAt: null,
        lockedBy: null,
        lastErrorCode: error.code,
        lastErrorMessage: error.message.slice(0, 500),
        updatedAt: now,
      })
      .where(eq(tasks.id, task.id));

    return 'failed';
  }

  const delay = error.retryAfterMs ?? backoffMs(task.attemptCount);

  await db
    .update(tasks)
    .set({
      status: 'retry_wait',
      lockedAt: null,
      lockedBy: null,
      runAfter: new Date(now.getTime() + delay),
      lastErrorCode: error.code,
      lastErrorMessage: error.message.slice(0, 500),
      updatedAt: now,
    })
    .where(eq(tasks.id, task.id));

  return 'retry';
}

/**
 * Reprend les tâches dont le verrou a expiré (§9.4) : un worker tué net laisse ses
 * tâches en `running` pour toujours si personne ne les libère.
 */
export async function recoverExpiredLocks(
  lockTimeoutSeconds: number,
  options: { types?: readonly string[]; now?: Date } = {},
): Promise<number> {
  const now = options.now ?? new Date();

  const recovered = await db
    .update(tasks)
    .set({ status: 'retry_wait', lockedAt: null, lockedBy: null, runAfter: now, updatedAt: now })
    .where(
      and(
        eq(tasks.status, 'running'),
        // Même raison qu'au-dessus : l'ancienneté du verrou se mesure à l'horloge de la base.
        sql`${tasks.lockedAt} <= now() - make_interval(secs => ${lockTimeoutSeconds})`,
        options.types && options.types.length > 0
          ? inArray(tasks.type, [...options.types])
          : undefined,
      ),
    )
    .returning({ id: tasks.id });

  if (recovered.length > 0) {
    log.warn({ count: recovered.length }, 'verrous expirés repris');
  }

  return recovered.length;
}

/** Annule les tâches vivantes portant l'une des clés données (arrêt d'un import). */
export async function cancelByDedupeKeys(keys: string[], now = new Date()): Promise<void> {
  if (keys.length === 0) {
    return;
  }

  await db
    .update(tasks)
    .set({ status: 'cancelled', lockedAt: null, lockedBy: null, updatedAt: now })
    .where(
      and(
        inArray(tasks.dedupeKey, keys),
        inArray(tasks.status, ['queued', 'retry_wait', 'running']),
      ),
    );
}
