import { NextResponse } from 'next/server';
import { ApiError } from '@/lib/api-error';
import { requestId } from '@/lib/logger';
import { requireUser } from '@/modules/auth/current-user';
import { getCollectionHighlights } from '@/modules/collection/service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const id = requestId(request.headers);
  try {
    const user = await requireUser();
    return NextResponse.json(await getCollectionHighlights(user.activeCollectionOwnerId), {
      headers: { 'cache-control': 'no-store', 'x-request-id': id },
    });
  } catch (cause) {
    if (cause instanceof ApiError) return cause.toResponse(id);
    throw cause;
  }
}
