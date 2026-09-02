'use client';

import { useState } from 'react';

import { t } from '@/lib/i18n';

type Preference = 'unset' | 'yes' | 'no';

async function save(value: 'yes' | 'no'): Promise<boolean> {
  const response = await fetch('/api/me/spotify-preference', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  return response.ok;
}

/**
 * Bascule Spotify (ADR-0006) — utilisée à deux endroits : la bannière d'onboarding sur
 * l'accueil et le réglage permanent des paramètres. Facultative, rejouable, aucun OAuth :
 * un simple indicateur qui conditionne l'apparition du repli de recherche Spotify.
 */
export function SpotifyPreferenceToggle({
  initial,
  variant,
}: {
  initial: Preference;
  variant: 'onboarding' | 'settings';
}) {
  const [value, setValue] = useState<Preference>(initial);
  const [busy, setBusy] = useState(false);

  async function choose(next: 'yes' | 'no') {
    setBusy(true);
    const ok = await save(next);
    setBusy(false);
    if (ok) {
      setValue(next);
    }
  }

  if (variant === 'onboarding') {
    if (value !== 'unset') {
      return null;
    }

    return (
      <section className="flex flex-col gap-3 rounded-md border border-border p-4">
        <h2 className="font-medium">{t('onboarding.spotify.title')}</h2>
        <p className="text-sm text-muted">{t('onboarding.spotify.explanation')}</p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => choose('yes')}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
          >
            {t('onboarding.spotify.yes')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => choose('no')}
            className="rounded-md border border-border px-4 py-2 text-sm disabled:opacity-50"
          >
            {t('onboarding.spotify.no')}
          </button>
        </div>
      </section>
    );
  }

  const statusKey =
    value === 'yes'
      ? 'settings.spotify.status.yes'
      : value === 'no'
        ? 'settings.spotify.status.no'
        : 'settings.spotify.status.unset';

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-medium">{t('settings.spotify.title')}</h2>
      <p className="text-sm text-muted">{t(statusKey)}</p>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy || value === 'yes'}
          onClick={() => choose('yes')}
          className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {t('onboarding.spotify.yes')}
        </button>
        <button
          type="button"
          disabled={busy || value === 'no'}
          onClick={() => choose('no')}
          className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {t('onboarding.spotify.no')}
        </button>
      </div>
    </section>
  );
}
