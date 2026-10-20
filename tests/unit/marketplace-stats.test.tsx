// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { MarketplaceStats } from '@/modules/catalog/components/marketplace-stats';

afterEach(cleanup);

const initial = {
  discogsReleaseId: '12345',
  lowestPriceEur: '42.50',
  numForSale: 3,
  statisticsFetchedAt: new Date('2026-10-18T23:30:00Z'),
};

it('affiche les prix en euros, les annonces de l’édition et la date du relevé à Paris', () => {
  render(<MarketplaceStats {...initial} />);
  const region = screen.getByRole('region', { name: 'Vente sur Discogs' });
  expect(within(region).getByText(/42,50\s*€/)).toBeVisible();
  expect(within(region).getByText('3')).toBeVisible();
  expect(within(region).getByText('Discogs · mis à jour le 19/10/2026')).toBeVisible();
  expect(within(region).getByText(/ni une vente conclue ni une estimation/)).toBeVisible();
  const link = within(region).getByRole('link', { name: /Voir les annonces sur Discogs/ });
  expect(link).toHaveAttribute('href', 'https://www.discogs.com/sell/release/12345?currency=EUR');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});

it('ne présente pas un ancien prix quand il n’y a plus d’annonces', () => {
  render(<MarketplaceStats {...initial} numForSale={0} />);
  expect(screen.getByText(/Aucun exemplaire en vente/)).toBeVisible();
  expect(screen.getByText('0')).toBeVisible();
  expect(screen.getByText('Prix indisponible')).toBeVisible();
  expect(screen.queryByText(/42,50/)).not.toBeInTheDocument();
});

it('distingue les données inconnues de l’absence d’annonces', () => {
  render(
    <MarketplaceStats
      {...initial}
      lowestPriceEur={null}
      numForSale={null}
      statisticsFetchedAt={null}
    />,
  );
  expect(screen.getByText('Donnée indisponible')).toBeVisible();
  expect(screen.getByText('Prix indisponible')).toBeVisible();
  expect(screen.queryByText(/Aucun exemplaire en vente/)).not.toBeInTheDocument();
  expect(screen.queryByText(/mis à jour le/)).not.toBeInTheDocument();
});

it('conserve le nombre d’annonces même si leur prix est inconnu', () => {
  render(<MarketplaceStats {...initial} lowestPriceEur={null} />);
  expect(screen.getByText('3')).toBeVisible();
  expect(screen.getByText('Prix indisponible')).toBeVisible();
});
