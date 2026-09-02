/**
 * Déconnexion (§17.1, AUTH-006).
 *
 * La session locale est révoquée ; la collection et les données du compte restent
 * intactes. Requête mutante : elle exige une origine de confiance (§18.2).
 */
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { ApiError } from '@/lib/api-error';
import { moduleLogger, requestId } from '@/lib/logger';
import { clearSessionCookie, hasTrustedOrigin } from '@/modules/auth/cookies';
import { SESSION_COOKIE_NAME, revokeSession } from '@/modules/auth/sessions';

export const dynamic = 'force-dynamic';

const log = moduleLogger('auth');

export async function POST(request: Request): Promise<NextResponse> {
  const id = requestId(request.headers);

  if (!hasTrustedOrigin(request)) {
    return new ApiError({
      code: 'CSRF_ORIGIN_REJECTED',
      message: 'Requête refusée.',
      status: 403,
    }).toResponse(id);
  }

  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    await revokeSession(token);
    log.info({ requestId: id }, 'session révoquée');
  }

  // Idempotent : se déconnecter sans session valide reste un succès.
  const response = NextResponse.json({ status: 'ok' }, { headers: { 'x-request-id': id } });
  clearSessionCookie(response);

  return response;
}
