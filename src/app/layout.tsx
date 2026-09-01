import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { PersistentPlayerHost } from '@/modules/playback/components/persistent-player-host';
import { DEFAULT_LOCALE, t } from '@/lib/i18n';

import './globals.css';

export const metadata: Metadata = {
  title: t('app.name'),
  description: t('app.tagline'),
};

export const viewport: Viewport = {
  // Mobile-first (§7.2) : la barre d'adresse ne doit pas masquer le lecteur.
  themeColor: '#0a0a0a',
  width: 'device-width',
  initialScale: 1,
};

// Typage explicite plutôt que le global `LayoutProps` généré par Next : `npm run typecheck`
// doit fonctionner sur un dépôt fraîchement cloné, avant tout `next build`.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={DEFAULT_LOCALE} className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-background text-foreground">
        {children}
        {/*
          Le lecteur est monté ici, au-dessus des routes, et non dans /lecture :
          un <iframe> YouTube ou Spotify est détruit à chaque navigation s'il vit
          dans un segment de route (SPEC-GAPS G-17).
        */}
        <PersistentPlayerHost />
      </body>
    </html>
  );
}
