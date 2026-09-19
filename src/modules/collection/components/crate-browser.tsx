'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { t } from '@/lib/i18n';
import { groupCrateRecords, type CrateGroup, type CrateGrouping, type CrateRecord } from '../crate';
import { coverProxyUrl } from '../cover';
import { AlbumCover } from './album-cover';
import type { OriginProgress } from '../origin-progress';
import { OriginProgressStatus } from './origin-progress';
import styles from './crate-browser.module.css';

const GROUPINGS: CrateGrouping[] = ['genre', 'year', 'continent'];
const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max));

export function CrateBrowser({
  records,
  originProgress,
}: {
  records: CrateRecord[];
  originProgress?: OriginProgress;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [grouping, setGrouping] = useState<CrateGrouping>('genre');
  const groups = useMemo(() => groupCrateRecords(records, grouping), [records, grouping]);

  return (
    <div className={styles.browser}>
      <div className={styles.toolbar}>
        <label className={styles.field}>
          <span>{t('crate.grouping')}</span>
          <select
            value={grouping}
            onChange={(event) => {
              const next = GROUPINGS.find((value) => value === event.target.value);
              if (next) setGrouping(next);
            }}
          >
            {GROUPINGS.map((value) => (
              <option key={value} value={value}>
                {t(`crate.grouping.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <p className={styles.summary}>
          {t('crate.count', { count: records.length })}
          <span aria-hidden="true"> · </span>
          {t('crate.bins', { count: groups.length })}
        </p>
      </div>
      <div className={styles.groupingHint}>
        <p>{t(`crate.${grouping}Hint`)}</p>
        {grouping === 'continent' ? (
          <div className="flex flex-wrap items-center gap-x-3">
            {originProgress ? (
              <OriginProgressStatus key={JSON.stringify(originProgress)} initial={originProgress} />
            ) : null}
            <span>
              {t('crate.originCoverage', {
                known: records.filter((record) => record.originCountries?.length).length,
                total: records.length,
              })}
            </span>
            <button
              type="button"
              className="min-h-11 underline disabled:opacity-50"
              disabled={refreshing}
              onClick={() => startRefresh(() => router.refresh())}
            >
              {t(refreshing ? 'collection.loading' : 'crate.refreshOrigins')}
            </button>
          </div>
        ) : null}
      </div>
      <CrateExplorer
        key={`${grouping}:${groups.map((group) => `${group.id}:${group.items.map((item) => item.releaseId).join(',')}`).join(';')}`}
        groups={groups}
        grouping={grouping}
      />
    </div>
  );
}

/** Only nearby sleeves are mounted: the size of the collection does not change the 3D scene cost. */
function CrateExplorer({ groups, grouping }: { groups: CrateGroup[]; grouping: CrateGrouping }) {
  const router = useRouter();
  const flattened = useMemo(
    () => groups.flatMap((group) => group.items.map((record, index) => ({ record, group, index }))),
    [groups],
  );
  const [position, setPosition] = useState(0);
  const [opening, setOpening] = useState(false);
  const [dragging, setDragging] = useState(false);
  const sceneRef = useRef<HTMLDivElement>(null);
  const activeSleeveRef = useRef<HTMLButtonElement>(null);
  const crateFrontRef = useRef<HTMLDivElement>(null);
  const positionRef = useRef(position);
  const openingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClick = useRef(false);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    position: number;
    moved: boolean;
  } | null>(null);
  const wheel = useRef({ distance: 0, at: 0, lastEvent: 0 });
  const entry = flattened[position]!;
  const { record, group, index } = entry;
  const groupStart = position - index;
  const href = `/sorties/${encodeURIComponent(record.discogsReleaseId)}`;

  function goTo(next: number) {
    if (openingRef.current) return;
    const value = clamp(next, flattened.length - 1);
    positionRef.current = value;
    setPosition(value);
  }

  // A non-passive listener is required to consume the wheel only inside the crate.
  // At either end, native page scrolling remains available.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || openingRef.current) return;
      const delta =
        (Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX) *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scene.clientHeight : 1);
      if (!delta) return;
      const current = positionRef.current;
      const next = clamp(current + Math.sign(delta), flattened.length - 1);
      if (next === current) return;
      event.preventDefault();
      const now = performance.now();
      if (now - wheel.current.at < 180) return;
      if (
        Math.sign(delta) !== Math.sign(wheel.current.distance) ||
        now - wheel.current.lastEvent > 250
      )
        wheel.current.distance = 0;
      wheel.current.lastEvent = now;
      wheel.current.distance += delta;
      if (Math.abs(wheel.current.distance) < 38) return;
      wheel.current = { distance: 0, at: now, lastEvent: now };
      positionRef.current = next;
      setPosition(next);
    };
    scene.addEventListener('wheel', onWheel, { passive: false });
    return () => scene.removeEventListener('wheel', onWheel);
  }, [flattened.length]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      // Next can retain the page in its navigation cache. Leaving it also restores
      // the scene so returning from a record never preserves the lifting state.
      openingRef.current = false;
      setOpening(false);
    },
    [],
  );

  function openRecord() {
    if (openingRef.current || suppressClick.current) return;
    // Respect motion preferences without waiting for an invisible animation.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      router.push(href);
      return;
    }
    openingRef.current = true;
    setOpening(true);
    router.prefetch(href);
    timerRef.current = setTimeout(() => router.push(href), 650);
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0 || openingRef.current) return;
    suppressClick.current = false;
    drag.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      position: positionRef.current,
      moved: false,
    };
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const gesture = drag.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    if (event.pointerType === 'mouse' && event.buttons === 0) {
      drag.current = null;
      setDragging(false);
      return;
    }
    const dx = gesture.x - event.clientX;
    const dy = gesture.y - event.clientY;
    const distance = Math.abs(dx) > Math.abs(dy) ? dx : dy;
    if (!gesture.moved && Math.abs(distance) < 8) return;
    suppressClick.current = true;
    if (!gesture.moved) {
      gesture.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    }
    // A sleeve per 64 CSS pixels; both vertical and horizontal gestures work.
    goTo(gesture.position + Math.round(distance / 64));
  }

  function pointerEnd(event: PointerEvent<HTMLDivElement>) {
    const gesture = drag.current;
    if (gesture?.id !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
    setDragging(false);
    if (event.type !== 'pointerup' || gesture.moved) return;
    // Browser hit testing can target a parent plane when a 3D sleeve tilts behind it.
    // Resolve a deliberate tap on the visible cover, excluding the crate's front lip.
    const cover = activeSleeveRef.current?.getBoundingClientRect();
    const front = crateFrontRef.current?.getBoundingClientRect();
    if (!cover) return;
    const inside = (x: number, y: number) =>
      x >= cover.left &&
      x <= cover.right &&
      y >= cover.top &&
      y <= Math.min(cover.bottom, front?.top ?? cover.bottom);
    if (inside(gesture.x, gesture.y) && inside(event.clientX, event.clientY)) {
      openRecord();
      // The compatibility click must not trigger a second navigation (reduced motion).
      suppressClick.current = true;
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // The active sleeve button retains its native Enter/Space behaviour.
    if (event.target !== event.currentTarget) return;
    const key = event.key;
    if (
      !['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(
        key,
      )
    )
      return;
    event.preventDefault();
    suppressClick.current = false;
    if (key === 'Enter' || key === ' ') openRecord();
    else if (key === 'Home') goTo(groupStart);
    else if (key === 'End') goTo(groupStart + group.items.length - 1);
    else goTo(positionRef.current + (key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1));
  }

  return (
    <>
      <div className={styles.binbar}>
        <label className={styles.field}>
          <span>{t('crate.choose')}</span>
          <select
            value={group.id}
            disabled={opening}
            onChange={(event) =>
              goTo(flattened.findIndex((item) => item.group.id === event.target.value))
            }
          >
            {groups.map((bin) => (
              <option key={bin.id} value={bin.id}>
                {bin.label} · {bin.items.length}
              </option>
            ))}
          </select>
        </label>
        <span className={styles.binNumber} aria-hidden="true">
          {String(groups.indexOf(group) + 1).padStart(2, '0')}
          <span> / {String(groups.length).padStart(2, '0')}</span>
        </span>
      </div>

      <div className={styles.experience}>
        <div className={styles.sceneColumn}>
          <div
            ref={sceneRef}
            role="region"
            aria-label={t('crate.scene')}
            aria-describedby="crate-gesture crate-keyboard"
            tabIndex={0}
            data-opening={opening}
            data-dragging={dragging}
            className={styles.scene}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerEnd}
            onPointerCancel={pointerEnd}
            onLostPointerCapture={(event) => {
              // A touch initially belongs to the sleeve. Its implicit capture is
              // released when the scene takes over; that is not the end of the drag.
              if (event.target !== event.currentTarget) return;
              drag.current = null;
              setDragging(false);
            }}
            onKeyDown={onKeyDown}
            onClickCapture={(event) => {
              if (suppressClick.current && event.detail !== 0) {
                event.preventDefault();
                event.stopPropagation();
              }
              suppressClick.current = false;
            }}
          >
            <div className={styles.ground} aria-hidden="true" />
            <div className={styles.world}>
              <div className={styles.back} aria-hidden="true" />
              <div className={styles.floor} aria-hidden="true" />
              <div className={styles.divider} aria-hidden="true">
                <span>{group.label}</span>
              </div>
              {group.items.slice(Math.max(0, index - 2), index + 8).map((sleeve, offset) => {
                const relative = Math.max(0, index - 2) + offset - index;
                const active = relative === 0;
                const past = relative < 0;
                const style = {
                  '--sleeve-y': `${past ? 32 + Math.abs(relative) * 12 : -relative * 10}px`,
                  '--sleeve-z': `${past ? 54 + Math.abs(relative) * 5 : -relative * 28}px`,
                  '--sleeve-tilt': `${past ? -64 : 8 + relative * 1.1}deg`,
                } as CSSProperties;
                const cover = (
                  <AlbumCover
                    src={coverProxyUrl(sleeve.coverUrl)}
                    title={sleeve.title}
                    artists={sleeve.artists}
                    eager={active}
                  />
                );
                return (
                  <button
                    key={sleeve.releaseId}
                    ref={active ? activeSleeveRef : undefined}
                    type="button"
                    aria-hidden={!active}
                    aria-label={active ? t('crate.open', { title: sleeve.title }) : undefined}
                    disabled={!active || opening}
                    tabIndex={active ? 0 : -1}
                    className={`${styles.sleeve} ${active ? styles.activeSleeve : ''} ${active && opening ? styles.lifting : ''}`}
                    style={style}
                    onClick={active ? openRecord : undefined}
                    onDragStart={(event) => event.preventDefault()}
                  >
                    {cover}
                  </button>
                );
              })}
              <div className={`${styles.side} ${styles.left}`} aria-hidden="true" />
              <div className={`${styles.side} ${styles.right}`} aria-hidden="true" />
              <div ref={crateFrontRef} className={styles.front} aria-hidden="true">
                <span className={styles.crateBrand}>
                  Dig<span>33 / 45</span>
                </span>
                <span className={styles.handle} />
                <span className={styles.crateLabel}>{group.label}</span>
              </div>
            </div>
          </div>
          <p id="crate-gesture" className={styles.gesture}>
            {t('crate.gesture')}
          </p>
          <p id="crate-keyboard" className="sr-only">
            {t('crate.keyboard')}
          </p>
        </div>

        <div className={styles.recordPanel}>
          <div aria-live="polite" aria-atomic="true">
            <p className="sr-only">{t('crate.current')}</p>
            <p className={styles.position}>
              {t('crate.position', { index: index + 1, total: group.items.length })}
            </p>
            <h2 className={styles.recordTitle}>{record.title}</h2>
            <p className={styles.artist}>{record.artists}</p>
            <p className={styles.metadata}>
              {[record.year, grouping === 'continent' ? null : record.country]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {grouping === 'continent' ? (
              <p className={styles.metadata}>
                {t('crate.artistOrigin', {
                  countries: record.originCountries?.length
                    ? record.originCountries.join(', ')
                    : t('crate.continent.unknown'),
                })}
                {record.originCountries?.length
                  ? record.originSourceUrls.map((url, index) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-2 inline-flex min-h-11 items-center underline"
                        aria-label={t('crate.originSource', {
                          index: index + 1,
                          source: url.startsWith('https://www.discogs.com/')
                            ? 'Discogs'
                            : 'Wikidata',
                        })}
                      >
                        {url.startsWith('https://www.discogs.com/') ? 'Discogs' : 'Wikidata'}
                        {record.originSourceUrls.length > 1 ? ` ${index + 1}` : ''}
                      </a>
                    ))
                  : null}
              </p>
            ) : null}
          </div>
          <div className={styles.controls}>
            <button
              type="button"
              aria-label={t('crate.previous')}
              disabled={opening || position === 0}
              onClick={() => goTo(position - 1)}
            >
              ←
            </button>
            <input
              type="range"
              aria-label={t('crate.browse')}
              min={1}
              max={group.items.length}
              value={index + 1}
              disabled={opening || group.items.length < 2}
              onChange={(event) => goTo(groupStart + Number(event.target.value) - 1)}
            />
            <button
              type="button"
              aria-label={t('crate.next')}
              disabled={opening || position === flattened.length - 1}
              onClick={() => goTo(position + 1)}
            >
              →
            </button>
          </div>
          <Link
            href={href}
            prefetch={false}
            className={styles.details}
            onClick={(event) => {
              if (
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey ||
                event.button !== 0
              )
                return;
              event.preventDefault();
              suppressClick.current = false;
              openRecord();
            }}
          >
            {t('crate.details')}
            <span aria-hidden="true">↗</span>
          </Link>
          {opening ? (
            <p role="status" className={styles.opening}>
              {t('crate.opening')}
            </p>
          ) : null}
        </div>
      </div>
    </>
  );
}
