/**
 * Exécution des tâches d'import (SPECIFICATION.md §9.4, §12).
 *
 * Chaque type de tâche valide son payload par Zod avant de s'exécuter : le contenu d'une
 * colonne JSONB est une frontière externe comme une autre (CLAUDE.md).
 */
import { z } from 'zod';

import { moduleLogger } from '@/lib/logger';
import { applyReleaseDetails } from '@/modules/catalog/service';

import { DiscogsApiError, liveDiscogsApi, type DiscogsApi } from './discogs-api';
import type { TaskRow } from './queue';
import {
  TASK_FETCH_RELEASE,
  TASK_SYNC_COLLECTION,
  markRunFailed,
  runCollectionSync,
} from './service';

const log = moduleLogger('worker');

const syncCollectionPayload = z.object({
  syncRunId: z.string().uuid(),
  userId: z.string().uuid(),
});

const fetchReleasePayload = z.object({
  discogsReleaseId: z.string().min(1),
});

export type TaskError = {
  code: string;
  message: string;
  retryable: boolean;
  retryAfterMs?: number | undefined;
};

/** Traduit n'importe quelle exception en erreur de tâche exploitable et sans secret. */
export function toTaskError(error: unknown): TaskError {
  if (error instanceof DiscogsApiError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      retryAfterMs: error.retryAfterMs,
    };
  }

  if (error instanceof z.ZodError) {
    return {
      code: 'TASK_PAYLOAD_INVALID',
      message: 'Payload de tâche invalide',
      retryable: false,
    };
  }

  return {
    code: 'TASK_UNEXPECTED_ERROR',
    // Le message d'origine peut contenir une URL ou un fragment de requête : on ne le
    // propage pas tel quel dans la colonne d'erreur (§21.1).
    message: error instanceof Error ? error.name : 'Erreur inattendue',
    retryable: true,
  };
}

/**
 * Exécute une tâche. Lève en cas d'échec : c'est l'appelant (le worker) qui décide de
 * reprogrammer ou d'abandonner, en fonction des tentatives restantes.
 */
export async function runTask(task: TaskRow, api: DiscogsApi = liveDiscogsApi): Promise<void> {
  switch (task.type) {
    case TASK_SYNC_COLLECTION: {
      const payload = syncCollectionPayload.parse(task.payload);

      try {
        await runCollectionSync(payload.syncRunId, api);
      } catch (error) {
        const taskError = toTaskError(error);

        // Un échec définitif doit se voir dans l'écran de progression, pas seulement
        // dans la table des tâches : l'utilisateur attend une réponse (§12.3).
        if (!taskError.retryable || task.attemptCount >= task.maxAttempts) {
          await markRunFailed(payload.syncRunId, taskError.code);
        }

        throw error;
      }

      return;
    }

    case TASK_FETCH_RELEASE: {
      const payload = fetchReleasePayload.parse(task.payload);
      const details = await api.getRelease(payload.discogsReleaseId);
      await applyReleaseDetails(details);

      return;
    }

    default:
      log.error({ type: task.type }, 'type de tâche inconnu');
      throw new DiscogsApiError({
        code: 'TASK_TYPE_UNKNOWN',
        message: `Type de tâche inconnu : ${task.type}`,
        retryable: false,
      });
  }
}
