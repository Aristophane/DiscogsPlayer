import { moduleLogger } from '@/lib/logger';
import { listCollectionSyncUserIds } from '@/modules/auth/service';

import { startSync } from './service';

const log = moduleLogger('sync');

export const SYNC_SCHEDULER_INTERVAL_MS = 60_000;

/**
 * Maintient les comptes connectés à jour, même sans visite. Leurs collections
 * partagées sont les mêmes données : aucun import distinct par ami n'est nécessaire.
 */
export async function scheduleAutomaticCollectionSyncs(now = new Date()): Promise<number> {
  let created = 0;
  for (const userId of await listCollectionSyncUserIds()) {
    try {
      const result = await startSync(userId, 'scheduled', now);
      if (result.created) created += 1;
    } catch {
      // Un compte supprimé pendant ce cycle ou une erreur isolée ne bloque pas les autres.
      log.warn(
        { userId },
        'planification de synchronisation impossible, nouvel essai au prochain cycle',
      );
    }
  }
  return created;
}
