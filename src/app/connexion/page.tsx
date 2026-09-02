import { redirect } from 'next/navigation';

import { t } from '@/lib/i18n';
import { getCurrentUser } from '@/modules/auth/current-user';

/**
 * Connexion Discogs et explication des données utilisées (§7.1 `/connexion`, §19.3).
 * Composant serveur : aucune interactivité n'est nécessaire, le bouton est un lien.
 */
export default async function ConnexionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (user) {
    redirect('/collection');
  }

  const { erreur } = await searchParams;
  const errorKey =
    erreur === 'annulee'
      ? 'signin.error.cancelled'
      : erreur === 'expiree'
        ? 'signin.error.expired'
        : null;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-8 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">{t('signin.title')}</h1>

      {errorKey ? (
        <p
          role="alert"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm"
        >
          {t(errorKey)}
        </p>
      ) : null}

      <a
        href="/api/auth/discogs/start"
        className="rounded-md bg-foreground px-5 py-3 text-center font-medium text-background"
      >
        {t('signin.action')}
      </a>

      <section className="flex flex-col gap-3 text-sm text-muted">
        <h2 className="font-medium text-foreground">{t('signin.dataTitle')}</h2>
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>{t('signin.data.identity')}</li>
          <li>{t('signin.data.collection')}</li>
          <li>{t('signin.data.events')}</li>
          <li>{t('signin.data.contributions')}</li>
          <li>{t('signin.data.deletion')}</li>
        </ul>
      </section>
    </main>
  );
}
