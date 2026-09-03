/**
 * Sonde de disponibilité des pistes d'une édition (Lot 6bis).
 *
 * Sert uniquement le sondage côté client pendant qu'une récupération prioritaire est en
 * cours (`TracklistPending`) — jamais de déclenchement d'appel Discogs ici, seulement une
 * lecture. Qualifiée par utilisateur comme le reste de la fiche album (§18.5) : on ne
 * révèle pas si une édition existe au catalogue partagé à qui ne la possède pas.
 */
import { NextResponse } from 'next/server';

import { requestId } from '@/lib/logger';
import { requireUser } from '@/modules/auth/current-user';
import { getReleaseForUser } from '@/modules/catalog/release-service';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ discogsReleaseId: string }> },
): Promise<NextResponse> {
  const id = requestId(request.headers);
  const user = await requireUser();
  const { discogsReleaseId } = await context.params;

  const release = await getReleaseForUser(user.activeCollectionOwnerId, discogsReleaseId);

  return NextResponse.json(
    { tracksReady: release !== null && release.detailsFetchedAt !== null },
    { headers: { 'cache-control': 'no-store', 'x-request-id': id } },
  );
}
