'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { t } from '@/lib/i18n';

export function RefreshStatistics() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-busy={pending}
      className="self-start text-sm underline underline-offset-4 disabled:opacity-50"
      onClick={() => startTransition(() => router.refresh())}
    >
      {pending ? t('collection.loading') : t('home.highlights.refresh')}
    </button>
  );
}
