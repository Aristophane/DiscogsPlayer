/**
 * Création d'un lien d'invitation à usage unique (Lot 7, partage de collection).
 *
 * Toujours au nom de `user.id`, jamais de `activeCollectionOwnerId` : un utilisateur qui
 * consulte la collection d'un ami ne doit jamais pouvoir inviter quelqu'un dans cette
 * collection à sa place (§18.5).
 */
import { NextResponse } from 'next/server';

import { ApiError } from '@/lib/api-error';
import { getEnv } from '@/lib/env';
import { requestId } from '@/lib/logger';
import { hasTrustedOrigin } from '@/modules/auth/cookies';
import { requireUser } from '@/modules/auth/current-user';
import { createInvite } from '@/modules/sharing/service';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  const id = requestId(request.headers);

  try {
    if (!hasTrustedOrigin(request)) {
      throw new ApiError({
        code: 'CSRF_ORIGIN_REJECTED',
        message: 'Requête refusée.',
        status: 403,
      });
    }

    const user = await requireUser();
    const invite = await createInvite(user.id);
    const url = new URL(`/invitations/${invite.token}`, getEnv().APP_BASE_URL).toString();

    return NextResponse.json(
      { url, expiresAt: invite.expiresAt.toISOString() },
      { headers: { 'cache-control': 'no-store', 'x-request-id': id } },
    );
  } catch (cause) {
    if (cause instanceof ApiError) {
      return cause.toResponse(id);
    }
    throw cause;
  }
}
