/** Ouverture d'une session Radio (ADR-0006). */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiError } from '@/lib/api-error';
import { requestId } from '@/lib/logger';
import { hasTrustedOrigin } from '@/modules/auth/cookies';
import { requireUser } from '@/modules/auth/current-user';
import { createSession } from '@/modules/radio/service';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  genres: z.array(z.string().max(80)).max(20).optional(),
  styles: z.array(z.string().max(80)).max(20).optional(),
});

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
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));

    if (!parsed.success) {
      throw new ApiError({
        code: 'RADIO_FILTERS_INVALID',
        message: 'Les filtres sont invalides.',
        status: 400,
      });
    }

    const session = await createSession(user.id, user.activeCollectionOwnerId, parsed.data);

    return NextResponse.json(session, {
      status: 201,
      headers: { 'cache-control': 'no-store', 'x-request-id': id },
    });
  } catch (cause) {
    if (cause instanceof ApiError) {
      return cause.toResponse(id);
    }
    throw cause;
  }
}
