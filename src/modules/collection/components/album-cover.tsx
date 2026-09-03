'use client';

import { useEffect, useRef, useState } from 'react';

import { t } from '@/lib/i18n';

/**
 * Pochette avec repli (§22.5).
 *
 * Une URL absente n'est pas le seul cas de pochette manquante : Discogs supprime des
 * images, et le proxy renvoie alors un 404. Sans gestion de l'échec de chargement, le
 * navigateur affiche une icône cassée et le texte alternatif brut — ce qui est exactement
 * ce que la vérification visuelle du lot doit interdire.
 */
export function AlbumCover({
  src,
  title,
  artists,
  eager,
  className,
}: {
  src: string | null;
  title: string;
  artists: string;
  eager?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const image = imageRef.current;

    // L'image est rendue par le serveur : si elle a fini de charger (ou a échoué) avant
    // l'hydratation, les événements `load`/`error` sont perdus — aucun gestionnaire React
    // n'est encore attaché. On rattrape les deux cas après hydratation : `complete` avec
    // une largeur nulle signifie « échouée », non nulle signifie « déjà chargée » (image
    // en cache, cas fréquent pour une pochette déjà vue).
    if (image?.complete) {
      if (image.naturalWidth === 0) {
        setFailed(true);
      } else {
        setLoaded(true);
      }
    }
  }, []);

  if (!src || failed) {
    return (
      <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-muted">
        {t('collection.cover.missing')}
      </div>
    );
  }

  /* Le proxy sert des images déjà dimensionnées par Discogs, dont l'optimiseur de
     `next/image` ne peut pas atteindre l'origine, protégée contre le hotlinking
     (SPEC-GAPS G-03). */
  return (
    <>
      {/* Réservé au chargement : le conteneur parent est déjà `relative` (grille, fiche
          album, lecteur), cet écran d'attente peut donc se superposer sans rien casser.
          Disparaît dès le premier chargement — pas de scintillement sur les vues
          suivantes, où l'image arrive déjà en cache. */}
      {loaded ? null : (
        <div
          aria-hidden="true"
          className="absolute inset-0 animate-pulse bg-border motion-reduce:animate-none"
        />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imageRef}
        src={src}
        alt={t('collection.cover.alt', { title, artists })}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={`${className ?? 'h-full w-full object-cover'} transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      />
    </>
  );
}
