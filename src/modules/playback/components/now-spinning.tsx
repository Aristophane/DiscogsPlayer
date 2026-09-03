'use client';

import { useEffect, useRef, useState } from 'react';

import { t } from '@/lib/i18n';
import { AlbumCover } from '@/modules/collection/components/album-cover';
import { coverProxyUrl } from '@/modules/collection/cover';

import { usePlayback } from '../playback-context';

/**
 * « Now Spinning » (demande produit 2026-09-03) : pendant la lecture, un disque qui
 * tourne avec la pochette en fond de toute l'application — pas seulement dans la barre
 * du lecteur, visible même replié. Un mode plein écran, pensé pour une TV, isole le
 * disque de tout le reste de l'interface (§7, esprit d'un tourne-disque).
 *
 * Recto uniquement (décision produit) : le verso Discogs n'est aujourd'hui ni récupéré
 * ni stocké (seule `primaryImageUrl` existe) — ajouter le clic « retourner la pochette »
 * suppose une vraie source de données, pas encore demandée.
 *
 * Wash d'ambiance très discret (8 % d'opacité, flou) plutôt qu'un fond plein écran :
 * un aplat net derrière la grille collection ou une longue liste de pistes aurait cassé
 * le contraste texte vérifié par axe (§20.2) sur ces écrans. Le disque lui-même, net et
 * opaque, reste cantonné à un coin — c'est le mode plein écran qui porte le vrai
 * spectacle visuel, pas ce fond permanent.
 */
export function NowSpinningBackground() {
  const { state, skip } = usePlayback();
  const [fullscreen, setFullscreen] = useState(false);
  const fullscreenRef = useRef<HTMLDivElement>(null);

  const visible = state.status !== 'idle' && state.status !== 'radio_ended';
  const track = state.status === 'idle' || state.status === 'radio_ended' ? null : state.track;
  const spinning = state.status === 'playing_youtube' || state.status === 'playing_spotify';
  const cover = track ? coverProxyUrl(track.coverUrl) : null;
  const title = track?.title ?? track?.releaseTitle ?? '';
  const artists = track?.artists ?? '';

  // Le mode plein écran suit le statut réel du navigateur (touche Échap, contrôle natif
  // du système) — jamais seulement notre propre bouton de fermeture, sous peine d'un
  // état « plein écran » affiché alors que le navigateur en est déjà sorti.
  useEffect(() => {
    function onChange() {
      if (!document.fullscreenElement) {
        setFullscreen(false);
      }
    }
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // La lecture en cours s'arrête : le plein écran n'a plus de sens à montrer, on en sort
  // proprement plutôt que de laisser un disque figé occuper tout l'écran.
  useEffect(() => {
    if (!visible && document.fullscreenElement) {
      void document.exitFullscreen();
    }
  }, [visible]);

  async function openFullscreen() {
    setFullscreen(true);
    try {
      await fullscreenRef.current?.requestFullscreen();
    } catch {
      // API indisponible ou refusée (contexte non sécurisé, restriction navigateur) :
      // le calque plein écran ci-dessous reste un repli raisonnable, `position: fixed`
      // suffit à occuper tout le viewport même sans la vraie API.
    }
  }

  async function closeFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    }
    setFullscreen(false);
  }

  if (!visible) {
    return null;
  }

  return (
    <>
      {/* Wash d'ambiance : purement décoratif, jamais un obstacle au clic ni à la
          lecture d'écran (§20.2). */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- même repli hors `next/image` que AlbumCover (SPEC-GAPS G-03).
          <img
            src={cover}
            alt=""
            aria-hidden="true"
            className="h-full w-full scale-110 object-cover opacity-[0.08] blur-3xl"
          />
        ) : null}
      </div>

      {/* Le disque d'ambiance, coin haut-droit sous l'en-tête — jamais bas-droit : la
          barre du lecteur y occupe déjà toute la largeur en bas d'écran, replié ou non
          (§SPEC-GAPS G-17). Une taille modeste plutôt qu'un masquage sous `sm:` : le
          plein écran doit rester atteignable depuis un téléphone aussi, pas seulement
          au-delà d'un certain gabarit. */}
      <div className="pointer-events-none fixed top-20 right-3 z-10 sm:top-24 sm:right-4">
        <button
          type="button"
          onClick={openFullscreen}
          aria-label={t('nowSpinning.open')}
          className="pointer-events-auto block rounded-full shadow-lg transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-current"
        >
          <Disc cover={cover} title={title} artists={artists} spinning={spinning} size={72} />
        </button>
      </div>

      {fullscreen ? (
        <div
          ref={fullscreenRef}
          role="region"
          aria-label={t('nowSpinning.region')}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-black p-6 text-white"
        >
          <Disc
            cover={cover}
            title={title}
            artists={artists}
            spinning={spinning}
            size={480}
            large
          />

          <div className="flex flex-col items-center gap-1 text-center">
            {title ? <p className="text-xl font-medium">{title}</p> : null}
            {artists ? <p className="text-white/70">{artists}</p> : null}
          </div>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={skip}
              aria-label={t('player.skip')}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-white/30 text-lg"
            >
              <span aria-hidden="true">⏭</span>
            </button>
            <button
              type="button"
              onClick={closeFullscreen}
              aria-label={t('nowSpinning.exit')}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-white/30 text-lg"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Disc({
  cover,
  title,
  artists,
  spinning,
  size,
  large,
}: {
  cover: string | null;
  title: string;
  artists: string;
  spinning: boolean;
  size: number;
  large?: boolean;
}) {
  return (
    <div
      className="now-spinning-disc relative shrink-0 overflow-hidden rounded-full bg-black"
      style={{
        width: size,
        height: size,
        // Grooves du vinyle : anneaux concentriques en dégradé radial, purement en CSS —
        // pas une image, pour rester net à toute taille (72 px ici, 480 px en plein écran).
        backgroundImage:
          'repeating-radial-gradient(circle, #2a2a2a 0, #2a2a2a 1px, #0a0a0a 2px, #0a0a0a 5px)',
        animationPlayState: spinning ? 'running' : 'paused',
      }}
    >
      <div
        className="absolute overflow-hidden rounded-full"
        style={{ inset: large ? '18%' : '15%' }}
      >
        <AlbumCover src={cover} title={title} artists={artists} />
      </div>
      {/* Trou de l'axe : un simple point sombre au centre, cohérent à toute taille. */}
      <div
        aria-hidden="true"
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black"
        style={{ width: large ? 16 : 6, height: large ? 16 : 6 }}
      />
    </div>
  );
}
