'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { t } from '@/lib/i18n';

/** Un top reste personnel même pendant la consultation de la collection d'un ami. */
export function PersonalReleaseLink({
  releaseId,
  switchToOwn,
  children,
}: {
  releaseId: string;
  switchToOwn: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);
  const href = `/sorties/${releaseId}`;
  const className =
    'flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-current';
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
                body: JSON.stringify({ ownerId: null }),
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
