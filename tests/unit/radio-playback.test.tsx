// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PlaybackProvider, usePlayback } from '@/modules/playback/playback-context';
import type { YtPlayer } from '@/modules/providers/youtube/iframe-loader';

vi.mock('@/modules/providers/youtube/iframe-loader', () => ({
  loadYoutubeIframeApi: vi.fn(async () => {}),
}));

type PlayerOptions = ConstructorParameters<NonNullable<Window['YT']>['Player']>[1];
let options: PlayerOptions;
let player: YtPlayer;
const fetchMock = vi.fn<typeof fetch>();

function Harness() {
  const { state, playFromRadio, skip, previous, canGoBack, close, setYoutubeContainer } =
    usePlayback();
  return (
    <>
      <button onClick={() => void playFromRadio('session')}>Radio</button>
      <button onClick={skip}>Suivant</button>
      <button onClick={previous} disabled={!canGoBack}>
        Précédent
      </button>
      <button onClick={close}>Fermer</button>
      <div ref={setYoutubeContainer} />
      <output>{JSON.stringify(state)}</output>
    </>
  );
}

function resolved(id: string) {
  return {
    status: 'track',
    track: {
      id,
      ordinal: 0,
      releaseId: id,
      discogsReleaseId: id,
      releaseTitle: id,
      artists: 'Artiste',
      coverUrl: null,
    },
    playback: { status: 'resolved', provider: 'youtube', videoId: `video-${id}`, title: id },
  };
}

function reply(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200 });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  window.YT = {
    Player: class {
      constructor(_element: HTMLElement, config: PlayerOptions) {
        options = config;
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- Instance du faux lecteur, cible des événements simulés.
        player = this;
      }
      loadVideoById = vi.fn();
      playVideo = vi.fn();
      pauseVideo = vi.fn();
      mute = vi.fn();
      unMute = vi.fn();
      isMuted = vi.fn(() => false);
      destroy = vi.fn();
    },
    PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2 },
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete window.YT;
});

async function start() {
  render(
    <PlaybackProvider>
      <Harness />
    </PlaybackProvider>,
  );
  fireEvent.click(screen.getByText('Radio'));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('playing_youtube'));
}

describe('enchaînement radio', () => {
  it('revient en arrière et reparcourt les titres suivants avant de tirer une nouvelle piste', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(resolved('premier')))
      .mockResolvedValueOnce(reply(resolved('second')))
      .mockResolvedValueOnce(reply(resolved('troisième')));
    await start();
    expect(screen.getByText('Précédent')).toBeDisabled();
    fireEvent.click(screen.getByText('Suivant'));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('video-second'));
    fireEvent.click(screen.getByText('Précédent'));
    expect(screen.getByRole('status')).toHaveTextContent('video-premier');
    fireEvent.click(screen.getByText('Suivant'));
    expect(screen.getByRole('status')).toHaveTextContent('video-second');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByText('Suivant'));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('video-troisième'));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('conserve les titres précédents après la fin de radio, puis les oublie à la fermeture', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(resolved('premier')))
      .mockResolvedValueOnce(reply({ status: 'exhausted' }));
    await start();
    fireEvent.click(screen.getByText('Suivant'));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('radio_ended'));
    fireEvent.click(screen.getByText('Précédent'));
    expect(screen.getByRole('status')).toHaveTextContent('video-premier');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByText('Fermer'));
    expect(screen.getByText('Précédent')).toBeDisabled();
  });

  it('efface l’historique lorsqu’une nouvelle radio est lancée', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(resolved('premier')))
      .mockResolvedValueOnce(reply(resolved('second')))
      .mockResolvedValueOnce(reply(resolved('nouveau')));
    await start();
    fireEvent.click(screen.getByText('Suivant'));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('video-second'));
    fireEvent.click(screen.getByText('Radio'));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('video-nouveau'));
    expect(screen.getByText('Précédent')).toBeDisabled();
  });
  it('retente un tirage en erreur réseau puis passe au titre suivant', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(resolved('premier')))
      .mockRejectedValueOnce(new TypeError('réseau'))
      .mockResolvedValueOnce(reply(resolved('second')));
    await start();
    fireEvent.click(screen.getByText('Suivant'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('video-second'));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('sort de la recherche si les deux tentatives échouent', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(resolved('premier')))
      .mockRejectedValue(new TypeError('réseau'));
    await start();
    fireEvent.click(screen.getByText('Suivant'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('radio_ended'));
    expect(screen.getByRole('status').textContent).toContain('unavailable');
    expect(player.destroy).toHaveBeenCalled();
  });

  it('ignore une vidéo illisible et tire la suivante', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(resolved('premier')))
      .mockResolvedValueOnce(reply(resolved('second')));
    await start();
    act(() => options.events?.onError?.({ data: 150, target: player }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('video-second'));
  });

  it('ignore une vidéo dont le démarrage reste bloqué', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(resolved('premier')))
      .mockResolvedValueOnce(reply(resolved('second')));
    vi.useFakeTimers();
    render(
      <PlaybackProvider>
        <Harness />
      </PlaybackProvider>,
    );
    await act(async () => fireEvent.click(screen.getByText('Radio')));
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(screen.getByRole('status').textContent).toContain('video-second');
  });

  it('ne passe pas une vidéo mise en pause par l’utilisateur', async () => {
    fetchMock.mockResolvedValueOnce(reply(resolved('premier')));
    vi.useFakeTimers();
    render(
      <PlaybackProvider>
        <Harness />
      </PlaybackProvider>,
    );
    await act(async () => fireEvent.click(screen.getByText('Radio')));
    act(() => options.events?.onStateChange?.({ data: 2, target: player }));
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toContain('video-premier');
  });

  it('ignore une réponse tardive après fermeture du lecteur', async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <PlaybackProvider>
        <Harness />
      </PlaybackProvider>,
    );
    fireEvent.click(screen.getByText('Radio'));
    fireEvent.click(screen.getByText('Fermer'));
    await act(async () => finish(reply(resolved('tardif'))));
    expect(screen.getByRole('status').textContent).toContain('idle');
  });
});
