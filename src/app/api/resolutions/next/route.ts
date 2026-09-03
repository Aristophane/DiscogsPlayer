/**
 * Piste suivante dans l'ordre de l'édition, résolue à la volée (§13.6).
 *
 * Appelé uniquement quand une piste se termine réellement — jamais en avance, jamais
 * plusieurs à la fois (§4.2, §13.6 : « ne jamais lancer en parallèle plusieurs
 * recherches sans besoin immédiat »).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiError } from '@/lib/api-error';
import { requestId } from '@/lib/logger';
import { hasTrustedOrigin } from '@/modules/auth/cookies';
import { requireUser } from '@/modules/auth/current-user';
import {
  getNextTrackId,
  getReleaseForUser,
  getTrackForResolution,
} from '@/modules/catalog/release-service';
import { resolveTrack } from '@/modules/resolution/service';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ releaseId: z.string().uuid(), afterOrdinal: z.number().int() });

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

    const nextTrackId = await getNextTrackId(parsed.data.releaseId, parsed.data.afterOrdinal);
    if (!nextTrackId) {
      return NextResponse.json(
        { status: 'end_of_album' },
        { headers: { 'cache-control': 'no-store', 'x-request-id': id } },
      );
    }

    const track = await getTrackForResolution(nextTrackId);
    if (!track) {
      return NextResponse.json(
        { status: 'end_of_album' },
        { headers: { 'cache-control': 'no-store', 'x-request-id': id } },
      );
    }

    // Le catalogue est partagé entre tous les utilisateurs (§10.2) : un `releaseId`
    // valide n'importe où ne suffit pas, il faut qu'il appartienne à la collection
    // active (§18.5 ; Lot 7 pour une collection partagée). Défaut préexistant corrigé
    // ici : cette route n'avait jusque-là aucune vérification, contrairement à
    // `/api/resolutions/album`.
    const release = await getReleaseForUser(user.activeCollectionOwnerId, track.discogsReleaseId);
    if (!release) {
      return NextResponse.json(
        { status: 'end_of_album' },
        { headers: { 'cache-control': 'no-store', 'x-request-id': id } },
      );
    }

    // `user.id`, pas `activeCollectionOwnerId` : voir le commentaire équivalent dans
    // `/api/resolutions/album`.
    const playback = await resolveTrack(user.id, nextTrackId);

    return NextResponse.json(
      {
        status: 'next',
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
