'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { t } from '@/lib/i18n';
import { VinylSpinner } from '@/lib/ui/vinyl-spinner';

const POLL_INTERVAL_MS = 1_500;
const POLL_MAX_ATTEMPTS = 10;

/**
 * Remplace la liste de pistes tant que l'import en arrière-plan n'a pas ramené le détail
 * d'une édition (Lot 6bis). La récupération prioritaire a déjà été programmée côté
 * serveur avant le premier rendu (`page.tsx`) — ce composant ne fait que sonder son
 * résultat et rafraîchir la page une fois les pistes disponibles.
 */
export function TracklistPending({ discogsReleaseId }: { discogsReleaseId: string }) {
  const router = useRouter();
  const [timedOut, setTimedOut] = useState(false);
  // Redémarre l'effet de sondage sans dépendre d'un changement de `discogsReleaseId` :
  // c'est ce que fait le bouton « Réessayer » après une expiration.
  const [generation, setGeneration] = useState(0);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    async function poll() {
      for (let attempt = 0; attempt <= POLL_MAX_ATTEMPTS; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        if (cancelledRef.current) {
          return;
        }

        const response = await fetch(`/api/releases/${discogsReleaseId}/status`, {
          cache: 'no-store',
        });

        if (cancelledRef.current) {
          return;
        }

        if (response.ok) {
          const data = (await response.json()) as { tracksReady: boolean };
          if (data.tracksReady) {
            // Le composant serveur relit alors `discogsTracks` et affiche la vraie liste
            // à la place de celui-ci.
            router.refresh();
            return;
          }
        }
      }

      if (!cancelledRef.current) {
        setTimedOut(true);
      }
    }

    void poll();

    return () => {
      cancelledRef.current = true;
    };
  }, [discogsReleaseId, generation, router]);

  if (timedOut) {
    return (
      <div className="flex flex-col items-start gap-2 py-4 text-sm text-muted">
        <p>{t('release.tracks.pending.timeout')}</p>
        <button
          type="button"
          onClick={() => {
            setTimedOut(false);
            setGeneration((value) => value + 1);
            router.refresh();
          }}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground"
        >
          {t('release.tracks.pending.retry')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 py-4 text-sm text-muted">
      <VinylSpinner size={28} />
      <span aria-live="polite">{t('release.tracks.pending')}</span>
    </div>
  );
}
