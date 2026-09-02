import { redirect } from 'next/navigation';

import { t } from '@/lib/i18n';
import { getCurrentUser } from '@/modules/auth/current-user';
import { SignOutButton } from '@/modules/auth/components/sign-out-button';

/**
 * Paramètres (§7.1). Lot 1 : compte et déconnexion.
 * Synchronisation, confidentialité et suppression du compte arrivent aux lots 2 et 8.
 */
export default async function ParametresPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/connexion');
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">{t('settings.title')}</h1>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">{t('settings.account')}</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-foreground/60">{t('settings.account.discogs')}</dt>
          <dd>{user.discogsUsername}</dd>
          <dt className="text-foreground/60">{t('settings.account.role')}</dt>
          <dd>{user.role === 'admin' ? t('settings.role.admin') : t('settings.role.user')}</dd>
        </dl>
      </section>

      <section className="flex flex-col gap-3">
        <p className="text-sm text-foreground/60">{t('settings.signOut.explanation')}</p>
        <SignOutButton />
      </section>
    </main>
  );
}
