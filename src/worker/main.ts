/**
 * Worker de tâches (SPECIFICATION.md §9.4).
 *
 * Même code et même base que l'application Web, processus distinct. Le Lot 0 pose la
 * boucle, l'arrêt propre et le heartbeat ; la consommation `FOR UPDATE SKIP LOCKED`, le
 * backoff et les limites par fournisseur arrivent au Lot 2 avec la table des tâches.
 */
import { checkDatabase } from '@/db/client';
import { getEnv } from '@/lib/env';
import { moduleLogger } from '@/lib/logger';

const log = moduleLogger('worker');

let running = true;

function requestShutdown(signal: NodeJS.Signals): void {
  log.info({ signal }, 'arrêt demandé, fin du cycle en cours');
  running = false;
}

async function main(): Promise<void> {
  const env = getEnv();

  if (!env.WORKER_ENABLED) {
    log.warn('WORKER_ENABLED=false, sortie immédiate');
    return;
  }

  process.on('SIGINT', requestShutdown);
  process.on('SIGTERM', requestShutdown);

  const database = await checkDatabase();
  log.info(
    { concurrency: env.WORKER_CONCURRENCY, databaseLatencyMs: database.latencyMs },
    'worker démarré',
  );

  while (running) {
    // Lot 2 : réclamer un lot de tâches (FOR UPDATE SKIP LOCKED), reprendre les verrous
    // expirés, appliquer le backoff exponentiel avec jitter.
    log.debug('heartbeat');
    await new Promise((resolve) => setTimeout(resolve, env.WORKER_POLL_INTERVAL_MS));
  }

  log.info('worker arrêté proprement');
  process.exit(0);
}

main().catch((error: unknown) => {
  log.fatal({ err: error }, 'worker interrompu');
  process.exit(1);
});
