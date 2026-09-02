import { redirect } from 'next/navigation';

import { t } from '@/lib/i18n';
import { getCurrentUser } from '@/modules/auth/current-user';
import { listFacets } from '@/modules/collection/service';
import { RandomDrawer } from '@/modules/random/components/random-drawer';
import { countEligible } from '@/modules/random/service';

/** Mode Aléatoire (§7.1 `/aleatoire`, §8.4). */
export default async function AleatoirePage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/connexion');
  }

  const [facets, eligible] = await Promise.all([listFacets(user.id), countEligible(user.id, {})]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('random.title')}</h1>
        <a href="/collection" className="text-sm underline">
          {t('nav.collection')}
        </a>
      </header>

      <RandomDrawer facets={facets} initialEligible={eligible} />
    </main>
  );
}
