/** État du quota YouTube (§13.3, §17.5). */
import { NextResponse } from 'next/server';

import { requestId } from '@/lib/logger';
import { requireUser } from '@/modules/auth/current-user';
import { getQuotaStatus } from '@/modules/providers/youtube/quota';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const id = requestId(request.headers);
  await requireUser();

  const status = await getQuotaStatus();

  return NextResponse.json(
    {
      remainingEstimated: status.searchesRemainingEstimated,
      resetsAt: status.resetsAt.toISOString(),
      exhausted: status.exhausted,
    },
    { headers: { 'cache-control': 'no-store', 'x-request-id': id } },
  );
}
