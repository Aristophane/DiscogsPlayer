/**
 * Résolution de la première piste d'un album (§17.5) : c'est ce que déclenche le bouton
 * play au niveau album, sans jamais lancer plusieurs recherches à la fois (§13.6).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiError } from '@/lib/api-error';
import { requestId } from '@/lib/logger';
import { hasTrustedOrigin } from '@/modules/auth/cookies';
import { requireUser } from '@/modules/auth/current-user';
import { getFirstPlayableTrackId, getReleaseForUser } from '@/modules/catalog/release-service';
import { resolveTrack } from '@/modules/resolution/service';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ discogsReleaseId: z.string().min(1) });

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

    // Qualifié par utilisateur : on ne lance la lecture que d'un album de sa collection
    // (§18.5), pas de n'importe quelle édition du catalogue partagé.
    const release = await getReleaseForUser(user.id, parsed.data.discogsReleaseId);
    if (!release) {
      throw new ApiError({
        code: 'RELEASE_NOT_FOUND',
        message: 'Cet album n’est pas dans votre collection.',
        status: 404,
      });
    }

    const trackId = await getFirstPlayableTrackId(release.releaseId);
    if (!trackId) {
      return NextResponse.json(
        { status: 'empty' },
        { headers: { 'cache-control': 'no-store', 'x-request-id': id } },
      );
    }

    const playback = await resolveTrack(user.id, trackId);

    return NextResponse.json(
      {
        track: {
          id: trackId,
          ordinal: 0,
          releaseId: release.releaseId,
          discogsReleaseId: release.discogsReleaseId,
          releaseTitle: release.title,
          artists: release.artists,
          coverUrl: release.coverUrl,
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
