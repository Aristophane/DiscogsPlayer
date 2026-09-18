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
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex w-full min-w-0 items-center gap-3 sm:w-auto">
          <label
            htmlFor="active-collection"
            className="max-w-24 shrink-0 text-xs font-medium text-muted sm:max-w-none sm:text-sm"
          >
            {t('collection.switcher.label')}
          </label>
          <select
            id="active-collection"
            value={activeOwnerId}
            onChange={(event) => switchCollection(event.target.value)}
            disabled={pending}
            aria-busy={pending}
            className="min-h-11 w-full min-w-0 flex-1 truncate rounded-md border border-border bg-background px-3 py-2 text-base font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current disabled:opacity-50 sm:w-80"
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
          <p role="status" className="py-3 text-sm text-muted">
            {t('sharing.received.switching')}
          </p>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-500">
          {t('sharing.error')}
        </p>
      ) : null}
    </div>
  );
}
