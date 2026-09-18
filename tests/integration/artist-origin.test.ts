import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from '@/db/client';
import { getCrateCollection } from '@/modules/collection/crate-service';
import { requestCollectionArtistOrigins } from '@/modules/sync/artist-origins';
import { runTask } from '@/modules/sync/handlers';
import { ArtistOriginError } from '@/modules/providers/wikidata/artist-origin';
import { groupCrateRecords } from '@/modules/collection/crate';

const artistIds = ['998811001', '998811002', '998811003'];
const releaseIds = ['test-origin-eu', 'test-origin-jp', 'test-origin-collab', 'test-origin-other'];
let owner: string;
let friend: string;
async function cleanup() {
  await sql`delete from tasks where type = 'catalog.fetch_artist_origin' and payload->>'discogsArtistId' in ${sql(artistIds)}`;
  await sql`delete from users where discogs_user_id in ('test-origin-owner', 'test-origin-friend')`;
  await sql`delete from discogs_releases where discogs_release_id in ${sql(releaseIds)}`;
  await sql`delete from discogs_artists where discogs_artist_id in ${sql(artistIds)}`;
}
beforeEach(async () => {
  await cleanup();
  const people =
    await sql`insert into users (discogs_user_id, discogs_username) values ('test-origin-owner', 'Owner'), ('test-origin-friend', 'Friend') returning id`;
  owner = people[0]!.id as string;
  friend = people[1]!.id as string;
  const artists =
    await sql`insert into discogs_artists (discogs_artist_id, name, name_normalized) values
    (${artistIds[0]!}, 'Musicien', 'musicien'), (${artistIds[1]!}, 'Collaboration', 'collaboration'), (${artistIds[2]!}, 'Autre collection', 'autre') returning id`;
  for (const [index, id] of releaseIds.entries()) {
    const [release] =
      await sql`insert into discogs_releases (discogs_release_id, title, country) values (${id}, ${id}, ${index === 1 ? 'Japan' : 'France'}) returning id`;
    await sql`insert into collection_instances (user_id, release_id, discogs_instance_id) values (${index === 3 ? friend : owner}, ${release!.id}, ${id})`;
    await sql`insert into discogs_release_artists (release_id, artist_id, position) values (${release!.id}, ${artists[index === 3 ? 2 : 0]!.id}, 0)`;
    if (index === 2)
      await sql`insert into discogs_release_artists (release_id, artist_id, position) values (${release!.id}, ${artists[1]!.id}, 1)`;
    if (index === 0)
      await sql`insert into collection_instances (user_id, release_id, discogs_instance_id) values (${friend}, ${release!.id}, 'shared-edition')`;
  }
});
afterAll(async () => {
  await cleanup();
  await sql.end();
});
const task = (id: string) => ({
  id: '00000000-0000-0000-0000-000000000001',
  type: 'catalog.fetch_artist_origin',
  payload: { discogsArtistId: id },
  attemptCount: 1,
  maxAttempts: 5,
});

describe('enrichissement partagé des origines', () => {
  it('enfile uniquement les artistes actifs de la collection et déduplique les éditions/visites', async () => {
    await requestCollectionArtistOrigins(owner);
    await requestCollectionArtistOrigins(owner);
    const queued =
      await sql`select payload from tasks where type = 'catalog.fetch_artist_origin' and payload->>'discogsArtistId' in ${sql(artistIds)}`;
    expect(queued.map((row) => row.payload.discogsArtistId).sort()).toEqual(artistIds.slice(0, 2));
  });
  it('classe un artiste africain en Afrique pour deux pressages et partage les résultats avec un ami', async () => {
    const api = {
      lookup: vi.fn().mockResolvedValue({
        countries: ['Senegal'],
        sourceUrl: 'https://www.wikidata.org/wiki/Q1',
      }),
    };
    await runTask(task(artistIds[0]!), undefined, api);
    await runTask(task(artistIds[0]!), undefined, api);
    expect(api.lookup).toHaveBeenCalledTimes(1);
    const own = await getCrateCollection(owner);
    expect(
      groupCrateRecords(own, 'continent').find((group) => group.id === 'continent:africa')?.items,
    ).toHaveLength(2);
    expect(
      own.find((record) => record.discogsReleaseId === releaseIds[2])?.originCountries,
    ).toBeNull();
    expect(
      (await getCrateCollection(friend)).find((record) => record.discogsReleaseId === releaseIds[0])
        ?.originCountries,
    ).toEqual(['Senegal']);
    await runTask(task(artistIds[1]!), undefined, {
      lookup: async () => ({
        countries: ['France'],
        sourceUrl: 'https://www.wikidata.org/wiki/Q2',
      }),
    });
    expect(
      groupCrateRecords(await getCrateCollection(owner), 'continent').find(
        (group) => group.id === 'continent:international',
      )?.items,
    ).toHaveLength(1);
    await requestCollectionArtistOrigins(owner);
    expect(
      await sql`select id from tasks where type = 'catalog.fetch_artist_origin' and payload->>'discogsArtistId' in ${sql(artistIds)}`,
    ).toHaveLength(0);
  });
  it('met en cache une origine inconnue et conserve les données précédentes en cas de panne', async () => {
    await runTask(task(artistIds[0]!), undefined, {
      lookup: async () => ({ countries: [], sourceUrl: null }),
    });
    const lookup = vi.fn();
    await runTask(task(artistIds[0]!), undefined, { lookup });
    expect(lookup).not.toHaveBeenCalled();
    await sql`update discogs_artists set origin_countries = ARRAY['Senegal'], origin_source_url = 'https://www.wikidata.org/wiki/Q1', origin_checked_at = now() - interval '31 days' where discogs_artist_id = ${artistIds[0]!}`;
    await expect(
      runTask(task(artistIds[0]!), undefined, {
        lookup: async () => {
          throw new ArtistOriginError(true);
        },
      }),
    ).rejects.toThrow();
    const [artist] =
      await sql`select origin_countries, origin_next_check_at from discogs_artists where discogs_artist_id = ${artistIds[0]!}`;
    expect(artist!.origin_countries).toEqual(['Senegal']);
    expect(new Date(artist!.origin_next_check_at).getTime()).toBeGreaterThan(Date.now());
    await requestCollectionArtistOrigins(owner);
    const queued =
      await sql`select payload from tasks where type = 'catalog.fetch_artist_origin' and payload->>'discogsArtistId' in ${sql(artistIds)}`;
    expect(queued.map((row) => row.payload.discogsArtistId)).toEqual([artistIds[1]]);
  });
});
