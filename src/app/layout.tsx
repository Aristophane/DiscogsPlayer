import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { DEFAULT_LOCALE, t } from '@/lib/i18n';
import { AppHeader } from '@/modules/navigation/components/app-header';
import { PlayerBar } from '@/modules/playback/components/player-bar';
import { PlaybackProvider } from '@/modules/playback/playback-context';

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
        {/*
          Le contexte de lecture et sa barre englobent toutes les routes, au-dessus des
          pages : un <iframe> YouTube ou Spotify est détruit à chaque navigation s'il vit
          dans un segment de route (SPEC-GAPS G-17).
        */}
        <PlaybackProvider>
          <AppHeader />
          {/*
            L'espace réservé suit la hauteur réelle de la barre de lecture (variable CSS
            posée par `PlayerBar`), pas une valeur figée : une vidéo YouTube affichée fait
            grossir la barre bien au-delà d'un padding fixe, ce qui recouvrait des boutons
            en bas de page (défaut réel constaté en test e2e sur mobile).
          */}
          <div className="flex flex-1 flex-col pb-[var(--player-bar-height,0px)]">{children}</div>
          <PlayerBar />
        </PlaybackProvider>
      </body>
    </html>
  );
}
