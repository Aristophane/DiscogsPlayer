'use client';

import Image from 'next/image';
import { useState } from 'react';
import { t } from '@/lib/i18n';
import { useInstall } from './install-provider';

type Guide = 'ios' | 'mac' | 'browser' | 'insecure';

function installationGuide(): Guide {
  if (!window.isSecureContext) return 'insecure';
  const ua = navigator.userAgent;
  if (
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
    return 'ios';
  if (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua)) return 'mac';
  return 'browser';
}

export function InstallApp() {
  const { prompt, clearPrompt, installed } = useInstall();
  const [pending, setPending] = useState(false);
  const [guide, setGuide] = useState<Guide | null>(null);
  const [outcome, setOutcome] = useState<'accepted' | 'dismissed' | 'error' | null>(null);

  async function install() {
    setOutcome(null);
    if (!prompt) {
      setGuide(installationGuide());
      return;
    }
    const event = prompt;
    clearPrompt();
    setGuide(null);
    setPending(true);
    try {
      await event.prompt();
      setOutcome((await event.userChoice).outcome);
    } catch {
      setOutcome('error');
      setGuide(installationGuide());
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="install-app"
      className="flex flex-col gap-3 border-t border-border pt-6"
    >
      <div className="flex items-center gap-4">
        <Image
          src="/icons/dig-192.png"
          alt=""
          width={64}
          height={64}
          className="rounded-xl border border-border"
        />
        <div>
          <h2 id="install-app" className="text-lg font-medium">
            {t('install.title')}
          </h2>
          <p className="mt-1 text-sm text-muted">{t('install.description')}</p>
        </div>
      </div>
      {installed ? (
        <p role="status" className="text-sm">
          {t('install.installed')}
        </p>
      ) : (
        <>
          <button
            type="button"
            disabled={pending}
            aria-busy={pending}
            onClick={() => void install()}
            className="min-h-11 self-start rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
          >
            {pending ? t('install.pending') : t('install.action')}
          </button>
          {outcome ? (
            <p role="status" className="text-sm text-muted">
              {t(`install.${outcome}`)}
            </p>
          ) : null}
          {guide ? (
            <p role="status" className="text-sm leading-relaxed text-muted">
              {t(`install.guide.${guide}`)}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
