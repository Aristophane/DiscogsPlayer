'use client';

import { useId, useState } from 'react';

import { t } from '@/lib/i18n';
import { usePlayback } from '@/modules/playback/playback-context';

type Facet = { value: string; count: number };

/**
 * Écran de lancement de la Radio (ADR-0006 point 2) : entrer en Radio *est* la demande de
 * lecture — contrairement au mode Aléatoire, aucune étape intermédiaire n'est nécessaire,
 * le bouton lance directement le lecteur.
 */
type RadioFacets = { genres: Facet[]; styles: Facet[] };

export function RadioLauncher({
  facets,
  friendsFacets,
}: {
  facets: RadioFacets;
  friendsFacets: RadioFacets;
}) {
  const { playFromRadio, state } = usePlayback();
  const sourceId = useId();
  const [genres, setGenres] = useState<string[]>([]);
  const [styles, setStyles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [includeFriends, setIncludeFriends] = useState(false);
  const selectedFacets = includeFriends ? friendsFacets : facets;

  function toggle(list: string[], setList: (next: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  }

  async function start() {
    setBusy(true);
    setError(false);

    try {
      const response = await fetch('/api/radio-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ genres, styles, includeFriends }),
        signal: AbortSignal.timeout(20_000),
      });

      if (!response.ok) {
        setError(true);
        return;
      }

      const session = (await response.json()) as { id: string };
      await playFromRadio(session.id);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  const isPlaying = state.status !== 'idle' && state.status !== 'radio_ended';

  return (
    <div className="flex flex-col gap-6">
      <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-3 text-lg font-medium">{t('radio.source.title')}</legend>
        {[false, true].map((friends) => (
          <label
            key={String(friends)}
            className={`flex cursor-pointer items-start gap-3 rounded-md border p-4 focus-within:outline-2 focus-within:outline-offset-2 ${includeFriends === friends ? 'border-current bg-surface' : 'border-border'}`}
          >
            <input
              type="radio"
              name="radio-source"
              aria-labelledby={`${sourceId}-${friends}-title`}
              aria-describedby={`${sourceId}-${friends}-hint`}
              checked={includeFriends === friends}
              onChange={() => {
                setIncludeFriends(friends);
                setGenres([]);
                setStyles([]);
              }}
              className="mt-1 accent-current"
            />
            <span>
              <span id={`${sourceId}-${friends}-title`} className="block font-medium">
                {t(friends ? 'radio.source.friends' : 'radio.source.mine')}
              </span>
              <span id={`${sourceId}-${friends}-hint`} className="mt-1 block text-sm text-muted">
                {t(friends ? 'radio.source.friends.hint' : 'radio.source.mine.hint')}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {/* Au-dessus des filtres (demande produit 2026-09-03) : lancer la radio est
          l'action principale de cet écran, les filtres n'en sont qu'un réglage. */}
      <button
        type="button"
        onClick={start}
        disabled={busy}
        className="self-start rounded-md bg-foreground px-5 py-3 font-medium text-background disabled:opacity-50"
      >
        {busy ? t('radio.starting') : t('radio.start')}
      </button>

      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {t('radio.error')}
        </p>
      ) : null}

      {isPlaying ? <p className="text-sm text-muted">{t('radio.playing')}</p> : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">{t('radio.filters.title')}</h2>
        <FacetGroup
          legend={t('collection.filters.genres')}
          facets={selectedFacets.genres}
          selected={genres}
          onToggle={(value) => toggle(genres, setGenres, value)}
        />
        <FacetGroup
          legend={t('collection.filters.styles')}
          facets={selectedFacets.styles}
          selected={styles}
          onToggle={(value) => toggle(styles, setStyles, value)}
        />
      </section>
    </div>
  );
}

/**
 * Nombre de valeurs affichées par défaut. Une vraie collection peut compter des
 * centaines de styles à un seul exemplaire (constaté en test réel) : les lister tous
 * rendrait l'écran interminable sur mobile, bien avant le bouton de lancement. Une
 * valeur déjà sélectionnée reste visible même hors de ce plafond, pour ne jamais faire
 * disparaître un choix de l'utilisateur.
 */
const MAX_VISIBLE_FACETS = 24;

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

  const visible = facets.filter(
    (facet, index) => index < MAX_VISIBLE_FACETS || selected.includes(facet.value),
  );
  const hiddenCount = facets.length - visible.length;

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-xs text-muted">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {visible.map((facet) => {
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
      {hiddenCount > 0 ? (
        <p className="text-xs text-muted">{t('radio.filters.more', { count: hiddenCount })}</p>
      ) : null}
    </fieldset>
  );
}
