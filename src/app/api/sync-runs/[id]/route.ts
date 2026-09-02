/** État d'un run précis (§17.2). Filtré par l'utilisateur de la session (§18.5). */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiError } from '@/lib/api-error';
import { requestId } from '@/lib/logger';
import { requireUser } from '@/modules/auth/current-user';
import { getRun } from '@/modules/sync/service';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const requestIdValue = requestId(request.headers);

  try {
    const user = await requireUser();
    const { id } = await context.params;

    const parsed = z.string().uuid().safeParse(id);
    if (!parsed.success) {
      throw new ApiError({
        code: 'SYNC_RUN_NOT_FOUND',
        message: 'Cette synchronisation est introuvable.',
        status: 404,
      });
    }

    const run = await getRun(user.id, parsed.data);
    if (!run) {
      // Même réponse qu'un run appartenant à quelqu'un d'autre : on ne révèle pas
      // l'existence d'une ressource d'un autre compte.
      throw new ApiError({
        code: 'SYNC_RUN_NOT_FOUND',
        message: 'Cette synchronisation est introuvable.',
        status: 404,
      });
    }

    return NextResponse.json(run, {
      headers: { 'cache-control': 'no-store', 'x-request-id': requestIdValue },
    });
  } catch (cause) {
    if (cause instanceof ApiError) {
      return cause.toResponse(requestIdValue);
    }
    throw cause;
  }
}
