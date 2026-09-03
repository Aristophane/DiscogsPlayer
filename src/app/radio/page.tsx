import { redirect } from 'next/navigation';

import { t } from '@/lib/i18n';
import { getCurrentUser } from '@/modules/auth/current-user';
import { listFacets } from '@/modules/collection/service';
import { RadioLauncher } from '@/modules/radio/components/radio-launcher';
import { ViewingAsBanner } from '@/modules/sharing/components/viewing-as-banner';

/** Radio (§7.1 étendu, ADR-0006) : lecture continue, filtrable par genre/style. */
export default async function RadioPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/connexion');
  }

  const facets = await listFacets(user.activeCollectionOwnerId);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('radio.title')}</h1>
        <a href="/collection" className="text-sm underline">
          {t('nav.collection')}
        </a>
      </header>

      <p className="text-sm text-muted">{t('radio.explanation')}</p>

      {user.activeCollectionOwner ? (
        <ViewingAsBanner ownerUsername={user.activeCollectionOwner.username} />
      ) : null}

      <RadioLauncher facets={facets} />
    </main>
  );
}
