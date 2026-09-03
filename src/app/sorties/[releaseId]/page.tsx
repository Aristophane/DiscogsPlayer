import { notFound, redirect } from 'next/navigation';

import { t } from '@/lib/i18n';
import { getCurrentUser } from '@/modules/auth/current-user';
import {
  formatDuration,
  formatFormats,
  getReleaseForUser,
} from '@/modules/catalog/release-service';
import { TracklistPending } from '@/modules/catalog/components/tracklist-pending';
import { AlbumCover } from '@/modules/collection/components/album-cover';
import { coverProxyUrl } from '@/modules/collection/cover';
import { PlayButton } from '@/modules/playback/components/play-button';
import { requestPriorityReleaseFetch } from '@/modules/sync/service';

/**
 * Fiche album (§7.4).
 *
 * Aucune résolution de **média** n'est déclenchée par l'affichage de cette page (§4.2) :
 * elle ne montre que ce qui est déjà connu, et le clic sur un bouton play reste seul à
 * lancer une recherche YouTube/Spotify. Distinct de la récupération des métadonnées
 * Discogs (titre, pistes) ci-dessous : ce n'est pas une résolution de média, et
 * l'attendre passivement derrière l'import en arrière-plan desservirait justement
 * l'objectif de §4.2, qui est de favoriser la lecture (Lot 6bis).
 */
export default async function ReleasePage({ params }: { params: Promise<{ releaseId: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/connexion');
  }

  const { releaseId } = await params;
  const release = await getReleaseForUser(user.id, releaseId);

  if (!release) {
    notFound();
  }

  const cover = coverProxyUrl(release.coverUrl);
  const formats = formatFormats(release.formats);
  const playable = release.tracks.filter((track) => track.type !== 'heading');

  // Distinct de « aucune piste » au sens strict (une édition en a toujours dans les cas
  // réels) : `detailsFetchedAt` porte le sens exact, `tracks.length` ne suffit pas seul —
  // une fiche déjà chargée normalement ne doit jamais redéclencher de récupération.
  const tracksPending = playable.length === 0 && release.detailsFetchedAt === null;
  if (tracksPending) {
    // Visiter la fiche est un signal d'intérêt aussi explicite qu'un clic play : fait
    // passer cette édition devant la file d'import en arrière-plan (Lot 6bis).
    await requestPriorityReleaseFetch(release.discogsReleaseId);
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6">
      <a href="/collection" className="text-sm underline">
        {t('release.backToCollection')}
      </a>

      <header className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <div className="relative aspect-square w-full max-w-xs shrink-0 overflow-hidden rounded-lg bg-surface">
          <AlbumCover src={cover} title={release.title} artists={release.artists} eager />
          <PlayButton
            kind="album"
            id={release.discogsReleaseId}
            size="md"
            className="absolute bottom-2 right-2 shadow-sm"
          />
        </div>

        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{release.title}</h1>
          <p className="text-lg text-muted">{release.artists}</p>

          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {release.year !== null ? (
              <>
                <dt className="text-muted">{t('release.details.year')}</dt>
                <dd>{release.year}</dd>
              </>
            ) : null}
            {release.country ? (
              <>
                <dt className="text-muted">{t('release.details.country')}</dt>
                <dd>{release.country}</dd>
              </>
            ) : null}
            {formats ? (
              <>
                <dt className="text-muted">{t('release.details.formats')}</dt>
                <dd>{formats}</dd>
              </>
            ) : null}
            {release.genres.length > 0 ? (
              <>
                <dt className="text-muted">{t('release.details.genres')}</dt>
                <dd>{release.genres.join(', ')}</dd>
              </>
            ) : null}
            {release.styles.length > 0 ? (
              <>
                <dt className="text-muted">{t('release.details.styles')}</dt>
                <dd>{release.styles.join(', ')}</dd>
              </>
            ) : null}
            {release.instanceCount > 1 ? (
              <>
                <dt className="text-muted">{t('release.details.copies')}</dt>
                <dd>{release.instanceCount}</dd>
              </>
            ) : null}
            <dt className="text-muted">{t('release.details.discogs')}</dt>
            <dd>#{release.discogsReleaseId}</dd>
          </dl>
        </div>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">{t('release.tracklist')}</h2>

        {tracksPending ? (
          <TracklistPending discogsReleaseId={release.discogsReleaseId} />
        ) : playable.length === 0 ? (
          <p className="text-sm text-muted">{t('release.tracks.none')}</p>
        ) : (
          <ol className="flex flex-col divide-y divide-border">
            {release.tracks.map((track) =>
              track.type === 'heading' ? (
                <li key={track.id} className="pt-4 pb-1 text-sm font-medium text-muted">
                  {track.title}
                </li>
              ) : (
                <li key={track.id} className="flex items-center gap-3 py-2">
                  <PlayButton kind="track" id={track.id} size="sm" />
                  <span className="w-10 shrink-0 text-xs text-muted">{track.position}</span>
                  <span className="flex-1">{track.title}</span>
                  <span className="text-xs text-muted">
                    {formatDuration(track.durationSeconds) || (
                      <span className="sr-only">{t('release.track.unknownDuration')}</span>
                    )}
                  </span>
                </li>
              ),
            )}
          </ol>
        )}
      </section>
    </main>
  );
}
