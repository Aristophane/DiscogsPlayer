'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { t, type MessageKey } from '@/lib/i18n';

/**
 * Progression de l'import (§6.1, §12.3).
 *
 * L'état affiché doit rester compréhensible : en attente, en cours, terminé, interrompu.
 * Le sondage s'arrête dès que le run n'est plus actif — inutile d'interroger le serveur
 * indéfiniment une fois l'import fini.
 */
type Run = {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  pagesTotal: number | null;
  pagesProcessed: number;
  itemsSeen: number;
};

const STATUS_KEYS: Record<Run['status'], MessageKey> = {
  queued: 'import.status.queued',
  running: 'import.status.running',
  completed: 'import.status.completed',
  failed: 'import.status.failed',
  cancelled: 'import.status.cancelled',
};

export function ImportProgress({ initialRun }: { initialRun: Run | null }) {
  const [run, setRun] = useState<Run | null>(initialRun);
  const [busy, setBusy] = useState(false);

  const isActive = run?.status === 'queued' || run?.status === 'running';

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/sync-runs/current', { cache: 'no-store' });
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { run: Run | null };
      setRun(data.run);
    } catch {
      // Une interruption réseau ne doit pas casser l'écran : le sondage suivant réessaiera.
    }
  }, []);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    const timer = setInterval(refresh, 2_000);
    return () => clearInterval(timer);
  }, [isActive, refresh]);

  async function start() {
    setBusy(true);
    try {
      await fetch('/api/sync-runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const progress =
    run === null
      ? null
      : run.pagesTotal === null
        ? t('import.progress.pagesUnknown', { processed: run.pagesProcessed })
        : t('import.progress.pages', { processed: run.pagesProcessed, total: run.pagesTotal });

  return (
    <section className="flex flex-col gap-4">
      <p aria-live="polite" className="text-lg">
        {run ? t(STATUS_KEYS[run.status]) : t('import.never')}
      </p>

      {run ? (
        <div className="flex flex-col gap-1 text-sm text-muted">
          <span>{progress}</span>
          <span>{t('import.progress.items', { count: run.itemsSeen })}</span>
        </div>
      ) : null}

      {run?.status === 'failed' ? (
        <p role="alert" className="text-sm text-amber-600 dark:text-amber-400">
          {t('import.error.retryable')}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={start}
          disabled={busy || isActive}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
        >
          {run?.status === 'failed' ? t('import.action.retry') : t('import.action.start')}
        </button>
        <Link href="/collection" className="rounded-md border border-border px-4 py-2 text-sm">
          {t('import.action.browse')}
        </Link>
      </div>

      {isActive ? <p className="text-sm text-muted">{t('import.explanation')}</p> : null}
    </section>
  );
}
