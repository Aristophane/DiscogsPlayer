/**
 * Bascule de la collection active (Lot 7) : la sienne, ou celle d'un ami qui l'a
 * partagée. Le partage est revérifié ici (§18.5) avant d'écrire sur la session — jamais
 * de confiance dans un `ownerId` client sans ce contrôle.
 */
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiError } from '@/lib/api-error';
import { requestId } from '@/lib/logger';
import { hasTrustedOrigin } from '@/modules/auth/cookies';
import { requireUser } from '@/modules/auth/current-user';
import { SESSION_COOKIE_NAME, setViewingAsUserIdByToken } from '@/modules/auth/sessions';
import { hasActiveGrant } from '@/modules/sharing/service';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ ownerId: z.string().uuid().nullable() });

export async function PUT(request: Request): Promise<NextResponse> {
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
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));

    if (!parsed.success) {
      throw new ApiError({
        code: 'COLLECTION_ACTIVE_SWITCH_INVALID',
        message: 'Requête invalide.',
        status: 400,
      });
    }

    const { ownerId } = parsed.data;

    if (ownerId !== null && ownerId !== user.id) {
      const granted = await hasActiveGrant(ownerId, user.id);
      if (!granted) {
        throw new ApiError({
          code: 'COLLECTION_SHARE_NOT_GRANTED',
          message: 'Vous n’avez pas accès à cette collection.',
          status: 403,
        });
      }
    }

    const store = await cookies();
    const token = store.get(SESSION_COOKIE_NAME)?.value;
    if (!token) {
      throw new ApiError({ code: 'AUTH_REQUIRED', message: 'Connectez-vous.', status: 401 });
    }

    await setViewingAsUserIdByToken(token, ownerId === user.id ? null : ownerId);

    return NextResponse.json(
      { activeCollectionOwnerId: ownerId ?? user.id },
      { headers: { 'cache-control': 'no-store', 'x-request-id': id } },
    );
  } catch (cause) {
    if (cause instanceof ApiError) {
      return cause.toResponse(id);
    }
    throw cause;
  }
}
