import { redirect } from 'next/navigation';
import { t } from '@/lib/i18n';
import { getCurrentUser } from '@/modules/auth/current-user';
import { CollectionHighlights } from '@/modules/collection/components/collection-highlights';
import { MarketOverview } from '@/modules/collection/components/market-overview';
import { getCollectionHighlights, getCollectionMarketOverview } from '@/modules/collection/service';
import { ViewingAsBanner } from '@/modules/sharing/components/viewing-as-banner';
import { requestCollectionStatisticsRefresh } from '@/modules/sync/service';

export default async function StatisticsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/connexion');
  const [highlights, overview] = await Promise.all([
    getCollectionHighlights(user.activeCollectionOwnerId),
    getCollectionMarketOverview(user.activeCollectionOwnerId),
  ]);
  await requestCollectionStatisticsRefresh(user.activeCollectionOwnerId);
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
      <header>
        <p className="mb-2 text-xs uppercase tracking-widest text-muted">{t('stats.eyebrow')}</p>
        <h1 className="text-3xl font-semibold tracking-tight">{t('stats.title')}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          {t('stats.description')}
        </p>
      </header>
      {user.activeCollectionOwner ? (
        <ViewingAsBanner ownerUsername={user.activeCollectionOwner.username} />
      ) : null}
      <MarketOverview initial={overview} ownerId={user.activeCollectionOwnerId} />
      <CollectionHighlights
        key={user.activeCollectionOwnerId}
        initial={highlights}
        ownerUsername={user.activeCollectionOwner?.username ?? null}
      />
    </main>
  );
}
