/**
 * Tirage d'un album (§17.4).
 *
 * RAND-006 : la réponse décrit l'album, elle ne déclenche aucune résolution de média.
 * Le mode Radio, lui, lancera explicitement la lecture (ADR-0006).
 */
import { NextResponse } from 'next/server';

import { ApiError } from '@/lib/api-error';
import { requestId } from '@/lib/logger';
import { hasTrustedOrigin } from '@/modules/auth/cookies';
import { requireUser } from '@/modules/auth/current-user';
import { getReleaseForUser } from '@/modules/catalog/release-service';
import { draw } from '@/modules/random/service';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const requestIdValue = requestId(request.headers);

  try {
    if (!hasTrustedOrigin(request)) {
      throw new ApiError({
        code: 'CSRF_ORIGIN_REJECTED',
        message: 'Requête refusée.',
        status: 403,
      });
    }

    const user = await requireUser();
    const { id } = await context.params;
    const result = await draw(user.id, id);

    if (result.status === 'exhausted') {
      return NextResponse.json(
        { status: 'exhausted' },
        { headers: { 'cache-control': 'no-store', 'x-request-id': requestIdValue } },
      );
    }

    const release = await getReleaseForUser(user.id, result.discogsReleaseId);

    return NextResponse.json(
      { status: 'drawn', drawOrder: result.drawOrder, release },
      { headers: { 'cache-control': 'no-store', 'x-request-id': requestIdValue } },
    );
  } catch (cause) {
    if (cause instanceof ApiError) {
      return cause.toResponse(requestIdValue);
    }
    throw cause;
  }
}
