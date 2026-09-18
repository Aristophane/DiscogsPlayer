import type { MetadataRoute } from 'next';
import { t } from '@/lib/i18n';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: t('app.name'),
    short_name: t('app.name'),
    description: t('app.tagline'),
    lang: 'fr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0a0a0a',
    prefer_related_applications: false,
    icons: [
      { src: '/icons/dig-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/dig-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/dig-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
