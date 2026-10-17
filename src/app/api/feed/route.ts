import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError } from '@/lib/api-error';
import { requestId } from '@/lib/logger';
import { requireUser } from '@/modules/auth/current-user';
import { ensureDailyFeed, getFeedPage } from '@/modules/feed/service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const id = requestId(request.headers);
  try {
    const user = await requireUser();
    const params = new URL(request.url).searchParams;
    const cursor = params.get('cursor') ?? undefined;
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .safeParse(params.get('limit') ?? 12);
    if (!limit.success)
      throw new ApiError({
        code: 'FEED_LIMIT_INVALID',
        message: 'Taille de page invalide.',
        status: 400,
      });
    if (cursor && cursor.length > 512)
      throw new ApiError({
        code: 'FEED_CURSOR_INVALID',
        message: 'Curseur du fil invalide.',
        status: 400,
      });
    await ensureDailyFeed(user.id);
    return NextResponse.json(await getFeedPage(user.id, cursor, new Date(), limit.data), {
      headers: { 'cache-control': 'no-store', 'x-request-id': id },
    });
  } catch (cause) {
    if (cause instanceof ApiError) return cause.toResponse(id);
    throw cause;
  }
}
