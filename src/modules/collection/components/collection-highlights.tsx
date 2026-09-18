'use client';

import Link from 'next/link';
import { useState } from 'react';
import { t } from '@/lib/i18n';
import { CommunityStats } from '@/modules/catalog/components/community-stats';
import type { RankedRelease } from '../service';
import type { Highlights } from '../home-contracts';
import { coverProxyUrl } from '../cover';
import { AlbumCover } from './album-cover';
import { PersonalReleaseLink } from './personal-release-link';
import { RefreshStatistics } from './refresh-statistics';

const priceFormat = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

export function CollectionHighlights({
  initial,
  ownerUsername,
}: {
  initial: Highlights;
  ownerUsername: string | null;
}) {
  const [highlights, setHighlights] = useState(initial);
  return (
    <section
      aria-labelledby="collection-highlights"
      className="flex flex-col gap-6 border-t border-border pt-8"
    >
      <header>
        <h2 id="collection-highlights" className="text-xl font-semibold tracking-tight">
          {ownerUsername
            ? t('home.highlights.friendTitle', { username: ownerUsername })
            : t('home.highlights.title')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('home.highlights.description')}</p>
      </header>
      {highlights.total === 0 ? (
        <div className="text-sm text-muted">
          <p>{t(ownerUsername ? 'home.highlights.friendEmpty' : 'home.highlights.empty')}</p>
          {ownerUsername ? null : (
            <Link href="/import" className="mt-2 inline-block underline">
              {t('collection.sync')}
            </Link>
          )}
        </div>
      ) : (
        <>
          <RefreshStatistics highlights={highlights} onUpdate={setHighlights} />
          <div className="grid gap-10">
            <Ranking kind="valuable" items={highlights.valuable} />
            <Ranking kind="wanted" items={highlights.wanted} />
          </div>
        </>
      )}
    </section>
  );
}

function Ranking({ kind, items }: { kind: 'wanted' | 'valuable'; items: RankedRelease[] }) {
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
        <ol className="mt-5 grid grid-cols-2 items-start gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
          {items.map((item, index) => (
            <li key={item.discogsReleaseId} className="min-w-0">
              <div className="min-w-0 flex-1">
                <PersonalReleaseLink
                  releaseId={item.discogsReleaseId}
                  switchToOwn={false}
                  layout="cover"
                >
                  <div className="relative aspect-square w-full overflow-hidden rounded-md bg-surface">
                    <AlbumCover
                      src={coverProxyUrl(item.coverUrl)}
                      title={item.title}
                      artists={item.artists}
                      className="h-full w-full object-cover"
                    />
                    <span
                      aria-hidden="true"
                      className="absolute left-2 top-2 rounded bg-background px-2 py-1 text-xs font-semibold tabular-nums"
                    >
                      {String(index + 1).padStart(2, '0')}
                    </span>
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
