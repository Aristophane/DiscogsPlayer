'use client';

import { t } from '@/lib/i18n';

import { usePlayback } from '../playback-context';

/**
 * Bouton play (§4.2 : résolution seulement au moment du choix explicite de lecture).
 *
 * `album` résout la première piste jouable ; `track` la piste précise. Aucune vidéo,
 * aucun quota, aucune recherche n'est consommé avant ce clic.
 */
export function PlayButton({
  kind,
  id,
  size = 'md',
  className,
}: {
  kind: 'album' | 'track';
  id: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const { playTrack, playAlbum } = usePlayback();

  function handleClick(event: React.MouseEvent) {
    // Le bouton vit à l'intérieur d'une tuile cliquable (lien vers la fiche) : la
    // lecture ne doit pas déclencher aussi la navigation.
    event.preventDefault();
    event.stopPropagation();

    if (kind === 'album') {
      void playAlbum(id);
    } else {
      void playTrack(id);
    }
  }

  const dimension = size === 'sm' ? 'h-8 w-8 text-sm' : 'h-11 w-11 text-lg';

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={kind === 'album' ? t('play.album') : t('play.track')}
      className={`flex shrink-0 items-center justify-center rounded-full bg-foreground text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current ${dimension} ${className ?? ''}`}
    >
      <span aria-hidden="true">▶</span>
    </button>
  );
}
