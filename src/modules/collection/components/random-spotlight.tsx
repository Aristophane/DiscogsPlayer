'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@/lib/i18n';
import { PlayButton } from '@/modules/playback/components/play-button';
import { spotlightSchema, type Spotlight } from '../home-contracts';
import { coverProxyUrl } from '../cover';
import { AlbumCover } from './album-cover';

export function RandomSpotlight({ ownerId }: { ownerId: string }) {
  const [item, setItem] = useState<Spotlight>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null);
  const previousId = useRef<string | null>(null);
  const storageKey = `dp:home-spotlight:${ownerId}`;

  const draw = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    let previous = previousId.current;
    try {
      previous ??= sessionStorage.getItem(storageKey);
    } catch {
      /* Stockage facultatif. */
    }
    try {
      const query = previous ? `?previous=${encodeURIComponent(previous)}` : '';
      const response = await fetch(`/api/collection/spotlight${query}`, {
        cache: 'no-store',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      });
      if (!response.ok) throw new Error('spotlight');
      const result = spotlightSchema.parse(await response.json());
      if (controller.signal.aborted) return;
      setItem(result.item);
      setError(false);
      previousId.current = result.item?.discogsReleaseId ?? null;
      if (result.item) {
        try {
          sessionStorage.setItem(storageKey, result.item.discogsReleaseId);
        } catch {
          /* Stockage facultatif. */
        }
      }
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }, [storageKey]);

  useEffect(() => {
    void draw();
    return () => request.current?.abort();
  }, [draw]);

  return (
    <section aria-labelledby="random-spotlight" className="min-w-0">
      <h2 id="random-spotlight" className="text-xl font-semibold tracking-tight">
        {t('home.spotlight.title')}
      </h2>
      <p className="mt-1 text-sm text-muted">{t('home.spotlight.description')}</p>
      <div className="mt-5" aria-busy={pending}>
        {item ? (
          <>
            <Link
              href={`/sorties/${item.discogsReleaseId}`}
              className="group block rounded-md focus-visible:outline-2 focus-visible:outline-offset-4"
            >
              <div className="relative aspect-square w-full overflow-hidden rounded-md bg-surface">
                <AlbumCover
                  key={item.discogsReleaseId}
                  src={coverProxyUrl(item.coverUrl)}
                  title={item.title}
                  artists={item.artists}
                  eager
                />
              </div>
              <h3 className="mt-3 text-lg font-medium leading-snug">{item.title}</h3>
              <p className="mt-1 text-sm text-muted">
                {item.artists}
                {item.year ? ` · ${item.year}` : ''}
              </p>
            </Link>
            <div className="mt-4">
              <PlayButton kind="album" id={item.discogsReleaseId} />
            </div>
          </>
        ) : pending ? (
          <div
            className="flex aspect-square items-center justify-center rounded-md bg-surface text-sm text-muted"
            role="status"
          >
            {t('collection.loading')}
          </div>
        ) : !error ? (
          <p className="py-6 text-sm text-muted">{t('home.spotlight.empty')}</p>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-muted">
          {t('home.spotlight.error')}
        </p>
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setPending(true);
          setError(false);
          void draw();
        }}
        className="mt-3 min-h-10 text-sm underline underline-offset-4 disabled:opacity-50"
      >
        {t('home.spotlight.another')}
      </button>
    </section>
  );
}
