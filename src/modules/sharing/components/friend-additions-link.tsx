'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { t } from '@/lib/i18n';

export function FriendAdditionsLink({
  ownerId,
  username,
  active,
}: {
  ownerId: string;
  username: string;
  active: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);
  const href = '/collection?sort=date_added_desc';
  const label = t('home.activity.moreLabel', { username });
  const className =
    'inline-flex min-h-11 items-center text-sm underline underline-offset-4 disabled:opacity-50';

  if (active)
    return (
      <Link href={href} aria-label={label} className={className}>
        {t('home.activity.more')}
      </Link>
    );

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        aria-busy={pending}
        aria-label={label}
        className={className}
        onClick={() => {
          setError(false);
          startTransition(async () => {
            try {
              const response = await fetch('/api/collection-shares/active', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ ownerId }),
              });
              if (!response.ok) throw new Error('collection-switch');
              router.push(href);
              router.refresh();
            } catch {
              setError(true);
            }
          });
        }}
      >
        {pending ? t('sharing.received.switching') : t('home.activity.more')}
      </button>
      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {t('sharing.error')}
        </p>
      ) : null}
    </div>
  );
}
