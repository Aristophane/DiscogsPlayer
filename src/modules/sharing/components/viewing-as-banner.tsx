'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { t } from '@/lib/i18n';

/**
 * Indicateur visible dès qu'on consulte la collection d'un ami plutôt que la sienne
 * (Lot 7) : la fonctionnalité recouvre volontairement tous les mêmes écrans (§18.5,
 * décision produit), donc rien à l'écran ne dit sinon de quelle collection viennent les
 * albums, les tirages Aléatoire ou Radio.
 */
export function ViewingAsBanner({ ownerUsername }: { ownerUsername: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function backToOwn() {
    setBusy(true);
    try {
      const response = await fetch('/api/collection-shares/active', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ownerId: null }),
      });
      if (response.ok) {
        router.refresh();
        return;
      }
    } catch {
      // Repli silencieux : le bandeau reste affiché, l'utilisateur peut réessayer.
    }
    setBusy(false);
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
    </div>
  );
}
