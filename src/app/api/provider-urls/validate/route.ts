/**
 * Validation d'une URL fournisseur collée par l'utilisateur (§13.5, §14.5, §17.5).
 *
 * Repli manuel : YouTube et Spotify n'ont pas trouvé de correspondance automatique.
 * L'utilisateur colle une URL, validée côté serveur avant toute intégration (§18.3, §18.4).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiError } from '@/lib/api-error';
import { requestId } from '@/lib/logger';
import { and, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { providerEntities, trackResolutions } from '@/db/schema';
import { hasTrustedOrigin } from '@/modules/auth/cookies';
import { requireUser } from '@/modules/auth/current-user';
import { youtubeIdFromUrl } from '@/modules/catalog/normalize';
import {
  canonicalizeSpotifyUrl,
  SpotifyOEmbedError,
  validateViaOEmbed,
} from '@/modules/providers/spotify/service';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ url: z.string().url(), trackId: z.string().uuid().optional() });

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

    await requireUser();
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));

    if (!parsed.success) {
      throw new ApiError({
        code: 'PROVIDER_URL_INVALID',
        message: 'Cette adresse n’est pas reconnue.',
        status: 400,
      });
    }

    const youtubeId = youtubeIdFromUrl(parsed.data.url);
    if (youtubeId) {
      if (parsed.data.trackId) {
        await cacheYoutube(parsed.data.trackId, youtubeId);
      }

      return NextResponse.json(
        { provider: 'youtube', videoId: youtubeId },
        { headers: { 'cache-control': 'no-store', 'x-request-id': id } },
      );
    }

    const spotifyEntity = canonicalizeSpotifyUrl(parsed.data.url);
    if (spotifyEntity) {
      try {
        await validateViaOEmbed(spotifyEntity);
      } catch (cause) {
        if (cause instanceof SpotifyOEmbedError) {
          throw new ApiError({
            code: 'SPOTIFY_URL_UNAVAILABLE',
            message: 'Ce lien Spotify n’a pas pu être validé.',
            status: 422,
            cause,
          });
        }
        throw cause;
      }

      return NextResponse.json(
        { provider: 'spotify', entityType: spotifyEntity.type, spotifyId: spotifyEntity.id },
        { headers: { 'cache-control': 'no-store', 'x-request-id': id } },
      );
    }

    throw new ApiError({
      code: 'PROVIDER_URL_UNSUPPORTED',
      message: 'Cette adresse n’est pas reconnue. Collez un lien YouTube ou Spotify.',
      status: 400,
    });
  } catch (cause) {
    if (cause instanceof ApiError) {
      return cause.toResponse(id);
    }
    throw cause;
  }
}

async function cacheYoutube(trackId: string, videoId: string): Promise<void> {
  const [entity] = await db
    .insert(providerEntities)
    .values({
      provider: 'youtube',
      entityType: 'video',
      externalId: videoId,
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    })
    .onConflictDoNothing()
    .returning({ id: providerEntities.id });

  const entityId =
    entity?.id ??
    (
      await db
        .select({ id: providerEntities.id })
        .from(providerEntities)
        .where(
          // Conflit résolu : relire la ligne existante plutôt que de deviner son id.
          and(
            eq(providerEntities.provider, 'youtube'),
            eq(providerEntities.entityType, 'video'),
            eq(providerEntities.externalId, videoId),
          ),
        )
        .limit(1)
    )[0]?.id;

  if (!entityId) {
    return;
  }

  await db
    .insert(trackResolutions)
    .values({ trackId, providerEntityId: entityId, source: 'manual_url' })
    .onConflictDoUpdate({
      target: trackResolutions.trackId,
      set: { providerEntityId: entityId, source: 'manual_url', updatedAt: new Date() },
    });
}
