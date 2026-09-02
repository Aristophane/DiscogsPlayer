/**
 * Chargement paresseux de l'IFrame Player API (§13.6, §20.1).
 *
 * Le script n'est inséré qu'à la première lecture réelle, jamais au chargement d'une
 * page : « pas de chargement des scripts YouTube ou Spotify avant l'affichage d'un
 * lecteur » (§20.1). Mémorisé pour qu'un second appel ne réinsère pas le script.
 */

declare global {
  interface Window {
    YT?: {
      Player: new (
        elementId: string,
        options: {
          videoId?: string;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: (event: { target: YtPlayer }) => void;
            onStateChange?: (event: { data: number; target: YtPlayer }) => void;
            onError?: (event: { data: number }) => void;
          };
        },
      ) => YtPlayer;
      PlayerState: { ENDED: number; PLAYING: number; PAUSED: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

export type YtPlayer = {
  loadVideoById: (videoId: string) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  destroy: () => void;
};

let apiPromise: Promise<void> | null = null;

export function loadYoutubeIframeApi(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('IFrame API indisponible côté serveur'));
  }

  if (window.YT?.Player) {
    return Promise.resolve();
  }

  apiPromise ??= new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };

    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(script);
  });

  return apiPromise;
}
