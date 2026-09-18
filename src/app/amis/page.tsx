import { redirect } from 'next/navigation';

import { t } from '@/lib/i18n';
import { getCurrentUser } from '@/modules/auth/current-user';
import { SharingManager } from '@/modules/sharing/components/sharing-manager';

export default async function AmisPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/connexion');
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">{t('nav.friends')}</h1>
      <p className="text-sm text-muted">{t('sharing.explanation')}</p>
      <SharingManager activeCollectionOwnerId={user.activeCollectionOwnerId} />
    </main>
  );
}
