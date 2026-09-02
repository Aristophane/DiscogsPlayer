'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { t } from '@/lib/i18n';

/**
 * Déconnexion (§17.1). Le POST porte l'en-tête `Origin` du navigateur, que la route
 * vérifie (§18.2) ; un lien GET ne conviendrait pas pour une requête mutante.
 */
export function SignOutButton() {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'pending' | 'error'>('idle');

  async function signOut() {
    setState('pending');

    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });

      if (!response.ok) {
        setState('error');
        return;
      }

      // `refresh()` vide le cache du routeur : sans lui, les pages serveur déjà rendues
      // resteraient visibles alors que la session est révoquée.
      router.replace('/connexion');
      router.refresh();
    } catch {
      setState('error');
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={signOut}
        disabled={state === 'pending'}
        className="rounded-md border border-border px-4 py-2 text-sm font-medium disabled:opacity-60"
      >
        {state === 'pending' ? t('settings.signOut.pending') : t('settings.signOut')}
      </button>
      {state === 'error' ? (
        <p role="alert" className="text-sm text-red-500">
          {t('settings.signOut.failed')}
        </p>
      ) : null}
    </div>
  );
}
