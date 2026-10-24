// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@/lib/i18n';
import { HomeFeed } from '@/modules/feed/components/home-feed';
import type { FeedItem, FeedPage } from '@/modules/feed/contracts';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/modules/playback/playback-context', () => ({
  usePlayback: () => ({ playAlbum: vi.fn() }),
}));
const fetchMock = vi.fn();
const ownerId = '00000000-0000-4000-8000-000000000001';

it('présente une note Discogs dans une publication du fil sans la confondre avec un prix', () => {
  const post = item(1);
  post.kind = 'stat';
  post.story = null;
  post.statistic = {
    metric: 'rating',
    rating: 4.85,
    ratingCount: 128,
    price: '12.00',
    have: 50,
    want: 25,
  };
  render(<HomeFeed userId={ownerId} initial={page([post])} activeOwnerId={ownerId} />);
  expect(screen.getByText(/4,85 \/ 5/)).toBeVisible();
  expect(screen.getByText(/128 vote/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Explorer les stats' })).toBeVisible();
  expect(screen.queryByText(/12,00/)).not.toBeInTheDocument();
});
function item(n: number): FeedItem {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    ownerId,
    discogsReleaseId: String(n),
    day: '2026-10-17',
    kind: 'artist',
    title: `Album ${n}`,
    artists: 'Artiste',
    coverUrl: null,
    year: 1999,
    ownerUsername: null,
    addedAt: null,
    statistic: null,
    story: {
      kind: 'artist',
      title: `Portrait ${n}`,
      text: 'Un extrait de test attribué à sa source. '.repeat(15),
      sourceName: 'Wikipédia',
      sourceUrl: 'https://fr.wikipedia.org/wiki/Exemple',
      language: 'fr',
      publishedAt: null,
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    },
  };
}
function page(
  items: FeedItem[],
  cursor: string | null = null,
  status: FeedPage['status'] = 'ready',
): FeedPage {
  return { items, nextCursor: cursor, status, day: '2026-10-17' };
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('IntersectionObserver', undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  vi.restoreAllMocks();
});

it('déplie un extrait et conserve les liens de source et de licence', () => {
  render(<HomeFeed userId={ownerId} initial={page([item(1)])} activeOwnerId={ownerId} />);
  const expand = screen.getByRole('button', { name: 'Voir plus' });
  expect(expand).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(expand);
  expect(screen.getByRole('button', { name: 'Réduire' })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('link', { name: /Wikipédia/ })).toHaveAttribute(
    'href',
    'https://fr.wikipedia.org/wiki/Exemple',
  );
  expect(screen.getByRole('link', { name: 'Licence de l’extrait' })).toHaveAttribute(
    'rel',
    'noopener noreferrer',
  );
});

it('affiche la rubrique d’une anecdote sélectionnée et conserve les anciens libellés', () => {
  const anecdote = item(1);
  anecdote.story!.editorial = {
    version: 1,
    score: 73,
    topic: 'recording',
    section: 'Enregistrement',
  };
  render(<HomeFeed userId={ownerId} initial={page([anecdote, item(2)])} activeOwnerId={ownerId} />);
  expect(screen.getByText('En studio')).toBeVisible();
  expect(screen.getByText(t('feed.kind.artist'))).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Portrait 1' })).toBeVisible();
  expect(screen.queryByText(/73/)).not.toBeInTheDocument();
});

it('limite les récits à trois lignes et laisse chaque publication se déplier indépendamment', () => {
  const one = item(1);
  const two = item(2);
  render(<HomeFeed userId={ownerId} initial={page([one, two])} activeOwnerId={ownerId} />);
  const texts = [one, two].map(({ id }) => document.getElementById(`post-text-${id}`)!);
  const buttons = screen.getAllByRole('button', { name: 'Voir plus' });
  expect(texts[0]).toHaveClass('line-clamp-3');
  expect(texts[1]).toHaveClass('line-clamp-3');
  expect(buttons[0]).toHaveAttribute('aria-controls', texts[0]!.id);
  fireEvent.click(buttons[0]!);
  expect(texts[0]).not.toHaveClass('line-clamp-3');
  expect(texts[1]).toHaveClass('line-clamp-3');
  fireEvent.click(screen.getByRole('button', { name: 'Réduire' }));
  expect(texts[0]).toHaveClass('line-clamp-3');
});

it('propose aussi le dépliage des récits courts susceptibles de dépasser trois lignes sur mobile', () => {
  const record = item(1);
  record.story!.text =
    'Une anecdote courte mais suffisamment détaillée pour que sa fin reste accessible sur les petits écrans. '.repeat(
      2,
    );
  render(<HomeFeed userId={ownerId} initial={page([record])} activeOwnerId={ownerId} />);
  expect(record.story!.text.length).toBeLessThan(220);
  expect(screen.getByRole('button', { name: 'Voir plus' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});

it('conserve les cartes pendant une panne puis ajoute la suite sans doublon', async () => {
  fetchMock
    .mockRejectedValueOnce(new Error('hors ligne'))
    .mockResolvedValueOnce({ ok: true, json: async () => page([item(1), item(2)]) });
  render(
    <HomeFeed userId={ownerId} initial={page([item(1)], 'curseur')} activeOwnerId={ownerId} />,
  );
  await waitFor(() => expect(screen.getByRole('region')).not.toHaveAttribute('aria-busy', 'true'));
  fireEvent.click(screen.getByRole('button', { name: 'Charger la suite' }));
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(screen.getAllByRole('article')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(2));
  expect(screen.queryByRole('button', { name: 'Charger la suite' })).not.toBeInTheDocument();
});

it('annonce les enrichissements sans modifier la lecture avant le clic', async () => {
  vi.useFakeTimers();
  fetchMock.mockResolvedValue({ ok: true, json: async () => page([item(1), item(2)]) });
  render(
    <HomeFeed
      userId={ownerId}
      initial={page([item(1)], null, 'pending')}
      activeOwnerId={ownerId}
    />,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(32);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(screen.getAllByRole('article')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: /De nouveaux récits sont prêts/ }));
  expect(screen.getAllByRole('article')).toHaveLength(2);
});

it('rend la préparation visible lorsque le fil ne contient encore que des suggestions', () => {
  const suggestion = { ...item(1), kind: 'listen' as const, story: null };
  render(
    <HomeFeed
      userId={ownerId}
      initial={page([suggestion], null, 'pending')}
      activeOwnerId={ownerId}
    />,
  );
  expect(screen.getByRole('status')).toBeVisible();
  expect(screen.getByRole('status')).not.toHaveClass('sr-only');
});

it('annonce honnêtement l’absence de nouveau récit au lieu de présenter les suggestions comme des anecdotes', () => {
  const suggestion = { ...item(1), kind: 'listen' as const, story: null };
  render(<HomeFeed userId={ownerId} initial={page([suggestion])} activeOwnerId={ownerId} />);
  expect(screen.getByRole('status')).toHaveTextContent(
    'Aucune nouvelle anecdote suffisamment étayée',
  );
});

it('ne charge pas la position de lecture d’un autre compte', async () => {
  localStorage.setItem(
    'dp:feed-reading:00000000-0000-4000-8000-000000000099',
    JSON.stringify({
      version: 1,
      anchor: { id: item(99).id, offset: -50 },
      y: 2000,
      loadedCount: 99,
      expandedIds: [],
    }),
  );
  render(<HomeFeed userId={ownerId} initial={page([item(1)], 'suite')} activeOwnerId={ownerId} />);
  await waitFor(() => expect(screen.getByRole('region')).not.toHaveAttribute('aria-busy', 'true'));
  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.getAllByRole('article')).toHaveLength(1);
});

it('reste utilisable si le navigateur refuse le stockage de la position', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('Stockage refusé');
  });
  render(<HomeFeed userId={ownerId} initial={page([item(1)])} activeOwnerId={ownerId} />);
  await waitFor(() => expect(screen.getByRole('region')).not.toHaveAttribute('aria-busy', 'true'));
  fireEvent.click(screen.getByRole('button', { name: 'Voir plus' }));
  expect(screen.getByRole('button', { name: 'Réduire' })).toHaveAttribute('aria-expanded', 'true');
});
