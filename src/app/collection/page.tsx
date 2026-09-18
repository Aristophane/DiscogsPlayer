import Link from 'next/link';
import { redirect } from 'next/navigation';

import { t } from '@/lib/i18n';
import { getCurrentUser } from '@/modules/auth/current-user';
import { CollectionBrowser } from '@/modules/collection/components/collection-browser';
import { countCollection, listCollection, listFacets } from '@/modules/collection/service';
import { ViewingAsBanner } from '@/modules/sharing/components/viewing-as-banner';
import { parseSort } from '@/modules/collection/cursor';

/**
 * Collection (§7.1, §7.3).
 * La première page est rendue côté serveur (§20.1) ; l'interactivité prend le relais.
 */
export default async function CollectionPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/connexion');
  }

  const query = await searchParams;
  const sort = parseSort(typeof query.sort === 'string' ? query.sort : undefined);
  const [page, total, facets] = await Promise.all([
    listCollection(user.activeCollectionOwnerId, { sort }),
    countCollection(user.activeCollectionOwnerId),
    listFacets(user.activeCollectionOwnerId),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('collection.title')}</h1>
        {user.activeCollectionOwner ? null : (
          <Link
            href="/import"
            aria-label={t('collection.sync')}
            title={t('collection.sync')}
            className="flex size-11 items-center justify-center rounded-md border border-border text-muted transition-colors hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
          >
            <svg
              aria-hidden="true"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 7v5h-5M4 17v-5h5" />
              <path d="M6.1 6.1A8 8 0 0 1 19.6 10L20 12M4 12l.4 2A8 8 0 0 0 17.9 17.9" />
            </svg>
          </Link>
        )}
      </header>

      {user.activeCollectionOwner ? (
        <ViewingAsBanner ownerUsername={user.activeCollectionOwner.username} />
      ) : null}

      {total === 0 ? (
        <div className="flex flex-col items-start gap-3 py-16">
          <p className="text-lg">{t('collection.empty')}</p>
          {user.activeCollectionOwner ? null : (
            <Link
              href="/import"
              className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background"
            >
              {t('import.action.start')}
            </Link>
          )}
        </div>
      ) : (
        <CollectionBrowser
          key={`${user.activeCollectionOwnerId}:${sort}`}
          initialSort={sort}
          initialItems={page.items}
          initialCursor={page.nextCursor}
          total={total}
          facets={facets}
        />
      )}
    </main>
  );
}
