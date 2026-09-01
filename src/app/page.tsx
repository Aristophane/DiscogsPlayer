import { t } from '@/lib/i18n';

/**
 * Page d'accueil publique (§7.1 `/`). Lot 0 : marqueur de fondation.
 * La redirection vers `/collection` pour un utilisateur connecté arrive au Lot 1.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">{t('app.name')}</h1>
      <p className="text-lg text-foreground/80">{t('app.tagline')}</p>
      <p className="text-sm text-foreground/60">{t('home.intro')}</p>
      <p className="text-xs text-foreground/40">{t('home.status.bootstrap')}</p>
    </main>
  );
}
