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
  | { status: 'loading'; track: TrackMeta }
  | { status: 'playing_youtube'; track: TrackMeta; videoId: string }
  | {
      status: 'playing_spotify';
      track: TrackMeta;
      entityType: 'track' | 'album';
      spotifyId: string;
    }
  | { status: 'unresolved'; track: TrackMeta; unresolved: Unresolved }
  | { status: 'error'; track: TrackMeta };

type PlaybackContextValue = {
  state: PlaybackState;
  playTrack: (trackId: string) => Promise<void>;
  playAlbum: (discogsReleaseId: string) => Promise<void>;
  pasteUrl: (url: string) => Promise<boolean>;
  close: () => void;
  /** Élément DOM cible du lecteur YouTube — le lecteur persistant le mesure et l'affiche. */
  youtubeMountId: string;
};

const PlaybackContext = createContext<PlaybackContextValue | null>(null);

const YOUTUBE_MOUNT_ID = 'discogs-player-youtube-target';

type ResolutionResponse = {
  track?: TrackMeta;
  playback?:
    | { status: 'resolved'; provider: 'youtube'; videoId: string; title: string | null }
    | { status: 'resolved'; provider: 'spotify'; embedType: 'track' | 'album'; spotifyId: string }
    | ({ status: 'unresolved' } & Unresolved);
  status?: 'empty' | 'next' | 'end_of_album';
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

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PlaybackState>({ status: 'idle' });
  const playerRef = useRef<YtPlayer | null>(null);

  // `state` en miroir, lu de façon synchrone par les callbacks (ex. la fin d'une vidéo)
  // sans passer par le hack `setState(current => …)` uniquement pour lire une valeur —
  // ce détournement est justement ce que la règle react-hooks/immutability signale.
  const stateRef = useRef<PlaybackState>(state);
  // Évite qu'un événement "fin de piste" tardif d'un lecteur qu'on vient de quitter ne
  // déclenche l'enchaînement d'une piste qui n'est déjà plus celle en cours.
  const currentTrackIdRef = useRef<string | null>(null);

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

      playerRef.current = new window.YT.Player(YOUTUBE_MOUNT_ID, {
        videoId,
        playerVars: { playsinline: 1 },
        events: {
          onStateChange: (event) => {
            if (window.YT && event.data === window.YT.PlayerState.ENDED) {
              advanceQueueRef.current();
            }
          },
        },
      });
    });
  }, []);

  const applyResolution = useCallback(
    (response: ResolutionResponse) => {
      if (response.status === 'empty' || !response.track) {
        updateState({ status: 'idle' });
        return;
      }

      const track = response.track;
      currentTrackIdRef.current = track.id;

      if (!response.playback || response.playback.status === 'unresolved') {
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

      updateState({
        status: 'playing_spotify',
        track,
        entityType: response.playback.embedType,
        spotifyId: response.playback.spotifyId,
      });
    },
    [mountYoutubePlayer],
  );

  const advanceQueue = useCallback(async () => {
    const current = stateRef.current;
    if (current.status !== 'playing_youtube') {
      return;
    }

    const track = current.track;
    updateState({ status: 'loading', track });

    const response = await postJson('/api/resolutions/next', {
      releaseId: track.releaseId,
      afterOrdinal: track.ordinal,
    });

    // La piste en cours a changé entre-temps (l'utilisateur a lancé autre chose) : on
    // n'écrase pas son choix avec une réponse devenue obsolète.
    if (currentTrackIdRef.current !== track.id) {
      return;
    }

    if (!response || response.status === 'end_of_album' || !response.track) {
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
      updateState({
        status: 'loading',
        track: {
          id: '',
          ordinal: 0,
          releaseId: '',
          discogsReleaseId,
          releaseTitle: '',
          artists: '',
          coverUrl: null,
        },
      });

      const response = await postJson('/api/resolutions/album', { discogsReleaseId });
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
    playerRef.current?.destroy();
    playerRef.current = null;
    currentTrackIdRef.current = null;
    updateState({ status: 'idle' });
  }, []);

  return (
    <PlaybackContext.Provider
      value={{ state, playTrack, playAlbum, pasteUrl, close, youtubeMountId: YOUTUBE_MOUNT_ID }}
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
