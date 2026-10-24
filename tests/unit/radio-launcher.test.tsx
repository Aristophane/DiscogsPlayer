// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RadioLauncher } from '@/modules/radio/components/radio-launcher';

const { playFromRadio } = vi.hoisted(() => ({ playFromRadio: vi.fn(async () => {}) }));
vi.mock('@/modules/playback/playback-context', () => ({
  usePlayback: () => ({ state: { status: 'idle' }, playFromRadio }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('choix de la radio', () => {
  it('propose ma collection par défaut puis les collections des amis avec leurs filtres', async () => {
    const request = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ id: 'radio-amis' }), { status: 201 }),
    );
    vi.stubGlobal('fetch', request);
    render(
      <RadioLauncher
        facets={{ genres: [{ value: 'Rock', count: 1 }], styles: [] }}
        friendsFacets={{
          genres: [
            { value: 'Rock', count: 1 },
            { value: 'Jazz', count: 1 },
          ],
          styles: [],
        }}
      />,
    );
    expect(screen.getByRole('radio', { name: 'Ma collection' })).toBeChecked();
    expect(screen.queryByLabelText(/Jazz/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Rock/));
    fireEvent.click(screen.getByRole('radio', { name: /^Ma collection \+ amis/ }));
    expect(screen.getByLabelText(/Rock/)).not.toBeChecked();
    fireEvent.click(screen.getByLabelText(/Jazz/));
    fireEvent.click(screen.getByRole('button', { name: 'Lancer la radio' }));
    await waitFor(() => expect(playFromRadio).toHaveBeenCalledWith('radio-amis'));
    expect(JSON.parse(request.mock.calls[0]![1]!.body as string)).toEqual({
      includeFriends: true,
      genres: ['Jazz'],
      styles: [],
    });
  });
});
