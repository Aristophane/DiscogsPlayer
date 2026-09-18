'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { t } from '@/lib/i18n';

/**
 * Indicateur visible dès qu'on consulte la collection d'un ami plutôt que la sienne
 * (Lot 7) : la fonctionnalité recouvre volontairement tous les mêmes écrans (§18.5,
 * décision produit), donc rien à l'écran ne dit sinon de quelle collection viennent les
 * albums, les tirages Aléatoire ou Radio.
 */
export function ViewingAsBanner({ ownerUsername }: { ownerUsername: string }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState(false);

  function backToOwn() {
    setError(false);
    startTransition(async () => {
      try {
        const response = await fetch('/api/collection-shares/active', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ownerId: null }),
        });
        if (response.ok) {
          // A friend's record may not belong to the user's own collection.
          // Leave its detail before refreshing the collection context.
          router.push('/collection');
          router.refresh();
          return;
        }
        setError(true);
      } catch {
        setError(true);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm">
      <span>{t('collection.viewingAs', { username: ownerUsername })}</span>
      <button
        type="button"
        onClick={backToOwn}
        disabled={busy}
        className="underline disabled:opacity-50"
      >
        {busy ? t('collection.viewingAs.switching') : t('collection.viewingAs.back')}
      </button>
      {error ? (
        <p role="alert" className="w-full text-sm">
          {t('sharing.error')}
        </p>
      ) : null}
    </div>
  );
}
