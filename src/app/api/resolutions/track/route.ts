/**
 * Résolution d'une piste (SPECIFICATION.md §17.5, simplifiée par ADR-0007).
 * Déclenchée uniquement par une action explicite de lecture (§4.2) — jamais par l'import
 * ni par l'affichage d'une fiche.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiError } from '@/lib/api-error';
import { requestId } from '@/lib/logger';
import { hasTrustedOrigin } from '@/modules/auth/cookies';
import { requireUser } from '@/modules/auth/current-user';
import { getTrackForResolution } from '@/modules/catalog/release-service';
import { resolveTrack } from '@/modules/resolution/service';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ trackId: z.string().uuid() });

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
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));

    if (!parsed.success) {
      throw new ApiError({
        code: 'RESOLUTION_REQUEST_INVALID',
        message: 'Requête invalide.',
        status: 400,
      });
    }

    const track = await getTrackForResolution(parsed.data.trackId);
    if (!track) {
      throw new ApiError({
        code: 'TRACK_NOT_FOUND',
        message: 'Cette piste est introuvable.',
        status: 404,
      });
    }

    const playback = await resolveTrack(user.id, track.trackId);
    if (!playback) {
      throw new ApiError({
        code: 'TRACK_NOT_FOUND',
        message: 'Cette piste est introuvable.',
        status: 404,
      });
    }

    return NextResponse.json(
      {
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
        playback,
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
