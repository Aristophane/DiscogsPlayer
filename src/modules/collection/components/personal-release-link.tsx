'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { t } from '@/lib/i18n';

/** Vérifie le partage côté serveur avant de changer de collection et d'ouvrir un disque. */
export function PersonalReleaseLink({
  releaseId,
  switchToOwn,
  children,
  ownerId = null,
  layout = 'row',
}: {
  releaseId: string;
  switchToOwn: boolean;
  children: ReactNode;
  ownerId?: string | null;
  layout?: 'row' | 'cover';
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);
  const href = `/sorties/${releaseId}`;
  const className = `flex min-w-0 flex-1 gap-3 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-current ${layout === 'cover' ? 'flex-col items-stretch' : 'items-center'}`;
  if (!switchToOwn)
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  return (
    <div className="min-w-0 flex-1">
      <button
        type="button"
        className={`${className} w-full disabled:opacity-50`}
        disabled={pending}
        aria-busy={pending}
        onClick={() => {
          setError(false);
          startTransition(async () => {
            try {
              const response = await fetch('/api/collection-shares/active', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ ownerId }),
              });
              if (!response.ok) {
                setError(true);
                return;
              }
              router.push(href);
              router.refresh();
            } catch {
              setError(true);
            }
          });
        }}
      >
        {children}
      </button>
      {error ? (
        <p role="alert" className="mt-1 text-xs text-red-500">
          {t('sharing.error')}
        </p>
      ) : null}
    </div>
  );
}
