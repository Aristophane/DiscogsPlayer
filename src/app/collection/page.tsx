import { redirect } from 'next/navigation';

import { t } from '@/lib/i18n';
import { getCurrentUser } from '@/modules/auth/current-user';
import { countActiveInstances } from '@/modules/sync/service';

/**
 * Collection (§7.1). Lot 2 : le compte des albums importés prouve la chaîne complète.
 * La grille de pochettes, la recherche et les filtres arrivent au Lot 3.
 */
export default async function CollectionPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/connexion');
  }

  const count = await countActiveInstances(user.id);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">{t('collection.title')}</h1>
      <p className="text-sm text-foreground/70">
        {t('collection.signedInAs', { username: user.discogsUsername })}
      </p>
      <p className="text-lg">
        {count === 0 ? t('collection.empty') : t('collection.count', { count })}
      </p>
      <div className="flex gap-4 text-sm underline">
        <a href="/import">{t('collection.import')}</a>
        <a href="/parametres">{t('nav.settings')}</a>
      </div>
    </main>
  );
}
