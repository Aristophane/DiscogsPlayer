/**
 * Gestion des partages actifs (Lot 7) : ce qu'on a reçu, ce qu'on a accordé, révocation.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiError } from '@/lib/api-error';
import { requestId } from '@/lib/logger';
import { hasTrustedOrigin } from '@/modules/auth/cookies';
import { requireUser } from '@/modules/auth/current-user';
import { listGrantsGivenBy, listGrantsReceivedBy, revokeGrant } from '@/modules/sharing/service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const id = requestId(request.headers);

  try {
    const user = await requireUser();
    const [given, received] = await Promise.all([
      listGrantsGivenBy(user.id),
      listGrantsReceivedBy(user.id),
    ]);

    return NextResponse.json(
      {
        given: given.map((g) => ({ ...g, createdAt: g.createdAt.toISOString() })),
        received: received.map((g) => ({ ...g, createdAt: g.createdAt.toISOString() })),
      },
      { headers: { 'cache-control': 'no-store', 'x-request-id': id } },
    );
  } catch (cause) {
    if (cause instanceof ApiError) {
      return cause.toResponse(id);
    }
    throw cause;
  }
}

const revokeSchema = z.object({ granteeId: z.string().uuid() });

/**
 * Retire un accès accordé. Qualifié par `user.id` côté service : seul le propriétaire
 * de la collection peut révoquer, jamais le bénéficiaire pour lui-même via cette route.
 */
export async function DELETE(request: Request): Promise<NextResponse> {
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
    const parsed = revokeSchema.safeParse(await request.json().catch(() => null));

    if (!parsed.success) {
      throw new ApiError({
        code: 'COLLECTION_SHARE_REVOKE_INVALID',
        message: 'Requête invalide.',
        status: 400,
      });
    }

    await revokeGrant(user.id, parsed.data.granteeId);

    return NextResponse.json(
      { revoked: true },
      { headers: { 'cache-control': 'no-store', 'x-request-id': id } },
    );
  } catch (cause) {
    if (cause instanceof ApiError) {
      return cause.toResponse(id);
    }
    throw cause;
  }
}
