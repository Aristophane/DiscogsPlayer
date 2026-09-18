import Link from 'next/link';
import { redirect } from 'next/navigation';
import { t } from '@/lib/i18n';
import { getCurrentUser } from '@/modules/auth/current-user';
import { getCrateCollection } from '@/modules/collection/crate-service';
import { CrateBrowser } from '@/modules/collection/components/crate-browser';
import { ViewingAsBanner } from '@/modules/sharing/components/viewing-as-banner';

export default async function CratesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/connexion');
  const records = await getCrateCollection(user.activeCollectionOwnerId);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-9">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('crate.title')}</h1>
          <p className="mt-2 text-sm text-muted">{t('crate.intro')}</p>
        </div>
        <Link
          href="/collection"
          className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
        >
          {t('crate.collection')}
        </Link>
      </div>
      {user.activeCollectionOwner ? (
        <ViewingAsBanner ownerUsername={user.activeCollectionOwner.username} />
      ) : null}
      {records.length ? (
        <CrateBrowser key={user.activeCollectionOwnerId} records={records} />
      ) : (
        <div className="flex flex-col items-start gap-3 border-t border-border py-16">
          <h2 className="text-xl font-medium">{t('crate.empty')}</h2>
          <p className="text-sm text-muted">
            {t(user.activeCollectionOwner ? 'crate.emptyShared' : 'crate.emptyHint')}
          </p>
          {user.activeCollectionOwner ? null : (
            <Link
              href="/import"
              className="mt-2 rounded-md bg-foreground px-4 py-3 text-sm text-background"
            >
              {t('import.action.start')}
            </Link>
          )}
        </div>
      )}
    </main>
  );
}
