// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OriginProgressStatus } from '@/modules/collection/components/origin-progress';
import type { OriginProgress } from '@/modules/collection/origin-progress';

const initial: OriginProgress = {
  ownerId: 'e2d583cf-7337-4af2-93d7-a74271d4d083',
  total: 3,
  known: 1,
  pending: 2,
  failed: 0,
  unavailable: 0,
  workerUpdateRequired: false,
};
const fetchMock = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

it('actualise le suivi à cinq secondes puis arrête les requêtes après traitement', async () => {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ ...initial, known: 3, pending: 0 }),
  });
  render(<OriginProgressStatus initial={initial} />);
  await act(() => vi.advanceTimersByTimeAsync(4999));
  expect(fetchMock).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(screen.getByRole('status')).toHaveTextContent('3 identifiés · 0 à rechercher');
  expect(screen.getByText(/De nouvelles origines sont disponibles/)).toBeVisible();
  await act(() => vi.advanceTimersByTimeAsync(15_000));
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('conserve les données lors d’une panne et reprend le suivi', async () => {
  fetchMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({
    ok: true,
    json: async () => ({ ...initial, pending: 0, failed: 2, workerUpdateRequired: true }),
  });
  render(<OriginProgressStatus initial={initial} />);
  await act(() => vi.advanceTimersByTimeAsync(5000));
  expect(screen.getByRole('status')).toHaveTextContent('2 à rechercher');
  expect(screen.getByText(/Le suivi est momentanément indisponible/)).toBeVisible();
  await act(() => vi.advanceTimersByTimeAsync(5000));
  expect(screen.getByText(/mis à jour et redémarré/)).toBeVisible();
  expect(screen.queryByText(/Le suivi est momentanément indisponible/)).not.toBeInTheDocument();
});

it('ignore une réponse d’une autre collection', async () => {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      ...initial,
      ownerId: '54ea60ce-6ae2-4948-88e3-3b1e5176dbd8',
      known: 3,
      pending: 0,
    }),
  });
  render(<OriginProgressStatus initial={initial} />);
  await act(() => vi.advanceTimersByTimeAsync(5000));
  expect(screen.getByRole('status')).toHaveTextContent('1 identifiés · 2 à rechercher');
});

it('annule la requête lors du démontage sans chevauchement', async () => {
  fetchMock.mockImplementation(() => new Promise(() => {}));
  const view = render(<OriginProgressStatus initial={initial} />);
  await act(() => vi.advanceTimersByTimeAsync(15_000));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const signal = fetchMock.mock.calls[0]![1].signal as AbortSignal;
  view.unmount();
  expect(signal.aborted).toBe(true);
});
