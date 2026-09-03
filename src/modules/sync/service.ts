/**
 * Import et synchronisation Discogs (SPECIFICATION.md §12).
 *
 * Trois invariants gouvernent ce module, et chacun est testé :
 * - SYNC-004 : jamais deux runs actifs pour un même compte (contrainte en base) ;
 * - SYNC-007 : aucune désactivation d'instance tant que **toutes** les pages n'ont pas
 *   été reçues — une page en erreur n'est pas une page vide (§12.3) ;
 * - §12.2 : une édition n'est chargée en détail qu'une fois, même si elle apparaît dans
 *   plusieurs collections.
 */
import { and, eq, isNull, ne, or, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { collectionInstances, syncRuns, users } from '@/db/schema';
import { moduleLogger } from '@/lib/logger';
import { selectStaleReleaseIds, upsertReleaseSummary } from '@/modules/catalog/service';
import { getDiscogsTokens } from '@/modules/auth/service';

import { DiscogsApiError, liveDiscogsApi, type DiscogsApi } from './discogs-api';
import { enqueue } from './queue';

const log = moduleLogger('sync');

export const TASK_SYNC_COLLECTION = 'discogs.sync_collection';
export const TASK_FETCH_RELEASE = 'discogs.fetch_release';

/** SYNC-003 : une actualisation automatique au plus toutes les 24 heures. */
const SCHEDULED_MIN_INTERVAL_MS = 24 * 3_600_000;

export type SyncRunView = {
  id: string;
  kind: 'initial' | 'manual' | 'scheduled';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  pagesTotal: number | null;
  pagesProcessed: number;
  itemsSeen: number;
  itemsChanged: number;
  startedAt: Date | null;
  completedAt: Date | null;
  errorCode: string | null;
};

export class SyncConflictError extends Error {
  readonly existingRunId: string;

  constructor(existingRunId: string) {
    super('Une synchronisation est déjà en cours pour ce compte');
    this.name = 'SyncConflictError';
    this.existingRunId = existingRunId;
  }
}

/** Projection exposée par l'API : rien de plus que ce que l'écran affiche (§17). */
const runColumns = {
  id: syncRuns.id,
  kind: syncRuns.kind,
  status: syncRuns.status,
  pagesTotal: syncRuns.pagesTotal,
  pagesProcessed: syncRuns.pagesProcessed,
  itemsSeen: syncRuns.itemsSeen,
  itemsChanged: syncRuns.itemsChanged,
  startedAt: syncRuns.startedAt,
  completedAt: syncRuns.completedAt,
  errorCode: syncRuns.errorCode,
};

export async function getCurrentRun(userId: string): Promise<SyncRunView | null> {
  const rows = await db
    .select(runColumns)
    .from(syncRuns)
    .where(and(eq(syncRuns.userId, userId), sql`${syncRuns.status} in ('queued', 'running')`))
    .limit(1);

  return rows[0] ?? null;
}

export async function getRun(userId: string, runId: string): Promise<SyncRunView | null> {
  // Le filtrage par `user_id` vient de la session, jamais du client (§18.5).
  const rows = await db
    .select(runColumns)
    .from(syncRuns)
    .where(and(eq(syncRuns.id, runId), eq(syncRuns.userId, userId)))
    .limit(1);

  return rows[0] ?? null;
}

export async function getLastCompletedRun(userId: string): Promise<SyncRunView | null> {
  const rows = await db
    .select(runColumns)
    .from(syncRuns)
    .where(and(eq(syncRuns.userId, userId), eq(syncRuns.status, 'completed')))
    .orderBy(sql`${syncRuns.completedAt} desc`)
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Crée un run et sa tâche. Si un run est déjà actif, retourne celui-ci plutôt que d'en
 * créer un second : l'appel est idempotent, comme l'exige §18.2 pour une route mutante.
 */
export async function startSync(
  userId: string,
  kind: 'initial' | 'manual' | 'scheduled',
  now = new Date(),
): Promise<{ run: SyncRunView; created: boolean }> {
  const existing = await getCurrentRun(userId);
  if (existing) {
    return { run: existing, created: false };
  }

  if (kind === 'scheduled') {
    const last = await getLastCompletedRun(userId);
    if (
      last?.completedAt &&
      now.getTime() - last.completedAt.getTime() < SCHEDULED_MIN_INTERVAL_MS
    ) {
      return { run: last, created: false };
    }
  }

  let created: SyncRunView;
  try {
    const rows = await db
      .insert(syncRuns)
      .values({ userId, kind, status: 'queued' })
      .returning(runColumns);
    created = rows[0]!;
  } catch (cause) {
    // L'index unique partiel a tranché une course entre deux demandes simultanées.
    const concurrent = await getCurrentRun(userId);
    if (concurrent) {
      return { run: concurrent, created: false };
    }
    throw cause;
  }

  await enqueue({
    type: TASK_SYNC_COLLECTION,
    payload: { syncRunId: created.id, userId },
    dedupeKey: `sync:${userId}`,
    maxAttempts: 5,
  });

  log.info({ userId, syncRunId: created.id, kind }, 'synchronisation demandée');

  return { run: created, created: true };
}

type PageOutcome = { seen: number; changed: number; releaseIds: string[] };

/**
 * Traite une page de collection : upsert des éditions et des instances possédées.
 * Deux exemplaires d'une même édition restent deux instances distinctes (COLL-005).
 */
async function processPage(
  userId: string,
  syncRunId: string,
  page: Awaited<ReturnType<DiscogsApi['getCollectionPage']>>,
  now: Date,
): Promise<PageOutcome> {
  const releaseIds: string[] = [];
  let changed = 0;

  for (const item of page.releases) {
    const info = item.basic_information;
    const discogsReleaseId = String(info.id);
    releaseIds.push(discogsReleaseId);

    const releaseId = await upsertReleaseSummary({
      discogsReleaseId,
      title: info.title,
      masterId:
        info.master_id === null || info.master_id === undefined ? null : String(info.master_id),
      year: info.year ?? null,
      genres: info.genres ?? [],
      styles: info.styles ?? [],
      formats: info.formats ?? [],
      primaryImageUrl: info.cover_image ?? info.thumb ?? null,
      artists: info.artists ?? [],
    });

    const dateAdded = item.date_added ? new Date(item.date_added) : null;

    const result = await db
      .insert(collectionInstances)
      .values({
        userId,
        releaseId,
        discogsInstanceId: String(item.instance_id),
        discogsFolderId:
          item.folder_id === null || item.folder_id === undefined ? null : String(item.folder_id),
        rating: item.rating ?? null,
        dateAdded: dateAdded && !Number.isNaN(dateAdded.getTime()) ? dateAdded : null,
        isActive: true,
        lastSeenSyncId: syncRunId,
      })
      .onConflictDoUpdate({
        target: [collectionInstances.userId, collectionInstances.discogsInstanceId],
        set: {
          releaseId,
          rating: item.rating ?? null,
          // Un album réapparu dans la collection redevient actif.
          isActive: true,
          removedAt: null,
          lastSeenSyncId: syncRunId,
          updatedAt: now,
        },
      })
      .returning({ id: collectionInstances.id });

    if (result[0]) {
      changed += 1;
    }
  }

  return { seen: page.releases.length, changed, releaseIds };
}

/** Priorité normale de l'import en arrière-plan (§9.4) : un simple FIFO. */
const PRIORITY_BACKGROUND_IMPORT = 0;

/**
 * Priorité d'une récupération demandée par un clic utilisateur (Lot 6bis) : passe devant
 * la file d'import sans changer le rythme des appels Discogs — `enqueue()` ne fait que
 * réordonner ce que le worker traite en premier, le régulateur de débit (`pacer.ts`,
 * §12.3) continue de s'appliquer à chaque appel, prioritaire ou non.
 */
const PRIORITY_USER_REQUESTED = 100;

/**
 * Programme le chargement détaillé des éditions inconnues ou périmées.
 * La clé de déduplication porte sur l'édition, pas sur l'utilisateur : deux collections
 * contenant le même disque ne déclenchent qu'un seul appel Discogs (§12.2).
 */
async function scheduleDetailFetches(discogsReleaseIds: string[]): Promise<number> {
  const stale = await selectStaleReleaseIds([...new Set(discogsReleaseIds)]);

  let scheduled = 0;
  for (const discogsReleaseId of stale) {
    const taskId = await enqueue({
      type: TASK_FETCH_RELEASE,
      payload: { discogsReleaseId },
      dedupeKey: `release:${discogsReleaseId}`,
      priority: PRIORITY_BACKGROUND_IMPORT,
    });

    if (taskId) {
      scheduled += 1;
    }
  }

  return scheduled;
}

/**
 * Fait passer la récupération d'une édition devant la file d'import en arrière-plan.
 *
 * Déclenchée par un clic explicite de lecture (bouton play, fiche album) sur une édition
 * dont les pistes ne sont pas encore connues — jamais par un simple affichage, pour ne
 * pas consommer de quota Discogs sans demande de l'utilisateur (§4.2, même principe que
 * la résolution de piste). Sans effet si l'édition est déjà à jour : `enqueue()` ne fait
 * remonter la priorité qu'à une tâche réellement programmée.
 */
export async function requestPriorityReleaseFetch(discogsReleaseId: string): Promise<void> {
  const stale = await selectStaleReleaseIds([discogsReleaseId]);
  if (stale.length === 0) {
    return;
  }

  await enqueue({
    type: TASK_FETCH_RELEASE,
    payload: { discogsReleaseId },
    dedupeKey: `release:${discogsReleaseId}`,
    priority: PRIORITY_USER_REQUESTED,
    // Ne repousse jamais une tentative déjà en cours de backoff : `enqueue()` prend le
    // plus proche des deux `run_after`, celui-ci ne compte donc que s'il est plus tôt.
    runAfter: new Date(),
  });
}

/**
 * Exécute (ou reprend) la synchronisation d'une collection.
 *
 * La reprise s'appuie sur `pages_processed` : une tâche relancée après un 429 repart de
 * la dernière page confirmée, pas du début (§12.3).
 */
export async function runCollectionSync(
  syncRunId: string,
  api: DiscogsApi = liveDiscogsApi,
  now = new Date(),
): Promise<{ completed: boolean; pagesProcessed: number }> {
  const runRows = await db.select().from(syncRuns).where(eq(syncRuns.id, syncRunId)).limit(1);
  const run = runRows[0];

  if (!run || run.status === 'completed' || run.status === 'cancelled') {
    return { completed: run?.status === 'completed', pagesProcessed: run?.pagesProcessed ?? 0 };
  }

  const userRows = await db
    .select({ username: users.discogsUsername })
    .from(users)
    .where(eq(users.id, run.userId))
    .limit(1);
  const username = userRows[0]?.username;

  if (!username) {
    throw new DiscogsApiError({
      code: 'SYNC_USER_MISSING',
      message: 'Compte introuvable',
      retryable: false,
    });
  }

  const tokens = await getDiscogsTokens(run.userId);
  if (!tokens) {
    throw new DiscogsApiError({
      code: 'SYNC_CREDENTIALS_MISSING',
      message: 'Jetons Discogs absents : reconnexion nécessaire',
      retryable: false,
    });
  }

  await db
    .update(syncRuns)
    .set({ status: 'running', startedAt: run.startedAt ?? now, updatedAt: now })
    .where(eq(syncRuns.id, syncRunId));

  let pagesProcessed = run.pagesProcessed;
  let pagesTotal = run.pagesTotal;
  let itemsSeen = run.itemsSeen;
  let itemsChanged = run.itemsChanged;

  // Boucle de pagination : on repart de la page suivant la dernière confirmée.
  while (pagesTotal === null || pagesProcessed < pagesTotal) {
    const pageNumber = pagesProcessed + 1;
    const page = await api.getCollectionPage(tokens, username, pageNumber);

    pagesTotal = page.pagination.pages;

    const outcome = await processPage(run.userId, syncRunId, page, now);
    await scheduleDetailFetches(outcome.releaseIds);

    pagesProcessed = pageNumber;
    itemsSeen += outcome.seen;
    itemsChanged += outcome.changed;

    // Le compteur n'avance qu'après écriture réussie de la page : c'est ce qui rend la
    // reprise sûre. Un échec plus loin ne rejouera que la page interrompue.
    await db
      .update(syncRuns)
      .set({ pagesTotal, pagesProcessed, itemsSeen, itemsChanged, updatedAt: new Date() })
      .where(eq(syncRuns.id, syncRunId));

    if (pagesTotal === 0) {
      break;
    }
  }

  // SYNC-005 et SYNC-007 : la désactivation n'a lieu qu'ici, une fois toutes les pages
  // reçues sans erreur. Un import interrompu ne masque jamais un album encore possédé.
  const deactivated = await db
    .update(collectionInstances)
    .set({ isActive: false, removedAt: now, updatedAt: now })
    .where(
      and(
        eq(collectionInstances.userId, run.userId),
        eq(collectionInstances.isActive, true),
        or(
          isNull(collectionInstances.lastSeenSyncId),
          ne(collectionInstances.lastSeenSyncId, syncRunId),
        ),
      ),
    )
    .returning({ id: collectionInstances.id });

  await db
    .update(syncRuns)
    .set({
      status: 'completed',
      completedAt: new Date(),
      pagesTotal,
      pagesProcessed,
      itemsSeen,
      itemsChanged,
      errorCode: null,
      updatedAt: new Date(),
    })
    .where(eq(syncRuns.id, syncRunId));

  log.info(
    { syncRunId, userId: run.userId, pagesProcessed, itemsSeen, deactivated: deactivated.length },
    'synchronisation terminée',
  );

  return { completed: true, pagesProcessed };
}

export async function markRunFailed(
  syncRunId: string,
  errorCode: string,
  now = new Date(),
): Promise<void> {
  await db
    .update(syncRuns)
    .set({ status: 'failed', errorCode, completedAt: now, updatedAt: now })
    .where(eq(syncRuns.id, syncRunId));
}

/** Le nombre d'instances actives d'un utilisateur, pour l'écran de progression. */
export async function countActiveInstances(userId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<string>`count(*)::text` })
    .from(collectionInstances)
    .where(and(eq(collectionInstances.userId, userId), eq(collectionInstances.isActive, true)));

  return Number(rows[0]?.count ?? 0);
}
