'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { t, type MessageKey } from '@/lib/i18n';

/**
 * En-tête d'accès aux différentes parties de l'application (§7.2, étendu).
 *
 * La spécification ne prévoit qu'une barre basse mobile ; cet en-tête haut la complète
 * pour l'accès direct depuis n'importe quel écran, y compris la fiche album et l'import,
 * que la barre basse ne couvre pas. Radio est un lien actif depuis le Lot 6 (ADR-0006).
 *
 * Menu déroulant sous `sm:` (défaut Lot 6bis corrigé) : cinq liens sur une seule ligne
 * défilante avaient un défaut réel, pas seulement esthétique — mesuré à 320-390 px,
 * l'utilisateur devait faire défiler ~200 px pour atteindre « Radio » et
 * « Paramètres », qui restaient hors écran par défaut (un simple dégradé à droite ne
 * suffisait pas à le rendre visible). Un bouton ☰ ouvre désormais un panneau vertical
 * qui liste tout, sans défilement caché. À partir de `sm:` (640 px), les cinq liens
 * tiennent sur une ligne sans défilement (vérifié) : la nav horizontale d'origine
 * reste inchangée à cette taille.
 */
const LINKS: { href: string; labelKey: MessageKey }[] = [
  { href: '/', labelKey: 'nav.home' },
  { href: '/collection', labelKey: 'nav.collection' },
  { href: '/aleatoire', labelKey: 'nav.random' },
  { href: '/radio', labelKey: 'nav.radio' },
  { href: '/parametres', labelKey: 'nav.settings' },
];

export function AppHeader() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Filet de sécurité au-delà du `onClick` de chaque lien (qui referme déjà le panneau) :
  // couvre aussi la navigation par bouton précédent/suivant du navigateur. Ajustée
  // pendant le rendu plutôt que dans un effet — le correctif recommandé par React pour
  // « réinitialiser un état quand une prop change », sans re-rendu supplémentaire après
  // montage (react-hooks/set-state-in-effect).
  const [previousPathname, setPreviousPathname] = useState(pathname);
  if (pathname !== previousPathname) {
    setPreviousPathname(pathname);
    setMobileOpen(false);
  }

  // Pas d'en-tête sur l'écran de connexion : sa mise en page est volontairement seule (§6.1).
  if (pathname === '/connexion') {
    return null;
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="shrink-0 text-sm font-semibold tracking-tight sm:text-base">
          {t('app.name')}
        </Link>

        <nav aria-label={t('app.name')} className="hidden items-center gap-1 sm:flex">
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

        <button
          type="button"
          onClick={() => setMobileOpen((value) => !value)}
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav-panel"
          aria-label={mobileOpen ? t('nav.menu.close') : t('nav.menu.open')}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-base sm:hidden"
        >
          <span aria-hidden="true">{mobileOpen ? '✕' : '☰'}</span>
        </button>
      </div>

      {mobileOpen ? (
        <nav
          id="mobile-nav-panel"
          aria-label={t('app.name')}
          className="flex flex-col gap-1 border-t border-border px-4 py-2 sm:hidden"
        >
          {LINKS.map((link) => {
            const active = pathname === link.href;

            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                onClick={() => setMobileOpen(false)}
                className={`rounded-md px-2.5 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current ${
                  active ? 'bg-surface font-medium' : 'text-muted'
                }`}
              >
                {t(link.labelKey)}
              </Link>
            );
          })}
        </nav>
      ) : null}
    </header>
  );
}
