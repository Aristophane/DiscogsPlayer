/**
 * Politique de cookie de session (SPECIFICATION.md §11) et vérification d'origine (§18.2).
 */
import type { NextResponse } from 'next/server';

import { getEnv } from '@/lib/env';

import { SESSION_COOKIE_NAME } from './sessions';

export function setSessionCookie(response: NextResponse, token: string, expiresAt: Date): void {
  const env = getEnv();

  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    // `Secure` en production uniquement : sinon le cookie serait rejeté en HTTP local.
    secure: env.NODE_ENV === 'production',
    // `Lax` laisse passer la redirection de retour de Discogs, contrairement à `Strict`.
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: getEnv().NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

/**
 * Défense CSRF des requêtes mutantes (§18.2) : l'origine doit être la nôtre.
 *
 * Une requête sans `Origin` ni `Referer` est refusée plutôt que tolérée — les navigateurs
 * modernes envoient `Origin` sur toute requête non-GET.
 */
export function hasTrustedOrigin(request: Request): boolean {
  const expected = new URL(getEnv().APP_BASE_URL).origin;
  const origin = request.headers.get('origin');

  if (origin) {
    return origin === expected;
  }

  const referer = request.headers.get('referer');
  if (!referer) {
    return false;
  }

  try {
    return new URL(referer).origin === expected;
  } catch {
    return false;
  }
}
