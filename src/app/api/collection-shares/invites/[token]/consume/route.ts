/**
 * Confirmation d'une invitation par un visiteur déjà connecté (Lot 7).
 *
 * Toujours `user.id` (vraie identité), jamais `activeCollectionOwnerId` — accepter une
 * invitation reçue pendant qu'on consulte déjà la collection d'un autre ami ne doit
 * jamais créer un partage au nom de ce dernier.
 */
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { ApiError } from '@/lib/api-error';
import { requestId } from '@/lib/logger';
import { hasTrustedOrigin } from '@/modules/auth/cookies';
import { requireUser } from '@/modules/auth/current-user';
import { SESSION_COOKIE_NAME, setViewingAsUserIdByToken } from '@/modules/auth/sessions';
import { consumeInvite } from '@/modules/sharing/service';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
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
    const { token } = await context.params;

    const consumed = await consumeInvite(token, user.id);
    if (!consumed) {
      throw new ApiError({
        code: 'INVITE_INVALID',
        message: 'Ce lien d’invitation n’est plus valide.',
        status: 410,
      });
    }

    // Bascule immédiate sur la collection de l'ami qui vient d'accorder l'accès : le
    // sens même de l'invitation, pas une étape séparée à effectuer soi-même ensuite.
    const store = await cookies();
    const sessionToken = store.get(SESSION_COOKIE_NAME)?.value;
    if (sessionToken) {
      await setViewingAsUserIdByToken(sessionToken, consumed.ownerId);
    }

    return NextResponse.json(
      { ownerId: consumed.ownerId, ownerUsername: consumed.ownerUsername },
      { headers: { 'cache-control': 'no-store', 'x-request-id': id } },
    );
  } catch (cause) {
    if (cause instanceof ApiError) {
      return cause.toResponse(id);
    }
    throw cause;
  }
}
