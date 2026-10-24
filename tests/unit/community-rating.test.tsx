// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { CommunityRating } from '@/modules/catalog/components/community-rating';

afterEach(cleanup);

it('affiche la moyenne Discogs sur cinq et le nombre de votes', () => {
  render(<CommunityRating average={4.7} count={1234} />);
  expect(screen.getByText('Note de la communauté Discogs')).toBeVisible();
  expect(screen.getByText(/4,70 \/ 5/)).toBeVisible();
  expect(screen.getByText(/1.234 votes/)).toBeVisible();
});

it('distingue une édition sans vote d’une note encore inconnue', () => {
  const { rerender } = render(<CommunityRating average={null} count={0} />);
  expect(screen.getByText('Aucun vote pour cette édition.')).toBeVisible();
  expect(screen.queryByText(/0,00/)).not.toBeInTheDocument();
  rerender(<CommunityRating average={null} count={null} />);
  expect(screen.getByText('Note indisponible pour le moment.')).toBeVisible();
});
