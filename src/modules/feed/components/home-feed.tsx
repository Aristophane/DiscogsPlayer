'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { t, type MessageKey } from '@/lib/i18n';
import { AlbumCover } from '@/modules/collection/components/album-cover';
import { PersonalReleaseLink } from '@/modules/collection/components/personal-release-link';
import { coverProxyUrl } from '@/modules/collection/cover';
import { usePlayback } from '@/modules/playback/playback-context';
import type { AnecdoteTopic } from '../anecdotes';
import { feedPageSchema, type FeedItem, type FeedPage } from '../contracts';
import { useFeedReadingPosition } from '../use-feed-reading-position';
import styles from './home-feed.module.css';

const LABELS: Record<FeedItem['kind'], MessageKey> = {
  addition: 'feed.kind.addition',
  listen: 'feed.kind.listen',
  stat: 'feed.kind.stat',
  album: 'feed.kind.album',
  artist: 'feed.kind.artist',
  news: 'feed.kind.news',
};
const TOPIC_LABELS: Record<AnecdoteTopic, MessageKey> = {
  recording: 'feed.topic.recording',
  artwork: 'feed.topic.artwork',
  name: 'feed.topic.name',
  unexpected: 'feed.topic.unexpected',
  milestone: 'feed.topic.milestone',
};
const dateFormat = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'long',
  timeZone: 'Europe/Paris',
});
const euros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

function FeedCard({
  item,
  activeOwnerId,
  expanded,
  onToggle,
  eager,
}: {
  item: FeedItem;
  activeOwnerId: string;
  expanded: boolean;
  onToggle: () => void;
  eager: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const { playAlbum } = usePlayback();
  const router = useRouter();
  const story = item.story;
  const text =
    story?.text ??
    (item.kind === 'addition'
      ? t('feed.additionText', { username: item.ownerUsername ?? '' })
      : item.kind === 'stat'
        ? t('feed.statText')
        : t(item.ownerUsername ? 'feed.listenFriend' : 'feed.listenOwn', {
            username: item.ownerUsername ?? '',
          }));
  const canExpand = text.length > 140;

  async function act(action: 'play' | 'stats') {
    setPending(true);
    setError(false);
    try {
      if (activeOwnerId !== item.ownerId) {
        const response = await fetch('/api/collection-shares/active', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ownerId: item.ownerId }),
        });
        if (!response.ok) throw new Error('Collection unavailable');
      }
      if (action === 'play') await playAlbum(item.discogsReleaseId);
      else router.push('/stats');
      if (activeOwnerId !== item.ownerId || action === 'stats') router.refresh();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <article
      data-feed-id={item.id}
      className={styles.card}
      aria-labelledby={`post-title-${item.id}`}
    >
      <div className={styles.heading}>
        <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span className="font-medium text-foreground">
            {t(story?.editorial ? TOPIC_LABELS[story.editorial.topic] : LABELS[item.kind])}
          </span>
          <span aria-hidden="true">·</span>
          <span className="break-words">
            {item.ownerUsername
              ? t('feed.collectionOf', { username: item.ownerUsername })
              : t('feed.yourCollection')}
          </span>
          {story?.language === 'en' ? (
            <span lang="en" className="ml-auto text-[10px] uppercase tracking-wider">
              EN
            </span>
          ) : null}
        </div>
        <h2
          id={`post-title-${item.id}`}
          lang={story?.language}
          className="break-words text-base font-semibold leading-snug tracking-tight sm:text-lg"
        >
          {story?.title ?? item.title}
        </h2>
        <p className="mt-1 break-words text-xs leading-relaxed text-muted">
          {item.artists}
          {story ? ` · ${item.title}` : ''}
          {item.year ? ` · ${item.year}` : ''}
        </p>
      </div>
      <div data-feed-cover className={styles.cover}>
        <PersonalReleaseLink
          releaseId={item.discogsReleaseId}
          ownerId={item.ownerId}
          switchToOwn={item.ownerId !== activeOwnerId}
          layout="cover"
        >
          <div className="relative aspect-square w-full overflow-hidden rounded-md bg-surface">
            <AlbumCover
              src={coverProxyUrl(item.coverUrl)}
              title={item.title}
              artists={item.artists}
              eager={eager}
            />
          </div>
        </PersonalReleaseLink>
      </div>
      <div className={styles.story}>
        {item.kind === 'stat' && item.statistic?.price ? (
          <p className="mb-1 text-xl font-semibold tabular-nums">
            {t('home.highlights.price', { price: euros.format(Number(item.statistic.price)) })}
          </p>
        ) : null}
        <p
          id={`post-text-${item.id}`}
          lang={story?.language}
          className={`whitespace-pre-line break-words text-sm leading-relaxed ${canExpand && !expanded ? 'line-clamp-3' : ''}`}
        >
          {text}
        </p>
      </div>
      {story ? (
        <div
          className={`${styles.sources} flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted`}
        >
          <a
            href={story.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="break-words underline underline-offset-4"
          >
            {story.sourceName} <span aria-hidden="true">↗</span>
          </a>
          {story.publishedAt ? (
            <time dateTime={story.publishedAt}>
              {dateFormat.format(new Date(story.publishedAt))}
            </time>
          ) : null}
          {story.licenseUrl ? (
            <a
              href={story.licenseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4"
            >
              {t('feed.license')}
            </a>
          ) : null}
        </div>
      ) : null}
      {item.kind === 'addition' && item.addedAt ? (
        <p className={`${styles.sources} text-xs text-muted`}>
          <time dateTime={item.addedAt}>{dateFormat.format(new Date(item.addedAt))}</time>
        </p>
      ) : null}
      <div className={`${styles.actions} flex flex-wrap items-center gap-x-5 gap-y-1 text-xs`}>
        {canExpand ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={`post-text-${item.id}`}
            onClick={onToggle}
            className="min-h-10 font-medium underline decoration-border underline-offset-4"
          >
            {t(expanded ? 'feed.collapse' : 'feed.expand')}
          </button>
        ) : null}
        <button
          type="button"
          disabled={pending}
          onClick={() => void act('play')}
          aria-label={t('feed.playAlbum', { title: item.title })}
          className="flex min-h-10 items-center gap-2 font-medium disabled:opacity-50"
        >
          <span aria-hidden="true">▶</span>
          {t('feed.listen')}
        </button>
        <div className="flex min-h-10 items-center">
          <PersonalReleaseLink
            releaseId={item.discogsReleaseId}
            ownerId={item.ownerId}
            switchToOwn={item.ownerId !== activeOwnerId}
          >
            <span className="text-muted underline underline-offset-4">{t('feed.record')}</span>
          </PersonalReleaseLink>
        </div>
        {item.kind === 'stat' ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => void act('stats')}
            className="min-h-10 text-muted underline underline-offset-4 disabled:opacity-50"
          >
            {t('feed.seeStats')}
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className={`${styles.error} text-xs text-muted`}>
          {t('sharing.error')}
        </p>
      ) : null}
    </article>
  );
}

