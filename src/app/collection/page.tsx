import { redirect } from 'next/navigation';

import { t } from '@/lib/i18n';
import { getCurrentUser } from '@/modules/auth/current-user';

/**
 * Collection (§7.1). Lot 1 : la page prouve seulement que la session fonctionne.
 * La grille de pochettes, la recherche et les filtres arrivent au Lot 3.
 */
export default async function CollectionPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/connexion');
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">{t('collection.title')}</h1>
      <p className="text-sm text-foreground/70">
        {t('collection.signedInAs', { username: user.discogsUsername })}
      </p>
      <p className="text-sm text-foreground/50">{t('collection.pending')}</p>
      <a href="/parametres" className="text-sm underline">
        {t('nav.settings')}
      </a>
    </main>
  );
}
