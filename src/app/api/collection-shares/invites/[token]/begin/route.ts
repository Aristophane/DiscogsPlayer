/**
 * Point d'entrée d'un lien d'invitation pour un visiteur non connecté (Lot 7).
 *
 * Ne consomme rien : pose seulement un cookie qui survivra au détour par Discogs, puis
 * redirige vers la connexion. C'est `/invitations/[token]` qui confirmera l'invitation
 * après authentification — jamais cette route, dont l'appel doit rester sans effet
 * observable sur le jeton lui-même (un aperçu de messagerie pourrait la déclencher).
 */
import { NextResponse } from 'next/server';

import { getEnv } from '@/lib/env';
import { setPendingInviteCookie } from '@/modules/auth/cookies';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await context.params;
  const env = getEnv();

  const response = NextResponse.redirect(new URL('/api/auth/discogs/start', env.APP_BASE_URL), {
    status: 302,
  });
  setPendingInviteCookie(response, token);
  response.headers.set('cache-control', 'no-store');

  return response;
}
