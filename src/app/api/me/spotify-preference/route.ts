/**
 * Préférence Spotify (ADR-0006) : facultative, rejouable, jamais un OAuth.
 * Accessible à tout moment depuis les paramètres, pas seulement à l'onboarding.
 */
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/db/client';
import { users } from '@/db/schema';
import { ApiError } from '@/lib/api-error';
import { requestId } from '@/lib/logger';
import { hasTrustedOrigin } from '@/modules/auth/cookies';
import { requireUser } from '@/modules/auth/current-user';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ value: z.enum(['yes', 'no']) });

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
        code: 'SPOTIFY_PREFERENCE_INVALID',
        message: 'Valeur invalide.',
        status: 400,
      });
    }

    await db
      .update(users)
      .set({ spotifyEnabled: parsed.data.value, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    return NextResponse.json(
      { spotifyEnabled: parsed.data.value },
      { headers: { 'cache-control': 'no-store', 'x-request-id': id } },
    );
  } catch (cause) {
    if (cause instanceof ApiError) {
      return cause.toResponse(id);
    }
    throw cause;
  }
}
