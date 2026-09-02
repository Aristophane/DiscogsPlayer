/**
 * Identité de l'utilisateur courant (§17.1).
 * Ne renvoie aucun jeton fournisseur ni donnée d'un autre compte (§18.5).
 */
import { NextResponse } from 'next/server';

import { ApiError } from '@/lib/api-error';
import { requestId } from '@/lib/logger';
import { requireUser } from '@/modules/auth/current-user';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const id = requestId(request.headers);

  try {
    const user = await requireUser();

    return NextResponse.json(
      {
        id: user.id,
        discogsUsername: user.discogsUsername,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        role: user.role,
        contributionStatus: user.contributionStatus,
        locale: user.locale,
      },
      { headers: { 'cache-control': 'no-store', 'x-request-id': id } },
    );
  } catch (cause) {
    if (cause instanceof ApiError) {
      return cause.toResponse(id);
    }
    throw cause;
  }
}
