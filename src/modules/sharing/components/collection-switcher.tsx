'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { t } from '@/lib/i18n';

export function CollectionSwitcher({
  ownId,
  activeOwnerId,
  friends,
}: {
  ownId: string;
  activeOwnerId: string;
  friends: { ownerId: string; ownerUsername: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  function switchCollection(ownerId: string) {
    if (ownerId === activeOwnerId) return;
    setError(false);
    startTransition(async () => {
      try {
        const response = await fetch('/api/collection-shares/active', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ownerId: ownerId === ownId ? null : ownerId }),
        });
        if (!response.ok) {
          setError(true);
          return;
        }
        if (pathname.startsWith('/sorties/')) router.push('/collection');
        router.refresh();
      } catch {
        setError(true);
      }
    });
  }

  return (
    <div className="relative min-w-0">
      <div className="min-w-0">
        <div className="min-w-0">
          <label htmlFor="active-collection" className="sr-only">
            {t('collection.switcher.label')}
          </label>
          <select
            id="active-collection"
            value={activeOwnerId}
            onChange={(event) => switchCollection(event.target.value)}
            disabled={pending}
            aria-busy={pending}
            className="min-h-11 w-full min-w-0 truncate rounded-md border border-border bg-background px-2 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current disabled:opacity-50 sm:px-3"
          >
            <option value={ownId}>{t('collection.switcher.own')}</option>
            {friends.length > 0 ? (
              <optgroup label={t('collection.switcher.friends')}>
                {friends.map((friend) => (
                  <option key={friend.ownerId} value={friend.ownerId}>
                    {friend.ownerUsername}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </div>
        {pending ? (
          <p role="status" className="sr-only">
            {t('sharing.received.switching')}
          </p>
        ) : null}
      </div>
      {error ? (
        <p
          role="alert"
          className="absolute top-full left-0 mt-2 w-full rounded-md border border-border bg-background p-2 text-xs text-red-600 dark:text-red-400"
        >
          {t('sharing.error')}
        </p>
      ) : null}
    </div>
  );
}
