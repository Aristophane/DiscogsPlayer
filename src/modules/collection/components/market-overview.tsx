import { t } from '@/lib/i18n';
import type { getCollectionMarketOverview } from '../service';
import { AlbumCover } from './album-cover';
import { coverProxyUrl } from '../cover';
import Link from 'next/link';

const euros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

export function MarketOverview({
  initial,
}: {
  initial: Awaited<ReturnType<typeof getCollectionMarketOverview>>;
  ownerId: string;
}) {
  return (
    <>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-y border-border py-6 sm:grid-cols-4">
        {(
          [
            ['stats.editions', initial.editions],
            ['stats.copies', initial.copies],
            ['stats.priced', initial.priced],
            [
              'stats.total',
              initial.total === null
                ? t('statistics.unavailable')
                : euros.format(Number(initial.total)),
            ],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs leading-relaxed text-muted">{t(label)}</dt>
            <dd className="mt-2 break-words text-xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="-mt-4 max-w-3xl text-xs leading-relaxed text-muted">{t('stats.priceHint')}</p>
      <section aria-labelledby="rare-editions">
        <h2 id="rare-editions" className="text-xl font-semibold tracking-tight">
          {t('stats.rareTitle')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('stats.rareHint')}</p>
        {initial.rarest.length ? (
          <ol className="mt-5 divide-y divide-border">
            {initial.rarest.map((item, index) => (
              <li key={item.discogsReleaseId} className="flex items-center gap-3 py-4">
                <span className="w-5 shrink-0 text-xs tabular-nums text-muted">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <Link
                  href={`/sorties/${item.discogsReleaseId}`}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4"
                >
                  <div className="relative aspect-square w-14 shrink-0 overflow-hidden rounded-sm bg-surface">
                    <AlbumCover
                      src={coverProxyUrl(item.coverUrl)}
                      title={item.title}
                      artists={item.artists}
                    />
                  </div>
                  <div className="min-w-0">
                    <h3 className="line-clamp-2 text-sm font-medium">{item.title}</h3>
                    <p className="truncate text-xs text-muted">{item.artists}</p>
                  </div>
                </Link>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums">
                    {item.communityHave?.toLocaleString('fr-FR')}
                  </p>
                  <p className="text-[11px] text-muted">{t('stats.collectors')}</p>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="py-6 text-sm text-muted">{t('stats.noRarity')}</p>
        )}
      </section>
    </>
  );
}
