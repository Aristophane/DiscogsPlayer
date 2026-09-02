'use client';

import { t } from '@/lib/i18n';

/** Écran d'erreur global. Aucun détail technique n'est montré à l'utilisateur (§17.8). */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">{t('error.generic')}</h1>
      <button
        type="button"
        onClick={reset}
        className="self-start rounded-md border border-border px-4 py-2 text-sm"
      >
        {t('import.action.retry')}
      </button>
    </main>
  );
}
