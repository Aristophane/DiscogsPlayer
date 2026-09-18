import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError } from '@/lib/api-error';
import { t } from '@/lib/i18n';
import { requestId } from '@/lib/logger';
import { requireUser } from '@/modules/auth/current-user';
import { getRandomSpotlight } from '@/modules/collection/service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const id = requestId(request.headers);
  try {
    const user = await requireUser();
    const previous = z
      .string()
      .max(100)
      .nullable()
      .safeParse(new URL(request.url).searchParams.get('previous'));
    if (!previous.success)
      throw new ApiError({
        code: 'SPOTLIGHT_QUERY_INVALID',
        message: t('home.spotlight.error'),
        status: 400,
      });
    const item = await getRandomSpotlight(user.activeCollectionOwnerId, previous.data ?? undefined);
    return NextResponse.json(
      { item },
      {
        headers: { 'cache-control': 'no-store', 'x-request-id': id },
      },
    );
  } catch (cause) {
    if (cause instanceof ApiError) return cause.toResponse(id);
    throw cause;
  }
}
