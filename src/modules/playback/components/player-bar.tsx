'use client';

import { useState } from 'react';

import { t } from '@/lib/i18n';
import { AlbumCover } from '@/modules/collection/components/album-cover';
import { coverProxyUrl } from '@/modules/collection/cover';

import { usePlayback } from '../playback-context';

/**
 * Lecteur persistant (SPEC-GAPS G-17) : monté une fois dans le layout racine, jamais
 * démonté par une navigation. C'est la barre basse qui reste visible en parcourant la
 * collection — l'« onglet fantôme » utile évoqué en discussion produit, en conforme et
 * visible (docs/LECTURE-FOURNISSEURS.md §3).
 *
 * L'élément cible YouTube reste monté même à l'état "idle" : l'API IFrame le remplace en
 * place par un vrai iframe et le perdre forcerait à recréer un lecteur à chaque piste.
 */
export function PlayerBar() {
  const { state, close, pasteUrl, youtubeMountId } = usePlayback();
  const [pasteValue, setPasteValue] = useState('');
  const [pasteError, setPasteError] = useState(false);

  if (state.status === 'idle') {
    // Le cadre YouTube doit exister dans le DOM avant la première lecture, sinon l'API
    // IFrame n'a rien où se monter.
    return (
      <div className="hidden">
        <div id={youtubeMountId} />
      </div>
    );
  }

  const track = state.track;
  const cover = coverProxyUrl(track.coverUrl);

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
      role="region"
      aria-label={t('nav.playing')}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-surface">
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

        {state.status === 'loading' ? (
          <p aria-live="polite" className="text-sm text-muted">
            {t('player.loading')}
          </p>
        ) : null}

        {state.status === 'error' ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {t('player.error')}
          </p>
        ) : null}

        {state.status === 'playing_youtube' ? (
          // La cible reste dans le DOM en permanence ; visible seulement une fois qu'un
          // lecteur y est monté (évite un cadre vide pendant le chargement).
          <div id={youtubeMountId} className="aspect-video w-full max-w-sm" />
        ) : (
          <div id={youtubeMountId} className="hidden" />
        )}

        {state.status === 'playing_spotify' ? (
          <div className="flex flex-col gap-2">
            <iframe
              title={`${track.releaseTitle} — Spotify`}
              src={`https://open.spotify.com/embed/${state.entityType}/${state.spotifyId}`}
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
