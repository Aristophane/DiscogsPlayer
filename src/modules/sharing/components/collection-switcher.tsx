'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
        router.refresh();
      } catch {
        setError(true);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="flex w-full min-w-0 flex-col gap-1 sm:w-72">
          <label htmlFor="active-collection" className="text-xs text-muted">
            {t('collection.switcher.label')}
          </label>
          <select
            id="active-collection"
            value={activeOwnerId}
            onChange={(event) => switchCollection(event.target.value)}
            disabled={pending}
            aria-busy={pending}
            className="min-h-11 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current disabled:opacity-50"
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
        <Link
          href="/amis"
          className="flex min-h-11 items-center text-sm text-muted underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
        >
          {friends.length > 0 ? t('collection.switcher.manage') : t('collection.switcher.discover')}
        </Link>
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
