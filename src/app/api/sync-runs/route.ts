/**
 * Déclenchement et état de la synchronisation (§17.2).
 * `POST` répond `202 Accepted` avec le run créé ou le run déjà actif (SYNC-002/004).
 */
import { NextResponse } from 'next/server';

import { ApiError } from '@/lib/api-error';
import { requestId } from '@/lib/logger';
import { hasTrustedOrigin } from '@/modules/auth/cookies';
import { requireUser } from '@/modules/auth/current-user';
import { getCurrentRun, startSync } from '@/modules/sync/service';

export const dynamic = 'force-dynamic';

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
    const existing = await getCurrentRun(user.id);
    const { run, created } = await startSync(user.id, existing ? 'manual' : 'initial');

    return NextResponse.json(
      { id: run.id, status: run.status, created },
      { status: 202, headers: { 'cache-control': 'no-store', 'x-request-id': id } },
    );
  } catch (cause) {
    if (cause instanceof ApiError) {
      return cause.toResponse(id);
    }
    throw cause;
  }
}
