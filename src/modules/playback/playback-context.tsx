'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { loadYoutubeIframeApi, type YtPlayer } from '@/modules/providers/youtube/iframe-loader';

export type TrackMeta = {
  id: string;
  ordinal: number;
  releaseId: string;
  discogsReleaseId: string;
  releaseTitle: string;
  artists: string;
  coverUrl: string | null;
  title?: string;
};

type Unresolved = {
  youtubeSearchUrl: string;
  spotifySearchUrl: string | null;
  quotaExhausted: boolean;
};

export type PlaybackState =
  | { status: 'idle' }
  | {
      status: 'loading';
      track: TrackMeta;
      /**
       * `tracklist_pending` : l'édition n'a pas encore ses pistes (import en arrière-plan
       * pas terminé), une récupération prioritaire est en cours (Lot 6bis). Distingue ce
       * qui peut prendre plusieurs secondes d'une résolution normale, pour que le lecteur
       * affiche un message et une animation adaptés plutôt qu'un chargement générique.
       */
      reason?: 'tracklist_pending';
    }
  | { status: 'playing_youtube'; track: TrackMeta; videoId: string }
  | {
      status: 'playing_spotify';
      track: TrackMeta;
      entityType: 'track' | 'album';
      spotifyId: string;
    }
  | { status: 'unresolved'; track: TrackMeta; unresolved: Unresolved }
  | { status: 'error'; track: TrackMeta }
  // Radio (ADR-0006) : plus rien à tirer. `exhausted` = tout a été écouté ;
  // `unavailable` = il reste des pistes, mais aucune n'a pu être résolue (quota
  // probable) — deux causes distinctes, deux messages différents pour l'utilisateur.
  | { status: 'radio_ended'; reason: 'exhausted' | 'unavailable' };

type PlaybackContextValue = {
  state: PlaybackState;
  playTrack: (trackId: string) => Promise<void>;
  playAlbum: (discogsReleaseId: string) => Promise<void>;
  /** Démarre ou reprend une session Radio : chaque fin de piste enchaîne un tirage. */
  playFromRadio: (radioSessionId: string) => Promise<void>;
  pasteUrl: (url: string) => Promise<boolean>;
  close: () => void;
  /**
   * Ref callback à poser sur le conteneur stable du lecteur (`PlayerBar`). Le nœud que
   * l'API YouTube mute réellement est créé à l'intérieur, de façon impérative — jamais
   * par JSX (voir `iframe-loader.ts`).
   */
  setYoutubeContainer: (element: HTMLDivElement | null) => void;
};

const PlaybackContext = createContext<PlaybackContextValue | null>(null);

type ResolutionResponse = {
  track?: TrackMeta;
  playback?:
    | { status: 'resolved'; provider: 'youtube'; videoId: string; title: string | null }
    | { status: 'resolved'; provider: 'spotify'; embedType: 'track' | 'album'; spotifyId: string }
    | ({ status: 'unresolved' } & Unresolved);
  status?: 'empty' | 'pending' | 'next' | 'end_of_album' | 'track' | 'exhausted' | 'unavailable';
};

async function postJson(url: string, body: unknown): Promise<ResolutionResponse | null> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as ResolutionResponse;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cadence et patience du sondage pendant qu'une édition récupère ses pistes en priorité
 * (`status: 'pending'`, Lot 6bis). ~15 s au total : au-delà, mieux vaut laisser
 * l'utilisateur réessayer que le faire attendre indéfiniment devant une animation.
 */
