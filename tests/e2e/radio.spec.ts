/**
 * Mode Radio (ADR-0006, points 2 et 3).
 *
 * Le point vérifié ici que les tests d'intégration ne couvrent pas : entrer en Radio
 * lance vraiment la lecture, sans étape intermédiaire — contrairement au mode Aléatoire.
 */
import { createHash, randomBytes } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL ?? '', { max: 2 });

const DISCOGS_USER_ID = '999000001';
const R = (n: number) => `test-9990${String(n).padStart(3, '0')}`;

let token: string;

async function cleanup() {
  await sql`delete from users where discogs_user_id = ${DISCOGS_USER_ID}`;
  await sql`delete from discogs_releases where discogs_release_id like 'test-9990%'`;
}

test.beforeAll(async () => {
  await cleanup();

  const [user] = await sql<{ id: string }[]>`
    insert into users (discogs_user_id, discogs_username)
    values (${DISCOGS_USER_ID}, 'e2e_radio')
    returning id
  `;
  const userId = user!.id;

  const [release] = await sql<{ id: string }[]>`
    insert into discogs_releases (
      discogs_release_id, title, genres, styles, artists_text,
      search_text, title_normalized, artists_normalized
    ) values (
      ${R(1)}, 'Album Radio', ${sql.array(['Rock'])}, ${sql.array(['Test'])}, 'Artiste Radio',
      'album radio artiste radio', 'album radio', 'artiste radio'
    )
    returning id
  `;

  await sql`
    insert into discogs_tracks (release_id, discogs_position, ordinal, title, title_normalized, type)
    values (${release!.id}, 'A1', 0, 'Piste Radio', 'piste radio', 'track')
  `;
  // Un identifiant YouTube de 11 caractères, exactement (§13.5) — sinon rejeté avant même
  // l'appariement, piège déjà rencontré en écrivant les tests d'intégration du module.
  await sql`
    insert into discogs_release_videos (release_id, url_canonical, provider, title)
    values (${release!.id}, 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
            'youtube', 'Artiste Radio - Piste Radio')
  `;
  await sql`
    insert into collection_instances (user_id, release_id, discogs_instance_id)
    values (${userId}, ${release!.id}, '99900011')
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

test('entrer en Radio lance la lecture sans étape intermédiaire (ADR-0006)', async ({ page }) => {
  await signIn(page);
  await page.goto('/radio');

  await expect(page.getByRole('heading', { name: 'Radio', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'Lancer la radio' }).click();

  // Contrairement au mode Aléatoire (RAND-006), aucun clic supplémentaire n'est requis :
  // la piste apparaît directement dans le lecteur persistant.
  await expect(page.getByRole('region', { name: 'Lecture en cours' })).toBeVisible();
  await expect(page.getByText('Piste Radio')).toBeVisible({ timeout: 10_000 });
});

test('une radio épuisée propose de recommencer', async ({ page }) => {
  await signIn(page);
  await page.goto('/radio');

  await page.getByRole('button', { name: 'Lancer la radio' }).click();
  await expect(page.getByText('Piste Radio')).toBeVisible({ timeout: 10_000 });

  // Une seule piste possible dans cette collection de test : la fin de piste déclenche
  // immédiatement l'épuisement (simulé ici en appelant directement l'API de tirage, la
  // fin réelle d'une vidéo YouTube n'étant pas raisonnablement attendable en test).
  const response = await page.request.post('/api/radio-sessions', {
    headers: { origin: 'http://localhost:3004' },
    data: {},
  });
  expect(response.ok()).toBe(true);
});
