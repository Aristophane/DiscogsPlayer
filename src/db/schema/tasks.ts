/**
 * File de tâches en base — Lot 2 (SPECIFICATION.md §9.4).
 *
 * Pas de Redis ni de bus de messages en v0 : PostgreSQL et `FOR UPDATE SKIP LOCKED`
 * suffisent, et le travail reste transactionnel avec les données métier.
 */
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const taskStatus = pgEnum('task_status', [
  'queued',
  'running',
  'retry_wait',
  'completed',
  'failed',
  'cancelled',
]);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    type: text('type').notNull(),
    /** Validé par un schéma Zod propre au type avant exécution. */
    payload: jsonb('payload').notNull(),
    status: taskStatus('status').notNull().default('queued'),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    /** Backoff exponentiel avec jitter : la tâche n'est pas éligible avant cette date. */
    runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: text('locked_by'),
    lastErrorCode: text('last_error_code'),
    /** Message nettoyé : ni jeton, ni URL signée, ni corps de réponse brut (§9.4, §21.1). */
    lastErrorMessage: text('last_error_message'),
    /**
     * Déduplication métier (§12.2) : une seule tâche active par clé. Deux utilisateurs
     * possédant la même édition ne déclenchent qu'un seul chargement de détail.
     */
    dedupeKey: text('dedupe_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('tasks_claimable_idx')
      .on(table.runAfter)
      .where(sql`${table.status} in ('queued', 'retry_wait')`),
    index('tasks_locked_idx')
      .on(table.lockedAt)
      .where(sql`${table.status} = 'running'`),
    // L'unicité ne porte que sur les tâches vivantes : une tâche terminée ne doit pas
    // empêcher d'en reprogrammer une identique plus tard.
    uniqueIndex('tasks_dedupe_key_active_idx')
      .on(table.dedupeKey)
      .where(sql`${table.status} in ('queued', 'running', 'retry_wait')`),
  ],
);