const TRACKLIST_PENDING_POLL_INTERVAL_MS = 1_500;
const TRACKLIST_PENDING_POLL_MAX_ATTEMPTS = 10;

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PlaybackState>({ status: 'idle' });
  const playerRef = useRef<YtPlayer | null>(null);
  // Conteneur React-managé, stable dans le temps ; son contenu, lui, est créé et détruit
  // à la main pour ne jamais entrer en conflit avec les mutations DOM de l'API YouTube.
  const youtubeContainerRef = useRef<HTMLDivElement | null>(null);

  const setYoutubeContainer = useCallback((element: HTMLDivElement | null) => {
    youtubeContainerRef.current = element;
  }, []);

  // `state` en miroir, lu de façon synchrone par les callbacks (ex. la fin d'une vidéo)
  // sans passer par le hack `setState(current => …)` uniquement pour lire une valeur —
  // ce détournement est justement ce que la règle react-hooks/immutability signale.
  const stateRef = useRef<PlaybackState>(state);
  // Évite qu'un événement "fin de piste" tardif d'un lecteur qu'on vient de quitter ne
  // déclenche l'enchaînement d'une piste qui n'est déjà plus celle en cours.
  const currentTrackIdRef = useRef<string | null>(null);
  // Non nul pendant une Radio : l'enchaînement (`advanceQueue`) tire alors une nouvelle
  // piste de cette session plutôt que la piste suivante du même album. Toute lecture
  // choisie explicitement ailleurs (playTrack/playAlbum) efface cette ref — quitter la
  // Radio en cliquant autre chose est le comportement attendu, pas un mode à confirmer.
  const activeRadioSessionRef = useRef<string | null>(null);
  // Incrémenté par toute demande de lecture explicite (playTrack/playAlbum/playFromRadio)
  // ou par `close()`. Le sondage de `playAlbum` pendant un `status: 'pending'` compare ce
  // compteur avant d'appliquer chaque résultat : si l'utilisateur a demandé autre chose
  // entre-temps, la réponse tardive du sondage ne doit rien écraser.
  const requestTokenRef = useRef(0);

  function updateState(next: PlaybackState): void {
    stateRef.current = next;
    setState(next);
  }

  // `mountYoutubePlayer` (ci-dessous) doit invoquer `advanceQueue`, qui doit lui-même
  // pouvoir déclencher `mountYoutubePlayer` via `applyResolution` : une dépendance
  // circulaire entre les trois. Le pont passe par une ref plutôt que par un tableau de
  // dépendances impossible à écrire correctement.
  const advanceQueueRef = useRef<() => void>(() => {});

  const mountYoutubePlayer = useCallback((videoId: string) => {
    void loadYoutubeIframeApi().then(() => {
      if (!window.YT) {
        return;
      }

      if (playerRef.current) {
        playerRef.current.loadVideoById(videoId);
        return;
      }

      const container = youtubeContainerRef.current;
      if (!container) {
        // Le conteneur est toujours rendu par `PlayerBar` ; ce cas ne devrait pas se
        // produire, mais échouer silencieusement vaut mieux que planter la lecture.
        return;
      }

      // Créée hors de React : c'est ce nœud, et lui seul, que l'API YouTube remplacera
      // par un <iframe>. React ne le rend jamais via JSX, donc ne peut jamais tenter de
      // le déplacer ou de le retirer une fois cette substitution faite.
      const target = document.createElement('div');
      container.appendChild(target);

      playerRef.current = new window.YT.Player(target, {
        videoId,
        // `autoplay: 1` suffit en général, mais certains navigateurs ignorent ce
        // paramètre selon le moment exact où le lecteur devient prêt : le clic sur
        // « play » est un vrai geste utilisateur, donc l'appel explicite dans `onReady`
        // est autorisé par les politiques d'autoplay et sert de filet de sécurité — sans
        // lui, la lecture démarrait parfois en pause, forçant à recliquer dans le lecteur.
        playerVars: { playsinline: 1, autoplay: 1 },
        events: {
          onReady: (event) => {
            event.target.playVideo();
          },
          onStateChange: (event) => {
            if (window.YT && event.data === window.YT.PlayerState.ENDED) {
              advanceQueueRef.current();
            }
          },
        },
      });
    });
  }, []);

  const stopYoutubePlayer = useCallback(() => {
    playerRef.current?.destroy();
    playerRef.current = null;
    if (youtubeContainerRef.current) {
      youtubeContainerRef.current.innerHTML = '';
    }
  }, []);

  const applyResolution = useCallback(
    (response: ResolutionResponse) => {
      if (response.status === 'empty' || !response.track) {
        // Sans quoi la vidéo précédente resterait montée — hors écran (le conteneur
        // passe en `hidden`), mais toujours en train de jouer.
        stopYoutubePlayer();

        if (activeRadioSessionRef.current) {
          const reason = response.status === 'unavailable' ? 'unavailable' : 'exhausted';
          activeRadioSessionRef.current = null;
          updateState({ status: 'radio_ended', reason });
          return;
        }

        updateState({ status: 'idle' });
        return;
      }

      const track = response.track;
      currentTrackIdRef.current = track.id;

      if (!response.playback || response.playback.status === 'unresolved') {
        // Même raison : une piste non résolue ne doit jamais laisser la précédente
        // continuer à jouer en arrière-plan — bug observé en enchaînant deux pistes.
        stopYoutubePlayer();
        updateState({
          status: 'unresolved',
          track,
          unresolved: {
            youtubeSearchUrl: response.playback?.youtubeSearchUrl ?? '',
            spotifySearchUrl: response.playback?.spotifySearchUrl ?? null,
            quotaExhausted: response.playback?.quotaExhausted ?? false,
          },
        });
        return;
      }

      if (response.playback.provider === 'youtube') {
        updateState({ status: 'playing_youtube', track, videoId: response.playback.videoId });
        mountYoutubePlayer(response.playback.videoId);
        return;
      }

      stopYoutubePlayer();
      updateState({
        status: 'playing_spotify',
        track,
        entityType: response.playback.embedType,
        spotifyId: response.playback.spotifyId,
      });
    },
    [mountYoutubePlayer, stopYoutubePlayer],
  );

  const advanceQueue = useCallback(async () => {
    const current = stateRef.current;
    if (current.status !== 'playing_youtube') {
      return;
    }

    const track = current.track;
    const radioSessionId = activeRadioSessionRef.current;
    updateState({ status: 'loading', track });

    // En Radio, « la suite » est un nouveau tirage dans la session ; sinon, c'est la
    // piste suivante du même album, dans l'ordre du disque (§13.6).
    const response = radioSessionId
      ? await postJson(`/api/radio-sessions/${radioSessionId}/draws`, {})
      : await postJson('/api/resolutions/next', {
          releaseId: track.releaseId,
          afterOrdinal: track.ordinal,
        });

    // La piste en cours a changé entre-temps (l'utilisateur a lancé autre chose) : on
    // n'écrase pas son choix avec une réponse devenue obsolète.
    if (currentTrackIdRef.current !== track.id) {
      return;
    }

    if (!response) {
      updateState({ status: 'idle' });
      return;
    }

    // Fin d'album (mode piste-à-piste normal) : jamais renvoyé par la Radio, qui a son
    // propre vocabulaire de fin (`exhausted`/`unavailable`, géré par `applyResolution`).
    if (!radioSessionId && (response.status === 'end_of_album' || !response.track)) {
      updateState({ status: 'idle' });
      return;
    }

    applyResolution(response);
  }, [applyResolution]);

  // La mutation d'une ref pendant le rendu est interdite (React) : on la fait dans un
  // effet, qui s'exécute après le commit et se réexécute à chaque nouvelle identité
  // d'`advanceQueue` (stable en pratique, `applyResolution` ne changeant pas non plus).
  useEffect(() => {
    advanceQueueRef.current = () => void advanceQueue();
  }, [advanceQueue]);

  const playTrack = useCallback(
    async (trackId: string) => {
      // Choisir explicitement une piste ailleurs met fin à la Radio en cours, sans
      // confirmation à demander : c'est le comportement attendu d'un clic délibéré.
      activeRadioSessionRef.current = null;
      requestTokenRef.current += 1;
      updateState({
        status: 'loading',
        track: {
          id: trackId,
          ordinal: 0,
          releaseId: '',
          discogsReleaseId: '',
          releaseTitle: '',
          artists: '',
          coverUrl: null,
        },
      });

      const response = await postJson('/api/resolutions/track', { trackId });
      if (!response) {
        if (stateRef.current.status === 'loading') {
          updateState({ status: 'error', track: stateRef.current.track });
        }
        return;
      }

      applyResolution(response);
    },
    [applyResolution],
  );

  const playAlbum = useCallback(
    async (discogsReleaseId: string) => {
      activeRadioSessionRef.current = null;
      const token = (requestTokenRef.current += 1);
      const placeholderTrack: TrackMeta = {
        id: '',
        ordinal: 0,
        releaseId: '',
        discogsReleaseId,
        releaseTitle: '',
        artists: '',
        coverUrl: null,
      };
      updateState({ status: 'loading', track: placeholderTrack });

      // `status: 'pending'` (§4.2, Lot 6bis) : l'édition n'a pas encore ses pistes. Une
      // récupération prioritaire vient d'être programmée côté serveur — on sonde jusqu'à
      // ce qu'elle aboutisse plutôt que de renvoyer un échec immédiat, pour que « cliquer
      // play » favorise vraiment la lecture au lieu d'exiger un second clic une fois
      // l'import terminé.
      for (let attempt = 0; attempt <= TRACKLIST_PENDING_POLL_MAX_ATTEMPTS; attempt += 1) {
        const response = await postJson('/api/resolutions/album', { discogsReleaseId });

        // Une autre lecture (ou une fermeture) a été demandée pendant l'attente : cette
        // réponse, même valide, ne correspond plus à ce que l'utilisateur veut voir.
        if (requestTokenRef.current !== token) {
          return;
        }

        if (!response) {
          updateState({ status: 'error', track: placeholderTrack });
          return;
        }

        if (response.status !== 'pending') {
          applyResolution(response);
          return;
        }

        if (attempt === 0) {
          updateState({ status: 'loading', track: placeholderTrack, reason: 'tracklist_pending' });
        }

        if (attempt === TRACKLIST_PENDING_POLL_MAX_ATTEMPTS) {
          updateState({ status: 'error', track: placeholderTrack });
          return;
        }

        await sleep(TRACKLIST_PENDING_POLL_INTERVAL_MS);
      }
    },
    [applyResolution],
  );

  const playFromRadio = useCallback(
    async (radioSessionId: string) => {
      activeRadioSessionRef.current = radioSessionId;
      requestTokenRef.current += 1;
      updateState({
        status: 'loading',
        track: {
          id: '',
          ordinal: 0,
          releaseId: '',
          discogsReleaseId: '',
          releaseTitle: '',
          artists: '',
          coverUrl: null,
        },
      });

      const response = await postJson(`/api/radio-sessions/${radioSessionId}/draws`, {});
      if (!response) {
        if (stateRef.current.status === 'loading') {
          updateState({ status: 'error', track: stateRef.current.track });
        }
        return;
      }

      applyResolution(response);
    },
    [applyResolution],
  );

  const pasteUrl = useCallback(
    async (url: string): Promise<boolean> => {
      const before = stateRef.current;
      if (before.status !== 'unresolved') {
        return false;
      }

      const response = await fetch('/api/provider-urls/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url, trackId: before.track.id || undefined }),
      });

      if (!response.ok) {
        return false;
      }

      const data = (await response.json()) as
        | { provider: 'youtube'; videoId: string }
        | { provider: 'spotify'; entityType: 'track' | 'album'; spotifyId: string };

      const track = before.track;
      currentTrackIdRef.current = track.id;

      if (data.provider === 'youtube') {
        updateState({ status: 'playing_youtube', track, videoId: data.videoId });
        mountYoutubePlayer(data.videoId);
      } else {
        updateState({
          status: 'playing_spotify',
          track,
          entityType: data.entityType,
          spotifyId: data.spotifyId,
        });
      }

      return true;
    },
    [mountYoutubePlayer],
  );

  const close = useCallback(() => {
    stopYoutubePlayer();
    currentTrackIdRef.current = null;
    activeRadioSessionRef.current = null;
    requestTokenRef.current += 1;
    updateState({ status: 'idle' });
  }, [stopYoutubePlayer]);

  return (
    <PlaybackContext.Provider
      value={{ state, playTrack, playAlbum, playFromRadio, pasteUrl, close, setYoutubeContainer }}
    >
      {children}
    </PlaybackContext.Provider>
  );
}

export function usePlayback(): PlaybackContextValue {
  const context = useContext(PlaybackContext);
  if (!context) {
    throw new Error('usePlayback doit être utilisé sous PlaybackProvider');
  }
  return context;
}
