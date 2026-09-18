'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@/lib/i18n';
import { highlightsSchema, type Highlights } from '../home-contracts';

export function RefreshStatistics({
  highlights,
  onUpdate,
}: {
  highlights: Highlights;
  onUpdate: (value: Highlights) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [seconds, setSeconds] = useState(5);
  const remaining = useRef(5);
  const request = useRef<AbortController | null>(null);
  const loading = highlights.fresh < highlights.total;
  const percent =
    highlights.total === 0 ? 100 : Math.floor((highlights.fresh / highlights.total) * 100);

  const refresh = useCallback(async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    try {
      const response = await fetch('/api/collection/highlights', {
        cache: 'no-store',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      });
      if (!response.ok) throw new Error('highlights');
      const data = highlightsSchema.parse(await response.json());
      if (!controller.signal.aborted) {
        onUpdate(data);
        setError(false);
      }
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (!controller.signal.aborted) {
        setPending(false);
        remaining.current = 5;
        setSeconds(5);
      }
      if (request.current === controller) request.current = null;
    }
  }, [onUpdate]);

  useEffect(() => {
    if (!loading) return;
    const timer = window.setInterval(() => {
      if (request.current || document.visibilityState === 'hidden') return;
      remaining.current -= 1;
      setSeconds(remaining.current);
      if (remaining.current <= 0) void refresh();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [loading, refresh]);

  useEffect(() => () => request.current?.abort(), []);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted">
        <p role="status">
          {t(loading ? 'home.highlights.progress' : 'home.highlights.complete', {
            fresh: highlights.fresh,
            total: highlights.total,
          })}
        </p>
        <span className="tabular-nums">{percent} %</span>
      </div>
      <div
        role="progressbar"
        aria-label={t('home.highlights.progressLabel')}
        aria-valuemin={0}
        aria-valuemax={highlights.total}
        aria-valuenow={highlights.fresh}
        className="h-2 overflow-hidden rounded-full bg-surface"
      >
        <div
          className="h-full origin-left rounded-full bg-foreground transition-transform duration-500 motion-reduce:transition-none"
          style={{ transform: `scaleX(${percent / 100})` }}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          {loading
            ? t(pending ? 'home.highlights.updating' : 'home.highlights.countdown', { seconds })
            : t('home.highlights.current')}
        </span>
        <button
          type="button"
          disabled={pending}
          aria-busy={pending}
          className="min-h-10 text-sm underline underline-offset-4 disabled:opacity-50"
          onClick={() => void refresh()}
        >
          {pending ? t('collection.loading') : t('home.highlights.refresh')}
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-muted">
          {t('home.highlights.error')}
        </p>
      ) : null}
    </div>
  );
}
