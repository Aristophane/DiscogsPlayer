/**
 * Retour d'autorisation Discogs (§11, étapes 4 à 7).
 *
 * Défenses appliquées ici : request token à usage unique et borné dans le temps (fixation
 * de session, callbacks expirés), validation Zod des paramètres, et rotation de session —
 * un nouveau jeton est émis à chaque authentification.
 */
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getEnv } from '@/lib/env';
import { ApiError } from '@/lib/api-error';
import { moduleLogger, requestId } from '@/lib/logger';
import {
  clearPendingInviteCookie,
  PENDING_INVITE_COOKIE_NAME,
  setSessionCookie,
} from '@/modules/auth/cookies';
import { accessToken, identity } from '@/modules/auth/discogs-oauth';
import { createSession, setViewingAsUserIdByToken } from '@/modules/auth/sessions';
import { consumeRequestToken, upsertUserFromDiscogs } from '@/modules/auth/service';
import { consumeInvite } from '@/modules/sharing/service';

export const dynamic = 'force-dynamic';

const log = moduleLogger('auth');

const callbackSchema = z.object({
  oauth_token: z.string().min(1),
  oauth_verifier: z.string().min(1),
});

export async function GET(request: Request): Promise<NextResponse> {
  const id = requestId(request.headers);
  const env = getEnv();

  const params = callbackSchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  );

  if (!params.success) {
    // L'utilisateur a refusé l'autorisation, ou le lien a été manipulé.
    return NextResponse.redirect(new URL('/connexion?erreur=annulee', env.APP_BASE_URL), {
      status: 302,
    });
  }

  try {
    const pending = await consumeRequestToken(params.data.oauth_token);

    if (!pending) {
      log.warn({ requestId: id }, 'request token inconnu, expiré ou déjà consommé');
      return NextResponse.redirect(new URL('/connexion?erreur=expiree', env.APP_BASE_URL), {
        status: 302,
      });
    }

    const tokens = await accessToken(pending, params.data.oauth_verifier);
    const discogsIdentity = await identity(tokens);
    const user = await upsertUserFromDiscogs(discogsIdentity, tokens);
    const session = await createSession(user.id);

    // On journalise l'identifiant interne, jamais le jeton ni le verifier (§21.1).
    log.info({ requestId: id, userId: user.id, role: user.role }, 'connexion réussie');

    // Invitation de partage en attente (Lot 7) : posée par `/api/collection-shares/
    // invites/[token]/begin` avant ce détour OAuth. On la consomme ici, avec la vraie
    // identité qui vient de se connecter — jamais un paramètre venu du client.
    const pendingInviteToken = (await cookies()).get(PENDING_INVITE_COOKIE_NAME)?.value;
    if (pendingInviteToken) {
      const consumed = await consumeInvite(pendingInviteToken, user.id);
      if (consumed) {
        await setViewingAsUserIdByToken(session.token, consumed.ownerId);
        log.info(
          { requestId: id, userId: user.id, ownerId: consumed.ownerId },
          'invitation de collection consommée après connexion',
        );
      } else {
        log.warn(
          { requestId: id, userId: user.id },
          'invitation de collection en attente invalide ou expirée',
        );
      }
    }

    const response = NextResponse.redirect(new URL('/collection', env.APP_BASE_URL), {
      status: 302,
    });
    setSessionCookie(response, session.token, session.expiresAt);
    if (pendingInviteToken) {
      clearPendingInviteCookie(response);
    }
    response.headers.set('cache-control', 'no-store');
    response.headers.set('x-request-id', id);

    return response;
  } catch (cause) {
    log.error({ requestId: id, err: cause }, 'échec du callback OAuth');

    return new ApiError({
      code: 'DISCOGS_OAUTH_CALLBACK_FAILED',
      message: 'La connexion à Discogs a échoué. Réessayez.',
      status: 503,
      retryable: true,
      cause,
    }).toResponse(id);
  }
}
