import {
  getCollectionOriginArtists,
  listCollectionOriginCandidates,
} from '@/modules/collection/crate-service';
import type { OriginProgress } from '@/modules/collection/origin-progress';
import { enqueueBackgroundBatch, getArtistOriginTaskStates } from './queue';

export async function requestCollectionArtistOrigins(userId: string): Promise<void> {
  await enqueueBackgroundBatch(
    'catalog.fetch_artist_origin',
    await listCollectionOriginCandidates(userId),
    'discogsArtistId',
  );
}

export async function getCollectionOriginProgress(userId: string): Promise<OriginProgress> {
  const artists = await getCollectionOriginArtists(userId);
  const states = new Map(
    (
      await getArtistOriginTaskStates(artists.flatMap((artist) => (artist.id ? [artist.id] : [])))
    ).map((task) => [task.key, task]),
  );
  const progress: OriginProgress = {
    ownerId: userId,
    total: artists.length,
    known: 0,
    pending: 0,
    unavailable: 0,
    failed: 0,
    workerUpdateRequired: false,
  };
  for (const artist of artists) {
    const task = states.get(`catalog.fetch_artist_origin:${artist.id}`);
    if (artist.countries.length) progress.known++;
    else if (task?.status === 'failed' || task?.status === 'retry_wait') {
      progress.failed++;
      if (task.errorCode === 'TASK_TYPE_UNKNOWN') progress.workerUpdateRequired = true;
    } else if (
      task?.status === 'queued' ||
      task?.status === 'running' ||
      !artist.checkedAt ||
      artist.version < 2
    )
      progress.pending++;
    else progress.unavailable++;
  }
  return progress;
}
