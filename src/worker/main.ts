/**
 * Worker de tâches (SPECIFICATION.md §9.4).
 *
 * Même code et même base que l'application Web, processus distinct. La boucle réclame des
 * tâches par `FOR UPDATE SKIP LOCKED`, applique un backoff exponentiel avec jitter,
 * reprend les verrous expirés et s'arrête proprement en fin de cycle.
 */
import { randomUUID } from 'node:crypto';

import { checkDatabase, sql } from '@/db/client';
import { getEnv } from '@/lib/env';
import { moduleLogger } from '@/lib/logger';
import { runTask, toTaskError } from '@/modules/sync/handlers';
import { claim, complete, fail, recoverExpiredLocks } from '@/modules/sync/queue';

const log = moduleLogger('worker');

let running = true;

function requestShutdown(signal: NodeJS.Signals): void {
  log.info({ signal }, 'arrêt demandé, fin du cycle en cours');
  running = false;
}

/** Un cycle : reprise des verrous, réclamation, exécution. Retourne le nombre traité. */
export async function tick(workerId: string, concurrency: number, lockTimeoutSeconds: number) {
  await recoverExpiredLocks(lockTimeoutSeconds);

  const batch = await claim(workerId, concurrency);
  if (batch.length === 0) {
    return 0;
  }

  // Les tâches d'un lot s'exécutent en parallèle, borné par WORKER_CONCURRENCY : c'est
  // la limite de concurrence par fournisseur exigée par §9.4.
  await Promise.all(
    batch.map(async (task) => {
      try {
        await runTask(task);
        await complete(task.id);
        log.info({ taskId: task.id, type: task.type }, 'tâche terminée');
      } catch (error) {
        const taskError = toTaskError(error);
        const outcome = await fail(task, taskError);

        log.warn(
          {
            taskId: task.id,
            type: task.type,
            attempt: task.attemptCount,
            code: taskError.code,
            outcome,
          },
          'tâche en échec',
        );
      }
    }),
  );

  return batch.length;
}

async function main(): Promise<void> {
  const env = getEnv();

  if (!env.WORKER_ENABLED) {
    log.warn('WORKER_ENABLED=false, sortie immédiate');
    return;
  }

  process.on('SIGINT', requestShutdown);
  process.on('SIGTERM', requestShutdown);

  const workerId = `${process.pid}-${randomUUID().slice(0, 8)}`;
  const database = await checkDatabase();

  log.info(
    { workerId, concurrency: env.WORKER_CONCURRENCY, databaseLatencyMs: database.latencyMs },
    'worker démarré',
  );

  while (running) {
    let processed = 0;

    try {
      processed = await tick(workerId, env.WORKER_CONCURRENCY, env.WORKER_LOCK_TIMEOUT_SECONDS);
    } catch (error) {
      // Une panne de base ne doit pas tuer le worker : il réessaiera au cycle suivant.
      log.error({ err: error }, 'cycle en échec');
    }

    // File vide : on attend. File pleine : on enchaîne sans pause inutile.
    if (processed === 0) {
      await new Promise((resolve) => setTimeout(resolve, env.WORKER_POLL_INTERVAL_MS));
    }
  }

  await sql.end();
  log.info('worker arrêté proprement');
}

main().catch((error: unknown) => {
  log.fatal({ err: error }, 'worker interrompu');
  process.exit(1);
});
