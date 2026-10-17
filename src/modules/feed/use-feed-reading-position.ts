'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { z } from 'zod';
import { feedPageSchema, type FeedItem, type FeedPage } from './contracts';

const positionSchema = z.object({
  version: z.literal(1),
  anchor: z.object({ id: z.string().uuid(), offset: z.number().finite() }).nullable(),
  y: z.number().finite().nonnegative(),
  loadedCount: z.number().int().min(0).max(20_000),
  expandedIds: z.array(z.string().uuid()).max(1000),
});
type ReadingPosition = z.infer<typeof positionSchema>;

function readPosition(key: string): ReadingPosition | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? positionSchema.parse(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function headerBottom() {
  return document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Seuls des identifiants et une position sont conservés ; les publications sont relues côté serveur. */
export function useFeedReadingPosition({
  userId,
  initial,
  items,
  expandedIds,
  container,
  restore,
}: {
  userId: string;
  initial: FeedPage;
  items: FeedItem[];
  expandedIds: string[];
  container: RefObject<HTMLElement | null>;
  restore: (page: FeedPage, expandedIds: string[]) => void;
}) {
  const key = `dp:feed-reading:${userId}`;
  const initialPage = useRef(initial);
  const current = useRef({ items, expandedIds });
  const [restoring, setRestoring] = useState(true);
  useEffect(() => {
    current.current = { items, expandedIds };
  }, [items, expandedIds]);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    let finished = false;
    let frame: number | null = null;
    let saved = readPosition(key);
    const previousRestoration = window.history.scrollRestoration;
    if (saved) window.history.scrollRestoration = 'manual';

    function persist(position: ReadingPosition) {
      saved = position;
      try {
        localStorage.setItem(key, JSON.stringify(position));
      } catch {
        /* Stockage facultatif. */
      }
    }

    function capture() {
      if (!finished || !container.current?.isConnected || window.location.pathname !== '/') return;
      const cards = [...container.current.querySelectorAll<HTMLElement>('[data-feed-id]')];
      const top = headerBottom();
      const card = cards.find((node) => node.getBoundingClientRect().bottom > top) ?? cards.at(-1);
      persist({
        version: 1,
        anchor: card
          ? { id: card.dataset.feedId!, offset: card.getBoundingClientRect().top - top }
          : null,
        y: Math.max(0, window.scrollY),
        loadedCount: Math.min(current.current.items.length, 20_000),
        expandedIds: current.current.expandedIds.slice(-1000),
      });
    }

    function queueCapture() {
      if (frame !== null || !finished || document.visibilityState === 'hidden') return;
      frame = requestAnimationFrame(() => {
        frame = null;
        capture();
      });
    }

    function place(position: ReadingPosition) {
      const card = position.anchor
        ? container.current?.querySelector<HTMLElement>(`[data-feed-id="${position.anchor.id}"]`)
        : null;
      const y =
        card && position.anchor
          ? window.scrollY +
            card.getBoundingClientRect().top -
            headerBottom() -
            position.anchor.offset
          : position.y;
      window.scrollTo({ top: Math.max(0, y), behavior: 'instant' });
    }

    async function resume() {
      try {
        if (!saved) return;
        let page = initialPage.current;
        let accumulated = [...page.items];
        const ids = new Set(accumulated.map(({ id }) => id));
        const seenCursors = new Set<string>();
        const target = saved.anchor?.id;
        // Le prochain jour peut ajouter des publications avant la position sauvegardée.
        const budget = Math.min(saved.loadedCount + 120, 20_000);
        while (
          page.nextCursor &&
          !controller.signal.aborted &&
          accumulated.length < budget &&
          (target ? !ids.has(target) : accumulated.length < saved.loadedCount)
        ) {
          if (seenCursors.has(page.nextCursor)) break;
          seenCursors.add(page.nextCursor);
          const response = await fetch(
            `/api/feed?cursor=${encodeURIComponent(page.nextCursor)}&limit=100`,
            {
              cache: 'no-store',
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
            },
          );
          if (!response.ok) throw new Error('Feed restoration unavailable');
          page = feedPageSchema.parse(await response.json());
          const fresh = page.items.filter(({ id }) => !ids.has(id));
          fresh.forEach(({ id }) => ids.add(id));
          accumulated = [...accumulated, ...fresh];
        }
        if (!alive || controller.signal.aborted) return;
        restore({ ...page, items: accumulated }, saved.expandedIds);
        await nextFrame();
        await nextFrame();
        if (alive && !controller.signal.aborted) place(saved);
      } catch {
        // Une panne ne remplace pas une ancienne publication par une copie hors ligne
        // qui aurait pu perdre son autorisation de partage. La sélection actuelle reste lisible.
      } finally {
        await nextFrame();
        if (alive) {
          finished = true;
          setRestoring(false);
        }
      }
    }

    function interrupt() {
      if (!finished) controller.abort();
    }
    function onPageHide() {
      // La visibilité peut déjà être "hidden" lors de pagehide : le dernier scroll
      // capturé reste disponible et ne doit pas être remplacé par le zéro d'une autre page.
      if (finished) capture();
      else if (saved) persist(saved);
    }
    function onVisibility() {
      if (document.visibilityState === 'hidden') {
        // Capturer avant suspension sans dépendre d'un prochain frame navigateur.
        capture();
      } else if (finished && saved && saved.y > 0 && window.scrollY === 0) {
        const position = saved;
        requestAnimationFrame(() => {
          if (alive) place(position);
        });
      }
    }

    window.addEventListener('scroll', queueCapture, { passive: true });
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('click', capture, true);
    for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown'])
      window.addEventListener(event, interrupt, { passive: true });
    void resume();
    return () => {
      alive = false;
      controller.abort();
      if (frame !== null) cancelAnimationFrame(frame);
      if (saved) persist(saved);
      window.history.scrollRestoration = previousRestoration;
      window.removeEventListener('scroll', queueCapture);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('click', capture, true);
      for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown'])
        window.removeEventListener(event, interrupt);
    };
  }, [key, container, restore]);

  return restoring;
}
