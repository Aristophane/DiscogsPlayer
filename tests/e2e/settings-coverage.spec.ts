/**
 * Couverture vidéo affichée dans les paramètres (demande produit 2026-09-03).
 *
 * Utilisateur et collection dédiés, isolés de `playback.spec.ts` : le chiffre dépend du
 * nombre cumulé de résolutions, fragile à partager avec des tests qui en créent d'autres.
 */
import { createHash, randomBytes } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL ?? '', { max: 2 });

const DISCOGS_USER_ID = '996000001';
const RELEASE_ID = 'test-9960001';

let token: string;

async function cleanup() {
  await sql`delete from users where discogs_user_id = ${DISCOGS_USER_ID}`;
  await sql`delete from discogs_releases where discogs_release_id = ${RELEASE_ID}`;
}

test.beforeAll(async () => {
  await cleanup();

  const [user] = await sql<{ id: string }[]>`
    insert into users (discogs_user_id, discogs_username)
    values (${DISCOGS_USER_ID}, 'e2e_coverage')
    returning id
  `;
  const userId = user!.id;

  const [release] = await sql<{ id: string }[]>`
    insert into discogs_releases (
      discogs_release_id, title, artists_text, search_text, title_normalized, artists_normalized
    ) values (
      ${RELEASE_ID}, 'Album Couverture', 'Artiste Couverture',
      'album couverture artiste couverture', 'album couverture', 'artiste couverture'
    )
    returning id
  `;
  const releaseId = release!.id;

  // Deux pistes, une seule appariée à une vidéo Discogs par le titre : résolution sans
  // aucun appel réseau (§13.1 étape 3), comme les autres specs e2e de lecture.
  await sql`
    insert into discogs_tracks (release_id, discogs_position, ordinal, title, title_normalized, type)
    values (${releaseId}, 'A1', 0, 'Piste Connue', 'piste connue', 'track')
  `;
  await sql`
    insert into discogs_tracks (release_id, discogs_position, ordinal, title, title_normalized, type)
    values (${releaseId}, 'A2', 1, 'Piste Inconnue', 'piste inconnue', 'track')
  `;
  await sql`
    insert into discogs_release_videos (release_id, url_canonical, provider, title)
    values (${releaseId}, 'https://www.youtube.com/watch?v=cov12345678',
            'youtube', 'Artiste Couverture - Piste Connue')
  `;
  await sql`
    insert into collection_instances (user_id, release_id, discogs_instance_id)
    values (${userId}, ${releaseId}, '99600011')
  `;

  token = randomBytes(32).toString('base64url');
  await sql`
    insert into sessions (user_id, token_hash, expires_at)
    values (${userId}, ${createHash('sha256').update(token).digest('hex')},
            ${new Date(Date.now() + 3_600_000)})
  `;
});

test.afterAll(async () => {
  await cleanup();
  await sql.end();
});

async function signIn(page: Page) {
  await page
    .context()
    .addCookies([{ name: 'dp_session', value: token, domain: 'localhost', path: '/' }]);
}

test('la couverture vidéo reflète les pistes réellement résolues, pas la simple présence d’une vidéo Discogs', async ({
  page,
}) => {
  await signIn(page);

  await page.goto('/parametres');
  await expect(page.getByRole('heading', { name: 'Couverture vidéo' })).toBeVisible();
  // Avant toute lecture : rien n'est encore résolu, malgré la vidéo Discogs déjà connue
  // (§4.2, aucune résolution sans demande explicite de lecture).
  await expect(page.getByText('0 % (0 sur 2 pistes)')).toBeVisible();

  // Une seule piste effectivement lue : c'est ce qui la fait compter.
  await page.goto(`/sorties/${RELEASE_ID}`);
  await page.getByRole('button', { name: 'Lire cette piste' }).first().click();
  await expect(page.getByRole('region', { name: 'Lecture en cours' })).toBeVisible();
  await expect(page.getByText('Résolution en cours…')).toHaveCount(0, { timeout: 5_000 });

  await page.goto('/parametres');
  await expect(page.getByText('50 % (1 sur 2 pistes)')).toBeVisible();
});
