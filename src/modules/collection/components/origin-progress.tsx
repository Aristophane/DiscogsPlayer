'use client';

import { useEffect, useState } from 'react';
import { t } from '@/lib/i18n';
import { originProgressSchema, type OriginProgress } from '../origin-progress';

export function OriginProgressStatus({ initial }: { initial: OriginProgress }) {
  const [progress, setProgress] = useState(initial);
  const [disconnected, setDisconnected] = useState(false);
  useEffect(() => {
    if (!initial.pending && !initial.failed) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch('/api/collection/origins', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Origin progress unavailable');
        const next = originProgressSchema.parse(await response.json());
        // A collection switch in another tab must not replace this collection's status.
        if (controller.signal.aborted || next.ownerId !== initial.ownerId) return;
        setProgress(next);
        setDisconnected(false);
        if (!next.pending && !next.failed) return;
      } catch {
        if (controller.signal.aborted) return;
        setDisconnected(true);
      }
      timer = setTimeout(poll, 5000);
    };
    timer = setTimeout(poll, 5000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [initial]);
  return (
    <div className="w-full text-xs" role="status">
      <p>
        {t('crate.originProgress', {
          known: progress.known,
          pending: progress.pending,
          unavailable: progress.unavailable,
          failed: progress.failed,
        })}
      </p>
      {progress.pending ? <p>{t('crate.originsPending')}</p> : null}
      {progress.failed ? (
        <p>{t(progress.workerUpdateRequired ? 'crate.originsWorker' : 'crate.originsFailed')}</p>
      ) : null}
      {progress.known > initial.known ? <p>{t('crate.originsReady')}</p> : null}
      {disconnected ? <p>{t('crate.originsDisconnected')}</p> : null}
    </div>
  );
}
