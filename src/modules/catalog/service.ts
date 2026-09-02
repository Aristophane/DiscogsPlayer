/**
 * Service du catalogue (SPECIFICATION.md §10.2, §12.1).
 *
 * Point d'entrée unique vers les tables `discogs_*` : les autres modules passent par ici
 * plutôt que d'écrire eux-mêmes dans le catalogue (CLAUDE.md, isolation des modules).
 */
import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  discogsArtists,
  discogsReleaseArtists,
  discogsReleaseVideos,
  discogsReleases,
  discogsTracks,
} from '@/db/schema';
import type { ReleaseDetails } from '@/modules/sync/discogs-api';

import { cleanArtistName, formatArtistCredit, normalizeText, parseTracklist } from './normalize';

/** Une édition dont les détails datent de plus de 30 jours est rechargée (G-18). */
export const DETAILS_FRESHNESS_DAYS = 30;

/**
 * Discogs renvoie `0` pour une année inconnue. Stocker ce zéro afficherait « 0 » dans la
 * fiche album : une année absente doit rester absente.
 */
function normalizeYear(year: number | null | undefined): number | null {
  return year === null || year === undefined || year <= 0 ? null : year;
}

type ArtistInput = {
  id?: number | null | undefined;
  name: string;
  join?: string | null | undefined;
};

export type ReleaseSummaryInput = {
  discogsReleaseId: string;
  title: string;
  masterId?: string | null;
  year?: number | null;
  genres?: string[];
  styles?: string[];
  formats?: unknown;
  primaryImageUrl?: string | null;
  artists?: ArtistInput[];
};

/**
 * Crée ou met à jour le résumé d'une édition vu dans une page de collection.
 *
 * N'écrase jamais les détails déjà chargés : le résumé de collection est plus pauvre
 * qu'une fiche release complète, l'inverser ferait régresser le catalogue.
 */
export async function upsertReleaseSummary(input: ReleaseSummaryInput): Promise<string> {
  const artistsText = input.artists?.length ? formatArtistCredit(input.artists) : '';

  const rows = await db
    .insert(discogsReleases)
    .values({
      discogsReleaseId: input.discogsReleaseId,
      title: input.title,
      masterId: input.masterId ?? null,
      year: normalizeYear(input.year),
      genres: input.genres ?? [],
      styles: input.styles ?? [],
      formats: input.formats ?? [],
      primaryImageUrl: input.primaryImageUrl ?? null,
      artistsText,
    })
    .onConflictDoUpdate({
      target: discogsReleases.discogsReleaseId,
      set: {
        title: input.title,
        year: normalizeYear(input.year),
        masterId: input.masterId ?? null,
        // `coalesce(nullif(...))` : une valeur vide venue du résumé ne remplace pas
        // une valeur déjà renseignée par le chargement détaillé.
        primaryImageUrl: sql`coalesce(${input.primaryImageUrl ?? null}, ${discogsReleases.primaryImageUrl})`,
        artistsText: sql`case when ${artistsText} = '' then ${discogsReleases.artistsText} else ${artistsText} end`,
        updatedAt: new Date(),
      },
    })
    .returning({ id: discogsReleases.id });

  const id = rows[0]?.id;
  if (!id) {
    throw new Error(`Échec de l’upsert de l’édition ${input.discogsReleaseId}`);
  }

  return id;
}

async function upsertArtists(releaseId: string, artists: ArtistInput[]): Promise<void> {
  await db.delete(discogsReleaseArtists).where(eq(discogsReleaseArtists.releaseId, releaseId));

  let position = 0;
  for (const artist of artists) {
    const name = cleanArtistName(artist.name);
    const discogsArtistId =
      artist.id === null || artist.id === undefined ? null : String(artist.id);

    let artistId: string | undefined;

    if (discogsArtistId) {
      const rows = await db
        .insert(discogsArtists)
        .values({ discogsArtistId, name, nameNormalized: normalizeText(name) })
        .onConflictDoUpdate({
          target: discogsArtists.discogsArtistId,
          // L'index est partiel : PostgreSQL ne peut l'inférer qu'avec son prédicat.
          targetWhere: sql`${discogsArtists.discogsArtistId} is not null`,
          set: { name, nameNormalized: normalizeText(name) },
        })
        .returning({ id: discogsArtists.id });
      artistId = rows[0]?.id;
    } else {
      // Artiste sans identifiant Discogs : on retrouve l'existant par nom normalisé.
      const existing = await db
        .select({ id: discogsArtists.id })
        .from(discogsArtists)
        .where(
          and(
            isNull(discogsArtists.discogsArtistId),
            eq(discogsArtists.nameNormalized, normalizeText(name)),
          ),
        )
        .limit(1);

      artistId =
        existing[0]?.id ??
        (
          await db
            .insert(discogsArtists)
            .values({ discogsArtistId: null, name, nameNormalized: normalizeText(name) })
            .returning({ id: discogsArtists.id })
        )[0]?.id;
    }

    if (!artistId) {
      continue;
    }

    await db.insert(discogsReleaseArtists).values({
      releaseId,
      artistId,
      position,
      joinText: artist.join ?? null,
    });

    position += 1;
  }
}

