'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

import { t, type MessageKey } from '@/lib/i18n';
import { SORT_OPTIONS, type SortOption } from '@/modules/collection/cursor';
import type { CollectionItem } from '@/modules/collection/service';

import { AlbumTile } from './album-tile';

type Facet = { value: string; count: number };

/**
 * Parcours de la collection (§7.3, §8.3).
 *
 * La première page est rendue par le serveur ; ce composant ne prend la main que pour la
 * recherche, les filtres et le chargement progressif — c'est-à-dire uniquement là où
 * l'interactivité l'exige.
 */
export function CollectionBrowser({
  initialItems,
  initialCursor,
  total,
  facets,
}: {
  initialItems: CollectionItem[];
  initialCursor: string | null;
  total: number;
  facets: { genres: Facet[]; styles: Facet[] };
}) {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [query, setQuery] = useState('');
  const [genres, setGenres] = useState<string[]>([]);
  const [styles, setStyles] = useState<string[]>([]);
  const [sort, setSort] = useState<SortOption>('date_added_desc');
  const [showFilters, setShowFilters] = useState(false);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();
  const [loadingMore, setLoadingMore] = useState(false);

  /** Annule la requête précédente : une frappe rapide ne doit pas produire de résultat périmé (§20.1). */
  const inFlight = useRef<AbortController | null>(null);
  const filtered = query !== '' || genres.length > 0 || styles.length > 0;

  const buildUrl = useCallback(
    (nextCursor?: string) => {
      const params = new URLSearchParams();
      if (query !== '') params.set('query', query);
      for (const genre of genres) params.append('genres', genre);
      for (const style of styles) params.append('styles', style);
      params.set('sort', sort);
      if (nextCursor) params.set('cursor', nextCursor);
      return `/api/collection?${params.toString()}`;
    },
    [query, genres, styles, sort],
  );

  // Recherche et filtres : rechargement complet de la liste, avec debounce.
  useEffect(() => {
    const timer = setTimeout(() => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;

      startTransition(async () => {
        try {
          const response = await fetch(buildUrl(), { signal: controller.signal });
          if (!response.ok) {
            setError(true);
            return;
          }
          const data = (await response.json()) as {
            items: CollectionItem[];
            nextCursor: string | null;
          };
          setItems(data.items);
          setCursor(data.nextCursor);
          setError(false);
        } catch (cause) {
          if ((cause as Error).name !== 'AbortError') {
            setError(true);
          }
        }
      });
    }, 250);

    return () => clearTimeout(timer);
  }, [buildUrl]);

  async function loadMore() {
    if (!cursor || loadingMore) {
      return;
    }

    setLoadingMore(true);
    try {
      const response = await fetch(buildUrl(cursor));
      if (!response.ok) {
        setError(true);
        return;
      }
      const data = (await response.json()) as {
        items: CollectionItem[];
        nextCursor: string | null;
      };
      setItems((current) => [...current, ...data.items]);
      setCursor(data.nextCursor);
    } catch {
      setError(true);
    } finally {
      setLoadingMore(false);
    }
  }

  function toggle(list: string[], setList: (next: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
          <label htmlFor="collection-search" className="text-xs text-muted">
            {t('collection.search.label')}
          </label>
          <input
            id="collection-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('collection.search.placeholder')}
            className="rounded-md border border-border bg-transparent px-3 py-2 text-sm"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="collection-sort" className="text-xs text-muted">
            {t('collection.sort.label')}
          </label>
          <select
            id="collection-sort"
            value={sort}
            onChange={(event) => setSort(event.target.value as SortOption)}
            className="rounded-md border border-border bg-transparent px-3 py-2 text-sm"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {t(`collection.sort.${option}` as MessageKey)}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => setShowFilters((value) => !value)}
          aria-expanded={showFilters}
          aria-controls="collection-filters"
          className="rounded-md border border-border px-3 py-2 text-sm"
        >
          {showFilters ? t('collection.filters.hide') : t('collection.filters.show')}
        </button>
      </div>

      <div id="collection-filters" hidden={!showFilters} className="flex flex-col gap-3">
        <FacetGroup
          legend={t('collection.filters.genres')}
          facets={facets.genres}
          selected={genres}
          onToggle={(value) => toggle(genres, setGenres, value)}
        />
        <FacetGroup
          legend={t('collection.filters.styles')}
          facets={facets.styles}
          selected={styles}
          onToggle={(value) => toggle(styles, setStyles, value)}
        />
        {filtered ? (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setGenres([]);
              setStyles([]);
            }}
            className="self-start text-sm underline"
          >
            {t('collection.filters.clear')}
          </button>
        ) : null}
      </div>

      <p aria-live="polite" className="text-sm text-muted">
        {pending
          ? t('collection.loading')
          : filtered
            ? t('collection.results.filtered', { count: items.length, total })
            : t('collection.results', { count: total })}
      </p>

      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {t('collection.error')}
        </p>
      ) : null}

      {items.length === 0 && !pending ? (
        <div className="flex flex-col gap-1 py-12 text-center">
          <p className="text-lg">{t('collection.noResults')}</p>
          <p className="text-sm text-muted">{t('collection.noResults.hint')}</p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {items.map((item, index) => (
            <AlbumTile key={item.releaseId} item={item} priority={index < 6} />
          ))}
        </ul>
      )}

      {cursor ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="mx-auto rounded-md border border-border px-4 py-2 text-sm disabled:opacity-60"
        >
          {loadingMore ? t('collection.loading') : t('collection.loadMore')}
        </button>
      ) : null}
    </div>
  );
}

function FacetGroup({
  legend,
  facets,
  selected,
  onToggle,
}: {
  legend: string;
  facets: Facet[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  if (facets.length === 0) {
    return null;
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-xs text-muted">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {facets.map((facet) => {
          const active = selected.includes(facet.value);

          return (
            <label
              key={facet.value}
              /* La case est masquée visuellement mais reste focalisable : sans
                 `focus-within`, la navigation clavier deviendrait invisible (§20.2). */
              className={`cursor-pointer rounded-full border px-3 py-1 text-sm focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-current ${
                active ? 'border-current font-medium' : 'border-border'
              }`}
            >
              <input
                type="checkbox"
                checked={active}
                onChange={() => onToggle(facet.value)}
                className="sr-only"
              />
              {/* La sélection n'est pas signalée que par la couleur (§20.2). */}
              <span aria-hidden="true">{active ? '✓ ' : ''}</span>
              {facet.value}
              <span className="text-muted"> ({facet.count})</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
