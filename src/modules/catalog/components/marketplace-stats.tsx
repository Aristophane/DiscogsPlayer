import { t } from '@/lib/i18n';
import type { ReleaseView } from '../release-service';

const priceFormat = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const countFormat = new Intl.NumberFormat('fr-FR');

export function MarketplaceStats({
  discogsReleaseId,
  lowestPriceEur,
  numForSale,
  statisticsFetchedAt,
}: Pick<
  ReleaseView,
  'discogsReleaseId' | 'lowestPriceEur' | 'numForSale' | 'statisticsFetchedAt'
>) {
  const price = lowestPriceEur === null ? null : Number(lowestPriceEur);
  const hasPrice =
    numForSale !== null && numForSale > 0 && price !== null && Number.isFinite(price);

  return (
    <section
      aria-labelledby="release-marketplace"
      className="flex flex-col gap-3 border-t border-border pt-6"
    >
      <h2 id="release-marketplace" className="text-lg font-medium">
        {t('release.marketplace.title')}
      </h2>
      {numForSale === 0 ? (
        <p className="text-sm text-muted">{t('release.marketplace.none')}</p>
      ) : null}
      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-muted">{t('release.marketplace.lowestPrice')}</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">
            {hasPrice ? priceFormat.format(price) : t('release.marketplace.noPrice')}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted">{t('release.marketplace.forSale')}</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">
            {numForSale === null ? t('statistics.unavailable') : countFormat.format(numForSale)}
          </dd>
        </div>
      </dl>
      <p className="text-xs leading-relaxed text-muted">{t('release.marketplace.hint')}</p>
      {statisticsFetchedAt ? (
        <p className="text-xs text-muted">
          {t('statistics.updated', {
            date: statisticsFetchedAt.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' }),
          })}
        </p>
      ) : null}
      <a
        href={`https://www.discogs.com/sell/release/${encodeURIComponent(discogsReleaseId)}?currency=EUR`}
        target="_blank"
        rel="noopener noreferrer"
        className="self-start py-2 text-sm underline underline-offset-4"
      >
        {t('release.marketplace.viewListings')}
      </a>
    </section>
  );
}
