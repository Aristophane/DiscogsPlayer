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
import { requestPriorityReleaseFetch } from '@/modules/sync/service';

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

    // Qualifié par la collection active (§18.5) : la sienne par défaut, ou celle d'un
    // ami dont le partage a été revérifié (Lot 7) — jamais n'importe quelle édition du
    // catalogue partagé au-delà de ces deux cas.
    const release = await getReleaseForUser(
      user.activeCollectionOwnerId,
      parsed.data.discogsReleaseId,
    );
    if (!release) {
      throw new ApiError({
        code: 'RELEASE_NOT_FOUND',
        message: 'Cet album n’est pas dans votre collection.',
        status: 404,
      });
    }

    const trackId = await getFirstPlayableTrackId(release.releaseId);
    if (!trackId) {
      // `detailsFetchedAt` distingue deux situations qui se ressemblent en surface mais
      // n'appellent pas la même réponse : une édition dont l'import n'a pas encore
      // ramené les pistes (« pending », on peut agir) d'une édition réellement sans
      // piste connue (« empty », rare mais possible — un cas qu'un nouvel essai ne
      // résoudra jamais).
      if (release.detailsFetchedAt === null) {
        // Fait passer cette édition devant la file d'import en arrière-plan (Lot 6bis) :
        // cliquer play doit vraiment favoriser la lecture, pas seulement l'annoncer.
        await requestPriorityReleaseFetch(release.discogsReleaseId);

        return NextResponse.json(
          { status: 'pending' },
          { headers: { 'cache-control': 'no-store', 'x-request-id': id } },
        );
      }

      return NextResponse.json(
        { status: 'empty' },
        { headers: { 'cache-control': 'no-store', 'x-request-id': id } },
      );
    }

    // `user.id`, pas `activeCollectionOwnerId` : `resolveTrack` ne s'en sert que pour
    // la préférence Spotify (ADR-0006), qui doit rester celle de la personne qui
    // regarde l'écran, pas celle du propriétaire d'une collection consultée (Lot 7).
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
