import { t } from '@/lib/i18n';

/** Page 404 globale (§20.2 : un état d'erreur doit rester compréhensible et navigable). */
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">{t('error.notFound')}</h1>
      <a href="/collection" className="text-sm underline">
        {t('release.backToCollection')}
      </a>
    </main>
  );
}
