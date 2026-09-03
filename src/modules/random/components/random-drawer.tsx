'use client';

import Link from 'next/link';
import { useState } from 'react';

import { t } from '@/lib/i18n';
import { AlbumCover } from '@/modules/collection/components/album-cover';
import { coverProxyUrl } from '@/modules/collection/cover';

type Facet = { value: string; count: number };

type DrawnRelease = {
  discogsReleaseId: string;
  title: string;
  artists: string;
  year: number | null;
  genres: string[];
  styles: string[];
  coverUrl: string | null;
};

type SessionState = {
  id: string;
  eligibleCount: number;
  drawnCount: number;
};

/**
 * Session de tirage (§8.4).
 *
 * RAND-006 : le tirage affiche l'album et **n'ouvre aucun lecteur**. C'est le mode Radio,
 * plus tard, qui lancera la lecture — parce qu'y entrer est une demande explicite
 * d'écoute (ADR-0006).
 */
export function RandomDrawer({
  facets,
  initialEligible,
}: {
  facets: { genres: Facet[]; styles: Facet[] };
  initialEligible: number;
}) {
  const [genres, setGenres] = useState<string[]>([]);
  const [styles, setStyles] = useState<string[]>([]);
  const [session, setSession] = useState<SessionState | null>(null);
  const [release, setRelease] = useState<DrawnRelease | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  function toggle(list: string[], setList: (next: string[]) => void, value: string) {
    // Changer un filtre invalide la session en cours : le périmètre du tirage a changé.
    setSession(null);
    setRelease(null);
    setExhausted(false);
    setList(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  }

  async function openSession(): Promise<SessionState | null> {
    const response = await fetch('/api/random-sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ genres, styles }),
    });

    if (!response.ok) {
      setError(true);
      return null;
    }

    const created = (await response.json()) as SessionState;
    setSession(created);
    return created;
  }

  async function drawNext(restart = false) {
    setBusy(true);
    setError(false);

    try {
      const current = restart || !session ? await openSession() : session;
      if (!current) {
        return;
      }

      const response = await fetch(`/api/random-sessions/${current.id}/draws`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });

      if (!response.ok) {
        setError(true);
        return;
      }

      const data = (await response.json()) as
        { status: 'exhausted' } | { status: 'drawn'; drawOrder: number; release: DrawnRelease };

      if (data.status === 'exhausted') {
        setExhausted(true);
        setRelease(null);
        return;
      }

      setExhausted(false);
      setRelease(data.release);
      setSession({ ...current, drawnCount: data.drawOrder });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  const filtered = genres.length > 0 || styles.length > 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Au-dessus des filtres (demande produit 2026-09-03) : tirer est l'action
          principale de cet écran, les filtres n'en sont qu'un réglage. */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => drawNext()}
          disabled={busy}
          className="rounded-md bg-foreground px-5 py-3 font-medium text-background disabled:opacity-50"
        >
          {busy ? t('collection.loading') : release ? t('random.drawAgain') : t('random.draw')}
        </button>

        {exhausted ? (
          <button
            type="button"
            onClick={() => drawNext(true)}
            disabled={busy}
            className="rounded-md border border-border px-4 py-2 text-sm"
          >
            {t('random.restart')}
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {t('random.error')}
        </p>
      ) : null}

      {/* Sous le bouton, avant les filtres (demande produit 2026-09-03) : le résultat
          d'un tirage est ce qu'on est venu voir, pas un réglage à faire défiler pour
          l'atteindre. */}
      <div aria-live="polite" className="flex flex-col gap-3">
        {exhausted ? (
          <div className="flex flex-col gap-1 rounded-md border border-border p-4">
            <p className="text-lg">
              {session?.eligibleCount === 0 ? t('random.empty') : t('random.exhausted.title')}
            </p>
            {session?.eligibleCount === 0 ? null : (
              <p className="text-sm text-muted">{t('random.exhausted.hint')}</p>
            )}
          </div>
        ) : null}

        {release ? (
          <article className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="relative aspect-square w-full max-w-56 shrink-0 overflow-hidden rounded-lg bg-surface">
              <AlbumCover
                src={coverProxyUrl(release.coverUrl)}
                title={release.title}
                artists={release.artists}
                eager
              />
            </div>

            <div className="flex flex-col gap-2">
              <h2 className="text-xl font-semibold">{release.title}</h2>
              <p className="text-muted">{release.artists}</p>
              {release.year !== null ? <p className="text-sm text-muted">{release.year}</p> : null}
              {release.genres.length > 0 ? (
                <p className="text-sm text-muted">{release.genres.join(', ')}</p>
              ) : null}

              <Link
                href={`/sorties/${release.discogsReleaseId}`}
                className="mt-2 self-start rounded-md border border-border px-4 py-2 text-sm"
              >
                {t('random.open')}
              </Link>
            </div>
          </article>
        ) : null}
      </div>

      <p className="text-sm text-muted">{t('random.noAutoplay')}</p>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">{t('random.filters.title')}</h2>
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
        <p className="text-sm text-muted">
          {filtered ? null : `${t('random.filters.none')} — `}
          {session
            ? t('random.progress', { drawn: session.drawnCount, total: session.eligibleCount })
            : t('random.eligible', { count: initialEligible })}
        </p>
      </section>
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
