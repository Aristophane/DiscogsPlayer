// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { RefreshStatistics } from '@/modules/collection/components/refresh-statistics';
import type { Highlights } from '@/modules/collection/home-contracts';

const initial: Highlights = { wanted: [], valuable: [], total: 2, fetched: 1, fresh: 1 };
const fetchMock = vi.fn();

function Harness() {
  const [highlights, update] = useState(initial);
  return <RefreshStatistics highlights={highlights} onUpdate={update} />;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

it('affiche le décompte, met à jour la progression à cinq secondes puis arrête le polling', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...initial, fresh: 2 }) });
  render(<Harness />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4000);
  });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.getByText('Mise à jour des classements dans 1 s')).toBeVisible();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000);
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('préserve les résultats en cas d’erreur et permet de réessayer', async () => {
  fetchMock
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ ok: true, json: async () => ({ ...initial, fresh: 2 }) });
  render(<Harness />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(screen.getByRole('alert')).toBeVisible();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  await act(async () => {
    fireEvent.click(screen.getByRole('button'));
  });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
});

it('ne chevauche pas les requêtes et les annule au démontage', async () => {
  fetchMock.mockImplementation(() => new Promise(() => {}));
  const view = render(<Harness />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const signal = fetchMock.mock.calls[0]![1].signal as AbortSignal;
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
