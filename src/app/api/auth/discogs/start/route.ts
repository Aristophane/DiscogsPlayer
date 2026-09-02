/**
 * Démarrage du parcours OAuth Discogs (§11, étapes 1 à 3 ; §17.1).
 */
import { NextResponse } from 'next/server';

import { ApiError } from '@/lib/api-error';
import { moduleLogger, requestId } from '@/lib/logger';
import { authorizeUrl, requestToken } from '@/modules/auth/discogs-oauth';
import { purgeExpiredRequestTokens, storeRequestToken } from '@/modules/auth/service';

export const dynamic = 'force-dynamic';

const log = moduleLogger('auth');

export async function GET(request: Request): Promise<NextResponse> {
  const id = requestId(request.headers);

  try {
    const pair = await requestToken();

    // Le secret reste côté serveur : le navigateur ne voit que le token public (§11).
    await storeRequestToken(pair);
    await purgeExpiredRequestTokens();

    log.info({ requestId: id }, 'request token obtenu');

    return NextResponse.redirect(authorizeUrl(pair.token), {
      status: 302,
      headers: { 'cache-control': 'no-store', 'x-request-id': id },
    });
  } catch (cause) {
    log.error({ requestId: id, err: cause }, 'échec du démarrage OAuth');

    return new ApiError({
      code: 'DISCOGS_OAUTH_START_FAILED',
      message: 'La connexion à Discogs est momentanément indisponible.',
      status: 503,
      retryable: true,
      cause,
    }).toResponse(id);
  }
}
