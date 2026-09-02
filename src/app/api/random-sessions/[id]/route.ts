/** État d'une session de tirage (§17.4). */
import { NextResponse } from 'next/server';

import { ApiError } from '@/lib/api-error';
import { requestId } from '@/lib/logger';
import { requireUser } from '@/modules/auth/current-user';
import { getSession, listDrawn } from '@/modules/random/service';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const requestIdValue = requestId(request.headers);

  try {
    const user = await requireUser();
    const { id } = await context.params;
    const session = await getSession(user.id, id);

    if (!session) {
      // Même réponse pour une session inexistante et pour celle d'un autre compte.
      throw new ApiError({
        code: 'RANDOM_SESSION_NOT_FOUND',
        message: 'Cette session de tirage est introuvable.',
        status: 404,
      });
    }

    return NextResponse.json(
      { session, drawn: await listDrawn(user.id, id) },
      { headers: { 'cache-control': 'no-store', 'x-request-id': requestIdValue } },
    );
  } catch (cause) {
    if (cause instanceof ApiError) {
      return cause.toResponse(requestIdValue);
    }
    throw cause;
  }
}
