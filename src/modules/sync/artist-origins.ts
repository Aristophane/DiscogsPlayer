import { listCollectionOriginCandidates } from '@/modules/collection/crate-service';
import { enqueueBackgroundBatch } from './queue';

export async function requestCollectionArtistOrigins(userId: string): Promise<void> {
  await enqueueBackgroundBatch(
    'catalog.fetch_artist_origin',
    await listCollectionOriginCandidates(userId),
    'discogsArtistId',
  );
}
