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
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const image = imageRef.current;

    // L'image est rendue par le serveur : si elle échoue avant l'hydratation, l'événement
    // `error` est perdu car aucun gestionnaire React n'est encore attaché. On rattrape ce
    // cas après hydratation — `complete` avec une largeur nulle signifie « échouée ».
    if (image?.complete && image.naturalWidth === 0) {
      setFailed(true);
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
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imageRef}
      src={src}
      alt={t('collection.cover.alt', { title, artists })}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(true)}
      className={className ?? 'h-full w-full object-cover'}
    />
  );
}
