import { redirect } from 'next/navigation';

import { t } from '@/lib/i18n';
import { getCurrentUser } from '@/modules/auth/current-user';
import { ImportProgress } from '@/modules/sync/components/import-progress';
import { getCurrentRun, getLastCompletedRun } from '@/modules/sync/service';

/**
 * Progression de l'import initial (§7.1 `/import`).
 * Le premier rendu est fait côté serveur : l'utilisateur voit l'état sans attendre le
 * premier sondage client.
 */
export default async function ImportPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/connexion');
  }

  const run = (await getCurrentRun(user.id)) ?? (await getLastCompletedRun(user.id));

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">{t('import.title')}</h1>
      <ImportProgress
        initialRun={
          run
            ? {
                id: run.id,
                status: run.status,
                pagesTotal: run.pagesTotal,
                pagesProcessed: run.pagesProcessed,
                itemsSeen: run.itemsSeen,
              }
            : null
        }
      />
    </main>
  );
}
