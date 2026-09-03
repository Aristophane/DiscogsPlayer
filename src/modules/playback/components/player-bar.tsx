'use client';

import { useEffect, useRef, useState } from 'react';

import { t } from '@/lib/i18n';
import { VinylSpinner } from '@/lib/ui/vinyl-spinner';
import { AlbumCover } from '@/modules/collection/components/album-cover';
import { coverProxyUrl } from '@/modules/collection/cover';

import { usePlayback } from '../playback-context';

/**
 * Lecteur persistant (SPEC-GAPS G-17) : monté une fois dans le layout racine, jamais
 * démonté par une navigation. C'est la barre basse qui reste visible en parcourant la
 * collection — l'« onglet fantôme » utile évoqué en discussion produit, en conforme et
 * visible (docs/LECTURE-FOURNISSEURS.md §3).
 *
 * Une seule arborescence, toujours rendue : contrairement à une première version, ce
 * composant ne fait plus de `return` distinct par état. En particulier, le conteneur
 * ciblé par l'API YouTube (`setYoutubeContainer`) est de position stable — seule sa
 * classe change — car changer sa présence structurelle dans le JSX provoquait un
 * `NotFoundError` réel en enchaînant deux pistes (l'API YouTube remplace ce nœud par un
 * `<iframe>` en dehors de React ; le faire apparaître/disparaître du JSX fait perdre à
 * React la référence DOM qu'il croit encore posséder — voir `playback-context.tsx`).
 */
export function PlayerBar() {
  const { state, close, pasteUrl, setYoutubeContainer } = usePlayback();
  const [pasteValue, setPasteValue] = useState('');
  const [pasteError, setPasteError] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  const visible = state.status !== 'idle';
  const track = state.status === 'idle' || state.status === 'radio_ended' ? null : state.track;
  const cover = track ? coverProxyUrl(track.coverUrl) : null;

  // Publie la hauteur réelle de la barre pour que le layout racine réserve exactement
  // cet espace (voir le commentaire dans `layout.tsx`) : un contenu variable (vidéo,
  // formulaire de repli) rend toute valeur figée fausse dans un sens ou dans l'autre.
  useEffect(() => {
    const element = barRef.current;
    if (!element) {
      return;
    }

    const updateHeight = () => {
      const height = visible ? element.getBoundingClientRect().height : 0;
      document.documentElement.style.setProperty('--player-bar-height', `${height}px`);
    };

    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible, state.status]);

  async function submitPaste(event: React.FormEvent) {
    event.preventDefault();
    setPasteError(false);
    const ok = await pasteUrl(pasteValue);
    if (ok) {
      setPasteValue('');
    } else {
      setPasteError(true);
    }
  }

  return (
    <div
      ref={barRef}
      role="region"
      aria-label={t('nav.playing')}
      className={
        visible ? 'fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background' : 'hidden'
      }
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-3 sm:px-6">
        {track ? (
          <div className="flex items-center gap-3">
            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded bg-surface">
              <AlbumCover src={cover} title={track.releaseTitle} artists={track.artists} eager />
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{track.title ?? track.releaseTitle}</p>
              <p className="truncate text-xs text-muted">{track.artists}</p>
            </div>

            <button
              type="button"
              onClick={close}
              aria-label={t('player.close')}
              className="rounded-md border border-border px-3 py-1.5 text-sm"
            >
              ✕
            </button>
          </div>
        ) : null}

        {state.status === 'loading' ? (
          <p aria-live="polite" className="flex items-center gap-2 text-sm text-muted">
            {state.reason === 'tracklist_pending' ? <VinylSpinner size={20} /> : null}
            {state.reason === 'tracklist_pending'
              ? t('player.loading.tracklistPending')
              : t('player.loading')}
          </p>
        ) : null}

        {state.status === 'error' ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {t('player.error')}
          </p>
        ) : null}

        {/*
          Position stable, toujours rendue : seule la classe change selon l'état. Le
          contenu réel (l'iframe) est créé de façon impérative par `playback-context.tsx`,
          jamais par React — voir le commentaire d'en-tête.
        */}
        <div
          ref={setYoutubeContainer}
          className={state.status === 'playing_youtube' ? 'aspect-video w-full max-w-sm' : 'hidden'}
        />

        {state.status === 'playing_spotify' ? (
          <div className="flex flex-col gap-2">
            <iframe
              title={`${state.track.releaseTitle} — Spotify`}
              // `autoplay=1` : best-effort seulement, comme documenté (§14.7, PLAY-005) —
              // Spotify ne garantit pas l'autoplay programmatique selon navigateur et
              // connexion. Le bouton « Ouvrir dans Spotify » reste le filet de sécurité.
              src={`https://open.spotify.com/embed/${state.entityType}/${state.spotifyId}?autoplay=1`}
              width="100%"
              height="152"
              allow="autoplay; encrypted-media; fullscreen; clipboard-write"
              loading="lazy"
              className="rounded-md"
            />
            <p className="text-xs text-muted">{t('player.spotify.limits')}</p>
            <a
              href={`https://open.spotify.com/${state.entityType}/${state.spotifyId}`}
              target="_blank"
              rel="noreferrer noopener"
              className="self-start text-xs underline"
            >
              {t('player.openSpotify')}
            </a>
          </div>
        ) : null}

        {state.status === 'radio_ended' ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm">
              {state.reason === 'exhausted'
                ? t('player.radio.exhausted')
                : t('player.radio.unavailable')}
            </p>
            <div className="flex shrink-0 gap-3">
              <a href="/radio" className="text-sm underline">
                {t('player.radio.restart')}
              </a>
              <button
                type="button"
                onClick={close}
                aria-label={t('player.close')}
                className="rounded-md border border-border px-3 py-1.5 text-sm"
              >
                ✕
              </button>
            </div>
          </div>
        ) : null}

        {state.status === 'unresolved' ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">{t('player.unresolved.title')}</p>
            {state.unresolved.quotaExhausted ? (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                {t('player.quotaExhausted')}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-3 text-sm">
              <a
                href={state.unresolved.youtubeSearchUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-md border border-border px-3 py-1.5"
              >
                {t('player.openYoutubeSearch')}
              </a>
              {state.unresolved.spotifySearchUrl ? (
                <a
                  href={state.unresolved.spotifySearchUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="rounded-md border border-border px-3 py-1.5"
                >
                  {t('player.openSpotifySearch')}
                </a>
              ) : null}
            </div>

            <form onSubmit={submitPaste} className="flex flex-col gap-1">
              <label htmlFor="player-paste-url" className="text-xs text-muted">
                {t('player.pasteUrl.label')}
              </label>
              <p className="text-xs text-muted">{t('player.unresolved.hint')}</p>
              <div className="flex gap-2">
                <input
                  id="player-paste-url"
                  type="url"
                  value={pasteValue}
                  onChange={(event) => setPasteValue(event.target.value)}
                  placeholder={t('player.pasteUrl.placeholder')}
                  className="min-w-0 flex-1 rounded-md border border-border bg-transparent px-3 py-1.5 text-sm"
                />
                <button
                  type="submit"
                  className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background"
                >
                  {t('player.pasteUrl.submit')}
                </button>
              </div>
              {pasteError ? (
                <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                  {t('player.pasteUrl.error')}
                </p>
              ) : null}
            </form>
          </div>
        ) : null}
      </div>
    </div>
  );
}
