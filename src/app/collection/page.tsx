import { redirect } from 'next/navigation';

import { t } from '@/lib/i18n';
import { getCurrentUser } from '@/modules/auth/current-user';
import { CollectionBrowser } from '@/modules/collection/components/collection-browser';
import { countCollection, listCollection, listFacets } from '@/modules/collection/service';
import { ViewingAsBanner } from '@/modules/sharing/components/viewing-as-banner';

/**
 * Collection (§7.1, §7.3).
 * La première page est rendue côté serveur (§20.1) ; l'interactivité prend le relais.
 */
export default async function CollectionPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/connexion');
  }

  const [page, total, facets] = await Promise.all([
    listCollection(user.activeCollectionOwnerId),
    countCollection(user.activeCollectionOwnerId),
    listFacets(user.activeCollectionOwnerId),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('collection.title')}</h1>
        <nav className="flex gap-4 text-sm underline">
          {/* L'import et sa progression concernent son propre compte : sans objet en
              consultant la collection d'un ami (§18.5, décision produit du Lot 7). */}
          {user.activeCollectionOwner ? null : <a href="/import">{t('collection.import')}</a>}
          <a href="/parametres">{t('nav.settings')}</a>
        </nav>
      </header>

      {user.activeCollectionOwner ? (
        <ViewingAsBanner ownerUsername={user.activeCollectionOwner.username} />
      ) : null}

      {total === 0 ? (
        <div className="flex flex-col items-start gap-3 py-16">
          <p className="text-lg">{t('collection.empty')}</p>
          {user.activeCollectionOwner ? null : (
            <a
              href="/import"
              className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background"
            >
              {t('import.action.start')}
            </a>
          )}
        </div>
      ) : (
        <CollectionBrowser
          initialItems={page.items}
          initialCursor={page.nextCursor}
          total={total}
          facets={facets}
        />
      )}
    </main>
  );
}
