'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { t, type MessageKey } from '@/lib/i18n';
import { Logo } from '@/lib/ui/logo';

/**
 * En-tête d'accès aux différentes parties de l'application (§7.2, étendu).
 *
 * La spécification ne prévoit qu'une barre basse mobile ; cet en-tête haut la complète
 * pour l'accès direct depuis n'importe quel écran, y compris la fiche album et l'import,
 * que la barre basse ne couvre pas. Radio est un lien actif depuis le Lot 6 (ADR-0006).
 *
 * Menu déroulant sous `md:` : les six liens, dont Amis, doivent rester accessibles
 * sans défilement horizontal sur mobile et sur les écrans de 640 px.
 */
const LINKS: { href: string; labelKey: MessageKey }[] = [
  { href: '/', labelKey: 'nav.home' },
  { href: '/collection', labelKey: 'nav.collection' },
  { href: '/aleatoire', labelKey: 'nav.random' },
  { href: '/radio', labelKey: 'nav.radio' },
  { href: '/amis', labelKey: 'nav.friends' },
  { href: '/parametres', labelKey: 'nav.settings' },
];

export function AppHeader({ collectionSwitcher }: { collectionSwitcher: ReactNode }) {
  const pathname = usePathname();
  const headerRef = useRef<HTMLElement>(null);
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

  // Les contrôles flottants restent sous l'en-tête, y compris menu mobile déplié.
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const update = () => {
      document.documentElement.style.setProperty(
        '--app-header-height',
        `${header.getBoundingClientRect().height}px`,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--app-header-height');
    };
  }, [pathname]);

  // Pas d'en-tête sur l'écran de connexion : sa mise en page est volontairement seule (§6.1).
  if (pathname === '/connexion') {
    return null;
  }

  return (
    <header ref={headerRef} className="sticky top-0 z-30 border-b border-border bg-background">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 text-sm font-semibold tracking-tight sm:text-base"
        >
          <Logo size={22} />
          {t('app.name')}
        </Link>

        <nav aria-label={t('app.name')} className="hidden items-center gap-1 md:flex">
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
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-base md:hidden"
        >
          <span aria-hidden="true">{mobileOpen ? '✕' : '☰'}</span>
        </button>
      </div>

      {collectionSwitcher ? (
        <div className="border-t border-border bg-surface/40">
          <div className="mx-auto w-full max-w-6xl px-4 py-2 sm:px-6">{collectionSwitcher}</div>
        </div>
      ) : null}

      {mobileOpen ? (
        <nav
          id="mobile-nav-panel"
          aria-label={t('app.name')}
          className="flex flex-col gap-1 border-t border-border px-4 py-2 md:hidden"
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