/**
 * Applique une fiche release complète : pistes, artistes, genres, styles, image, vidéos.
 *
 * Les pistes et vidéos sont remplacées en bloc dans une transaction — un tracklist
 * partiellement écrit serait pire qu'un tracklist absent.
 */
export async function applyReleaseDetails(details: ReleaseDetails): Promise<string> {
  const discogsReleaseId = String(details.id);
  const artists = details.artists ?? [];
  const primaryImage =
    details.images?.find((image) => image.type === 'primary')?.uri ??
    details.images?.[0]?.uri ??
    null;

  const releaseId = await upsertReleaseSummary({
    discogsReleaseId,
    title: details.title,
    masterId:
      details.master_id === null || details.master_id === undefined
        ? null
        : String(details.master_id),
    year: details.year ?? null,
    genres: details.genres ?? [],
    styles: details.styles ?? [],
    formats: details.formats ?? [],
    primaryImageUrl: primaryImage,
    artists,
  });

  const tracks = parseTracklist(details.tracklist ?? []);

  await db.transaction(async (tx) => {
    await tx.delete(discogsTracks).where(eq(discogsTracks.releaseId, releaseId));

    if (tracks.length > 0) {
      await tx.insert(discogsTracks).values(
        tracks.map((track) => ({
          releaseId,
          ordinal: track.ordinal,
          discogsPosition: track.discogsPosition,
          title: track.title,
          titleNormalized: track.titleNormalized,
          durationSeconds: track.durationSeconds,
          type: track.type,
        })),
      );
    }

    await tx.delete(discogsReleaseVideos).where(eq(discogsReleaseVideos.releaseId, releaseId));

    const videos = details.videos ?? [];
    if (videos.length > 0) {
      const unique = new Map<string, { title: string | null; durationSeconds: number | null }>();
      for (const video of videos) {
        unique.set(video.uri, {
          title: video.title ?? null,
          durationSeconds: video.duration ?? null,
        });
      }

      await tx.insert(discogsReleaseVideos).values(
        [...unique.entries()].map(([uri, video]) => ({
          releaseId,
          urlCanonical: uri,
          provider: 'youtube',
          title: video.title,
          durationSeconds: video.durationSeconds,
        })),
      );
    }

    await tx
      .update(discogsReleases)
      .set({
        genres: details.genres ?? [],
        styles: details.styles ?? [],
        formats: details.formats ?? [],
        country: details.country ?? null,
        detailsFetchedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(discogsReleases.id, releaseId));
  });

  await upsertArtists(releaseId, artists);

  return releaseId;
}

/**
 * Parmi des identifiants Discogs, ceux dont les détails manquent ou sont périmés.
 * C'est la base de la déduplication globale (§12.2) : inutile de recharger une édition
 * déjà chargée par la collection d'un autre utilisateur.
 */
export async function selectStaleReleaseIds(
  discogsReleaseIds: string[],
  now = new Date(),
): Promise<string[]> {
  if (discogsReleaseIds.length === 0) {
    return [];
  }

  // Fraîcheur propre au catalogue Discogs, distincte de la rétention des métadonnées
  // fournisseur (§13.7), qui obéit à une politique externe.
  const threshold = new Date(now.getTime() - DETAILS_FRESHNESS_DAYS * 24 * 3_600_000);

  const rows = await db
    .select({ discogsReleaseId: discogsReleases.discogsReleaseId })
    .from(discogsReleases)
    .where(
      and(
        inArray(discogsReleases.discogsReleaseId, discogsReleaseIds),
        or(
          isNull(discogsReleases.detailsFetchedAt),
          lt(discogsReleases.detailsFetchedAt, threshold),
        ),
      ),
    );

  return rows.map((row) => row.discogsReleaseId);
}
