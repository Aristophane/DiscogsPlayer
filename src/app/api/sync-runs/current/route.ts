/** Run actif de l'utilisateur courant, ou à défaut le dernier terminé (§17.2). */
import { NextResponse } from 'next/server';

import { ApiError } from '@/lib/api-error';
import { requestId } from '@/lib/logger';
import { requireUser } from '@/modules/auth/current-user';
import { countActiveInstances, getCurrentRun, getLastCompletedRun } from '@/modules/sync/service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const id = requestId(request.headers);

  try {
    const user = await requireUser();
    const run = (await getCurrentRun(user.id)) ?? (await getLastCompletedRun(user.id));
    const activeInstances = await countActiveInstances(user.id);

    return NextResponse.json(
      { run, activeInstances },
      { headers: { 'cache-control': 'no-store', 'x-request-id': id } },
    );
  } catch (cause) {
    if (cause instanceof ApiError) {
      return cause.toResponse(id);
    }
    throw cause;
  }
}