export function HomeFeed({
  initial,
  activeOwnerId,
  userId,
}: {
  initial: FeedPage;
  activeOwnerId: string;
  userId: string;
}) {
  const [items, setItems] = useState(initial.items);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const [status, setStatus] = useState(initial.status);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [updates, setUpdates] = useState<FeedPage | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const request = useRef<AbortController | null>(null);
  const knownIds = useRef(new Set(initial.items.map(({ id }) => id)));
  const [waiting, setWaiting] = useState(false);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const container = useRef<HTMLElement>(null);
  const restore = useCallback((page: FeedPage, expanded: string[]) => {
    setItems(page.items);
    knownIds.current = new Set(page.items.map(({ id }) => id));
    setNextCursor(page.nextCursor);
    setExpandedIds(expanded);
    setStatus(page.status);
  }, []);
  const restoring = useFeedReadingPosition({
    userId,
    initial,
    items,
    expandedIds,
    container,
    restore,
  });

  const loadMore = useCallback(async () => {
    if (!nextCursor || inFlight.current || restoring) return;
    inFlight.current = true;
    setLoading(true);
    setError(false);
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch(`/api/feed?cursor=${encodeURIComponent(nextCursor)}`, {
        cache: 'no-store',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      });
      if (!response.ok) throw new Error('Feed unavailable');
      const page = feedPageSchema.parse(await response.json());
      if (controller.signal.aborted) return;
      const fresh = page.items.filter(({ id }) => !knownIds.current.has(id));
      fresh.forEach(({ id }) => knownIds.current.add(id));
      setItems((current) => [...current, ...fresh]);
      setNextCursor(page.nextCursor === nextCursor ? null : page.nextCursor);
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      inFlight.current = false;
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [nextCursor, restoring]);

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    const target = sentinel.current;
    if (!target || !nextCursor || error || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries.some(({ isIntersecting }) => isIntersecting) &&
          document.visibilityState === 'visible'
        )
          void loadMore();
      },
      { rootMargin: '300px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [loadMore, nextCursor, error]);

  useEffect(() => {
    if (status !== 'pending' || restoring) return;
    const controller = new AbortController();
    let polls = 0;
    let busy = false;
    const timer = setInterval(async () => {
      if (busy || document.visibilityState !== 'visible') return;
      busy = true;
      try {
        const response = await fetch('/api/feed', {
          cache: 'no-store',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]),
        });
        if (!response.ok) throw new Error('Feed unavailable');
        const page = feedPageSchema.parse(await response.json());
        if (controller.signal.aborted) return;
        setStatus(page.status);
        if (page.items.some(({ id }) => !knownIds.current.has(id))) setUpdates(page);
      } catch {
        /* Le fil local reste lisible pendant une panne des sources ou du worker. */
      } finally {
        busy = false;
        if (++polls >= 12) {
          clearInterval(timer);
          if (!controller.signal.aborted) setWaiting(true);
        }
      }
    }, 5_000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [status, restoring]);

  function showUpdates() {
    if (!updates) return;
    request.current?.abort();
    setItems(updates.items);
    knownIds.current = new Set(updates.items.map(({ id }) => id));
    setNextCursor(updates.nextCursor);
    setUpdates(null);
    setError(false);
    setLoading(false);
  }

  return (
    <section ref={container} aria-label={t('feed.title')} aria-busy={restoring || undefined}>
      {updates ? (
        <button
          type="button"
          onClick={showUpdates}
          className="my-4 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm font-medium"
        >
          {t('feed.updates')}
        </button>
      ) : null}
      {status === 'pending' ? (
        <p
          role="status"
          className={items.length ? 'sr-only' : 'px-4 py-4 text-xs leading-relaxed text-muted'}
        >
          {t(waiting ? 'feed.waiting' : 'feed.preparing')}
        </p>
      ) : null}
      <ol className="divide-y divide-border">
        {items.map((item, index) => (
          <li key={item.id} className="min-w-0">
            {index > 0 && items[index - 1]?.day !== item.day ? (
              <p className="px-4 pt-6 text-xs font-medium text-muted sm:px-6">
                {dateFormat.format(new Date(`${item.day}T12:00:00Z`))}
              </p>
            ) : null}
            <FeedCard
              item={item}
              activeOwnerId={activeOwnerId}
              eager={index === 0}
              expanded={expandedIds.includes(item.id)}
              onToggle={() =>
                setExpandedIds((current) =>
                  current.includes(item.id)
                    ? current.filter((id) => id !== item.id)
                    : [...current, item.id],
                )
              }
            />
          </li>
        ))}
      </ol>
      {status === 'partial' ? (
        <p className="px-4 py-3 text-xs leading-relaxed text-muted">{t('feed.partial')}</p>
      ) : null}
      {!items.length ? (
        <div className="py-12">
          <h2 className="text-lg font-medium">{t('feed.emptyTitle')}</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">{t('feed.empty')}</p>
          <div className="mt-5 flex gap-5 text-sm">
            <Link href="/import" className="underline underline-offset-4">
              {t('collection.sync')}
            </Link>
            <Link href="/amis" className="underline underline-offset-4">
              {t('nav.friends')}
            </Link>
          </div>
        </div>
      ) : null}
      <div ref={sentinel} className="h-1" aria-hidden="true" />
      {error ? (
        <p role="alert" className="mt-4 text-center text-sm text-muted">
          {t('feed.error')}
        </p>
      ) : null}
      {nextCursor ? (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={loading}
          className="my-6 min-h-11 w-full rounded-md border border-border px-4 py-3 text-sm disabled:opacity-50"
        >
          {t(loading ? 'feed.loading' : error ? 'feed.retry' : 'feed.more')}
        </button>
      ) : items.length ? (
        <p className="py-8 text-center text-xs text-muted">{t('feed.end')}</p>
      ) : null}
    </section>
  );
}
