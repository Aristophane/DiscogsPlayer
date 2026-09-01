/**
 * Fondation i18n (SPECIFICATION.md §29 « français initial et architecture i18n »,
 * SPEC-GAPS G-12).
 *
 * Aucune chaîne d'interface ne doit être écrite en dur dans un composant, même en v0 :
 * extraire après coup coûte beaucoup plus cher que de commencer ainsi. Le routage
 * multilingue reste une décision v1 — ici, seul le catalogue existe.
 */
import { fr } from './fr';

export const DEFAULT_LOCALE = 'fr' as const;
export const SUPPORTED_LOCALES = [DEFAULT_LOCALE] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];
export type MessageKey = keyof typeof fr;

const catalogs: Record<Locale, Record<MessageKey, string>> = { fr };

/**
 * Traduit une clé. Les valeurs interpolées sont notées `{nom}` dans le catalogue.
 * Une clé absente retourne la clé elle-même : visible en test, jamais un écran vide.
 */
export function t(
  key: MessageKey,
  values?: Record<string, string | number>,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const template = catalogs[locale][key] ?? key;

  if (!values) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = values[name];
    return value === undefined ? match : String(value);
  });
}
