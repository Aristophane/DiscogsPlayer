'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { t } from '@/lib/i18n';

/**
 * Confirmation explicite d'une invitation (Lot 7) : un vrai clic, jamais le simple
 * chargement de la page — voir le commentaire de `/invitations/[token]/page.tsx`.
 */
export function AcceptInviteButton({ token }: { token: string }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'pending' | 'error'>('idle');

  async function accept() {
    setState('pending');

    try {
      const response = await fetch(`/api/collection-shares/invites/${token}/consume`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });

      if (!response.ok) {
        setState('error');
        return;
      }

      router.replace('/collection');
      router.refresh();
    } catch {
      setState('error');
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={accept}
        disabled={state === 'pending'}
        className="rounded-md bg-foreground px-5 py-3 font-medium text-background disabled:opacity-60"
      >
        {state === 'pending' ? t('invitation.accepting') : t('invitation.accept')}
      </button>
      {state === 'error' ? (
        <p role="alert" className="text-sm text-red-500">
          {t('invitation.acceptFailed')}
        </p>
      ) : null}
    </div>
  );
}
