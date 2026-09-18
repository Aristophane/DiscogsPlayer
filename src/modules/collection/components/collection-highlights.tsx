import Link from 'next/link';
import { t } from '@/lib/i18n';
import { CommunityStats } from '@/modules/catalog/components/community-stats';
import { getCollectionHighlights, type RankedRelease } from '../service';
import { coverProxyUrl } from '../cover';
import { AlbumCover } from './album-cover';
import { PersonalReleaseLink } from './personal-release-link';
import { RefreshStatistics } from './refresh-statistics';

const priceFormat = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

export async function CollectionHighlights({
  userId,
  viewingFriend,
}: {
  userId: string;
  viewingFriend: boolean;
}) {
  const highlights = await getCollectionHighlights(userId);
  return (
    <section
      aria-labelledby="collection-highlights"
      className="flex flex-col gap-6 border-t border-border pt-8"
    >
      <header>
        <h2 id="collection-highlights" className="text-xl font-semibold tracking-tight">
          {t('home.highlights.title')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('home.highlights.description')}</p>
        {viewingFriend ? (
          <p className="mt-2 text-sm text-muted">{t('home.highlights.own')}</p>
        ) : null}
      </header>
      {highlights.total === 0 ? (
        <div className="text-sm text-muted">
          <p>{t('home.highlights.empty')}</p>
          <Link href="/import" className="mt-2 inline-block underline">
            {t('collection.sync')}
          </Link>
        </div>
      ) : (
        <>
          <div className="grid gap-8 md:grid-cols-2">
            <Ranking kind="valuable" items={highlights.valuable} switchToOwn={viewingFriend} />
            <Ranking kind="wanted" items={highlights.wanted} switchToOwn={viewingFriend} />
          </div>
          {highlights.fetched < highlights.total ? (
            <p className="text-xs text-muted" role="status">
              {t('home.highlights.coverage', {
                fetched: highlights.fetched,
                total: highlights.total,
              })}
            </p>
          ) : null}
          <RefreshStatistics />
        </>
      )}
    </section>
  );
}

function Ranking({
  kind,
  items,
  switchToOwn,
}: {
  kind: 'wanted' | 'valuable';
  items: RankedRelease[];
  switchToOwn: boolean;
}) {
  const headingId = `top-${kind}`;
  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <h3 id={headingId} className="text-base font-semibold">
        {t(`home.highlights.${kind}`)}
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-muted">{t(`home.highlights.${kind}.hint`)}</p>
      {items.length === 0 ? (
        <p className="py-6 text-sm text-muted">
          {t(kind === 'wanted' ? 'home.highlights.noWanted' : 'home.highlights.noPrice')}
        </p>
      ) : (
        <ol className="mt-4 divide-y divide-border">
          {items.map((item, index) => (
            <li key={item.discogsReleaseId} className="flex items-start gap-3 py-4">
              <span
                aria-hidden="true"
                className="w-5 shrink-0 pt-1 text-sm tabular-nums text-muted"
              >
                {String(index + 1).padStart(2, '0')}
              </span>
              <div className="min-w-0 flex-1">
                <PersonalReleaseLink releaseId={item.discogsReleaseId} switchToOwn={switchToOwn}>
                  <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded bg-surface">
                    <AlbumCover
                      src={coverProxyUrl(item.coverUrl)}
                      title={item.title}
                      artists={item.artists}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-medium leading-snug">{item.title}</p>
                    <p className="line-clamp-1 text-xs text-muted">{item.artists}</p>
                    {kind === 'valuable' && item.lowestPriceEur !== null ? (
                      <p className="mt-1 text-sm font-semibold tabular-nums">
                        {t('home.highlights.price', {
                          price: priceFormat.format(Number(item.lowestPriceEur)),
                        })}
                      </p>
                    ) : null}
                  </div>
                </PersonalReleaseLink>
                <div className="mt-2">
                  <CommunityStats have={item.communityHave} want={item.communityWant} />
                </div>
                {item.statisticsFetchedAt ? (
                  <p className="mt-1 text-[11px] text-muted">
                    {t('statistics.updated', {
                      date: item.statisticsFetchedAt.toLocaleDateString('fr-FR', {
                        timeZone: 'Europe/Paris',
                      }),
                    })}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
