/**
 * Tirage Radio (ADR-0006) : choisit la prochaine piste — en priorité déjà résolue — et
 * la résout. Réutilisé pour le premier tirage comme pour chaque enchaînement.
 */
import { NextResponse } from 'next/server';

import { ApiError } from '@/lib/api-error';
import { requestId } from '@/lib/logger';
import { hasTrustedOrigin } from '@/modules/auth/cookies';
import { requireUser } from '@/modules/auth/current-user';
import { getTrackForResolution } from '@/modules/catalog/release-service';
import { draw } from '@/modules/radio/service';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const requestIdValue = requestId(request.headers);

  try {
    if (!hasTrustedOrigin(request)) {
      throw new ApiError({
        code: 'CSRF_ORIGIN_REJECTED',
        message: 'Requête refusée.',
        status: 403,
      });
    }

    const user = await requireUser();
    const { id } = await context.params;

    const result = await draw(user.id, id);

    if (result.status !== 'track') {
      return NextResponse.json(
        { status: result.status },
        { headers: { 'cache-control': 'no-store', 'x-request-id': requestIdValue } },
      );
    }

    const track = await getTrackForResolution(result.trackId);
    if (!track) {
      return NextResponse.json(
        { status: 'exhausted' },
        { headers: { 'cache-control': 'no-store', 'x-request-id': requestIdValue } },
      );
    }

    return NextResponse.json(
      {
        status: 'track',
        track: {
          id: track.trackId,
          ordinal: track.trackOrdinal,
          title: track.trackTitle,
          releaseId: track.releaseId,
          discogsReleaseId: track.discogsReleaseId,
          releaseTitle: track.releaseTitle,
          artists: track.artistsText,
          coverUrl: track.coverUrl,
        },
        playback: result.playback,
      },
      { headers: { 'cache-control': 'no-store', 'x-request-id': requestIdValue } },
    );
  } catch (cause) {
    if (cause instanceof ApiError) {
      return cause.toResponse(requestIdValue);
    }
    throw cause;
  }
}
