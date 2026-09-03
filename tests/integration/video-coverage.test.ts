/**
 * Couverture vidéo de la collection (demande produit 2026-09-03, section paramètres).
 *
 * Aucun appel réseau réel : la résolution testée vient d'une vidéo Discogs déjà connue,
 * appariée par titre sans passer par YouTube (§13.1 étape 3, comme `radio.test.ts`).
 */
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '@/db/client';
import { collectionInstances, discogsReleases, discogsTracks, users } from '@/db/schema';
import { upsertUserFromDiscogs } from '@/modules/auth/service';
import { applyReleaseDetails } from '@/modules/catalog/service';
import { getVideoCoverage } from '@/modules/collection/service';
import { resolveTrack } from '@/modules/resolution/service';

const ALICE = { id: 995_000_001, username: 'alice_coverage' };
const BOB = { id: 995_000_002, username: 'bob_coverage' };
const TOKENS = { token: 'jeton', tokenSecret: 'secret' };

/** Numérique, comme `applyReleaseDetails` l'exige (id Discogs réel) — voir `radio.test.ts`. */
const R = (n: number) => 9_950_000 + n;

async function cleanup() {
  await db.delete(users).where(inArray(users.discogsUserId, [String(ALICE.id), String(BOB.id)]));
  await db.delete(discogsReleases).where(
    inArray(
      discogsReleases.discogsReleaseId,
      Array.from({ length: 5 }, (_, i) => String(R(i + 1))),
    ),
  );
}

let aliceId: string;

beforeEach(async () => {
  await cleanup();
  aliceId = (await upsertUserFromDiscogs(ALICE, TOKENS)).id;
});

afterAll(async () => {
  await cleanup();
  await sql.end();
});

describe('getVideoCoverage', () => {
  it('ne compte rien pour une collection vide', async () => {
    expect(await getVideoCoverage(aliceId)).toEqual({
      totalTracks: 0,
      coveredTracks: 0,
      percent: 0,
    });
  });

  it('compte les pistes déjà résolues, sans en déclencher une seule pour calculer le chiffre', async () => {
    // Une édition à deux pistes, une seule appariée à une vidéo Discogs par le titre.
    const releaseId = await applyReleaseDetails({
      id: R(1),
      title: 'Album Test',
      artists: [{ id: 1, name: 'Artiste Test' }],
      tracklist: [
        { position: 'A1', title: 'Piste Connue', duration: '3:00', type_: 'track' },
        { position: 'A2', title: 'Piste Inconnue', duration: '3:00', type_: 'track' },
      ],
      videos: [
        {
          uri: 'https://www.youtube.com/watch?v=abc12345678',
          title: 'Artiste Test - Piste Connue',
          duration: 180,
        },
      ],
    });
    await db.insert(collectionInstances).values({
      userId: aliceId,
      releaseId,
      discogsInstanceId: '99500011',
      isActive: true,
    });

    // Avant toute lecture demandée : la simple présence dans la collection ne doit
    // rien compter comme couvert (§4.2, aucune résolution sans demande explicite).
    expect(await getVideoCoverage(aliceId)).toEqual({
      totalTracks: 2,
      coveredTracks: 0,
      percent: 0,
    });

    const [knownTrack] = await db
      .select({ id: discogsTracks.id })
      .from(discogsTracks)
      .where(eq(discogsTracks.title, 'Piste Connue'))
      .limit(1);

    // Une seule piste effectivement lue : c'est ce qui la fait compter, pas la vidéo
    // Discogs à elle seule.
    await resolveTrack(aliceId, knownTrack!.id);

    expect(await getVideoCoverage(aliceId)).toEqual({
      totalTracks: 2,
      coveredTracks: 1,
      percent: 50,
    });
  });

  it('exclut les headings et index tracks du dénominateur', async () => {
    const releaseId = await applyReleaseDetails({
      id: R(2),
      title: 'Album Avec Sections',
      artists: [{ id: 2, name: 'Artiste Test' }],
      tracklist: [
        { position: '', title: 'Face A', duration: '', type_: 'heading' },
        { position: 'A1', title: 'Seule Vraie Piste', duration: '3:00', type_: 'track' },
      ],
      videos: [],
    });
    await db.insert(collectionInstances).values({
      userId: aliceId,
      releaseId,
      discogsInstanceId: '99500021',
      isActive: true,
    });

    expect(await getVideoCoverage(aliceId)).toEqual({
      totalTracks: 1,
      coveredTracks: 0,
      percent: 0,
    });
  });

  it('reste isolée par collection : ne compte jamais les pistes d’un autre utilisateur', async () => {
    const bob = await upsertUserFromDiscogs(BOB, TOKENS);
    const releaseId = await applyReleaseDetails({
      id: R(3),
      title: 'Album De Bob',
      artists: [{ id: 3, name: 'Artiste Test' }],
      tracklist: [{ position: 'A1', title: 'Piste De Bob', duration: '3:00', type_: 'track' }],
      videos: [],
    });
    await db.insert(collectionInstances).values({
      userId: bob.id,
      releaseId,
      discogsInstanceId: '99500031',
      isActive: true,
    });

    expect(await getVideoCoverage(aliceId)).toEqual({
      totalTracks: 0,
      coveredTracks: 0,
      percent: 0,
    });

    await db.delete(users).where(eq(users.discogsUserId, String(BOB.id)));
  });

  it('ignore un exemplaire désactivé (retiré de la collection Discogs)', async () => {
    const releaseId = await applyReleaseDetails({
      id: R(4),
      title: 'Album Retiré',
      artists: [{ id: 4, name: 'Artiste Test' }],
      tracklist: [{ position: 'A1', title: 'Piste Retirée', duration: '3:00', type_: 'track' }],
      videos: [],
    });
    await db.insert(collectionInstances).values({
      userId: aliceId,
      releaseId,
      discogsInstanceId: '99500041',
      isActive: false,
    });

    expect(await getVideoCoverage(aliceId)).toEqual({
      totalTracks: 0,
      coveredTracks: 0,
      percent: 0,
    });
  });
});
