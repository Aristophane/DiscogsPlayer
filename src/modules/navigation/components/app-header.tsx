'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { t, type MessageKey } from '@/lib/i18n';

/**
 * En-tête d'accès aux différentes parties de l'application (§7.2, étendu).
 *
 * La spécification ne prévoit qu'une barre basse mobile ; cet en-tête haut la complète
 * pour l'accès direct depuis n'importe quel écran, y compris la fiche album et l'import,
 * que la barre basse ne couvre pas. Radio reste visible mais désactivée tant que le
 * Lot 6 n'a pas de mode d'écoute continue propre (ADR-0006).
 *
 * Sur petit mobile, le nom complet de l'application et quatre liens ne tiennent pas sur
 * une seule ligne sans déborder (vérifié à 390 px) : la nav défile horizontalement plutôt
 * que de passer à la ligne, qui écrasait le contenu suivant.
 */
const LINKS: { href: string; labelKey: MessageKey }[] = [
  { href: '/', labelKey: 'nav.home' },
  { href: '/collection', labelKey: 'nav.collection' },
  { href: '/aleatoire', labelKey: 'nav.random' },
  { href: '/parametres', labelKey: 'nav.settings' },
];

export function AppHeader() {
  const pathname = usePathname();

  // Pas d'en-tête sur l'écran de connexion : sa mise en page est volontairement seule (§6.1).
  if (pathname === '/connexion') {
    return null;
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="shrink-0 text-sm font-semibold tracking-tight sm:text-base">
          {t('app.name')}
        </Link>

        {/* `relative`/dégradé : sur petit mobile, les quatre liens ne tiennent jamais sur
            une ligne (vérifié à 390 px) ; le fondu à droite indique qu'on peut défiler,
            sans quoi "Paramètres" coupé net pouvait passer pour une erreur de mise en page. */}
        <div className="relative min-w-0 flex-1">
          <nav
            aria-label={t('app.name')}
            className="flex items-center gap-1 overflow-x-auto whitespace-nowrap"
          >
            {LINKS.map((link) => {
              const active = pathname === link.href;

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? 'page' : undefined}
                  className={`shrink-0 rounded-md px-2.5 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current sm:px-3 ${
                    active ? 'bg-surface font-medium' : 'text-muted'
                  }`}
                >
                  {t(link.labelKey)}
                </Link>
              );
            })}
          </nav>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-background to-transparent"
          />
        </div>
      </div>
    </header>
  );
}
