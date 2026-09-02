/**
 * Accueil à trois entrées et mode Aléatoire (ADR-0006, §8.4).
 *
 * Le point vérifié ici que les tests d'intégration ne couvrent pas : RAND-006 côté
 * interface — un tirage n'ouvre aucun lecteur.
 */
import { createHash, randomBytes } from 'node:crypto';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL ?? '', { max: 2 });

const DISCOGS_USER_ID = '995000001';
const R = (n: number) => `test-9950${String(n).padStart(3, '0')}`;

const CATALOG = [
  { n: 1, title: 'Premier Album', artist: 'Artiste Un', genre: 'Rock' },
  { n: 2, title: 'Deuxième Album', artist: 'Artiste Deux', genre: 'Electronic' },
  { n: 3, title: 'Troisième Album', artist: 'Artiste Trois', genre: 'Rock' },
];

let token: string;

async function cleanup() {
  await sql`delete from users where discogs_user_id = ${DISCOGS_USER_ID}`;
  await sql`delete from discogs_releases where discogs_release_id like 'test-9950%'`;
}

test.beforeAll(async () => {
  await cleanup();

  const [user] = await sql<{ id: string }[]>`
    insert into users (discogs_user_id, discogs_username)
    values (${DISCOGS_USER_ID}, 'e2e_random')
    returning id
  `;

  for (const entry of CATALOG) {
    const [release] = await sql<{ id: string }[]>`
      insert into discogs_releases (
        discogs_release_id, title, genres, styles, artists_text,
        search_text, title_normalized, artists_normalized
      ) values (
        ${R(entry.n)}, ${entry.title}, ${sql.array([entry.genre])}, ${sql.array(['Test'])},
        ${entry.artist}, ${`${entry.title} ${entry.artist}`.toLowerCase()},
        ${entry.title.toLowerCase()}, ${entry.artist.toLowerCase()}
      )
      returning id
    `;

    await sql`
      insert into collection_instances (user_id, release_id, discogs_instance_id)
      values (${user!.id}, ${release!.id}, ${`9950${entry.n}`})
    `;
  }

  token = randomBytes(32).toString('base64url');
  await sql`
    insert into sessions (user_id, token_hash, expires_at)
    values (${user!.id}, ${createHash('sha256').update(token).digest('hex')},
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

test('l’accueil connecté propose les trois entrées', async ({ page }, testInfo) => {
  await signIn(page);
  await page.goto('/');

  // `main` exclut l'en-tête, qui porte désormais ses propres liens de même nom (Lot 6).
  const hub = page.getByRole('main');
  await expect(hub.getByRole('link', { name: /Collection/ })).toBeVisible();
  await expect(hub.getByRole('link', { name: /Aléatoire/ })).toBeVisible();

  // La radio est annoncée mais indisponible : elle dépend du Lot 6 (ADR-0006).
  const radio = page.getByText('Radio', { exact: true });
  await expect(radio).toBeVisible();
  await expect(page.getByText('Disponible une fois la lecture en place')).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const serious = results.violations.filter(
    (violation) => violation.impact === 'critical' || violation.impact === 'serious',
  );
  expect(serious.map((violation) => violation.id)).toEqual([]);

  await testInfo.attach(`accueil-${testInfo.project.name}`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});

test('un tirage affiche un album sans ouvrir de lecteur (RAND-006)', async ({ page }, testInfo) => {
  await signIn(page);
  await page.goto('/aleatoire');

  await expect(page.getByText('3 album(s) éligible(s)')).toBeVisible();

  await page.getByRole('button', { name: 'Tirer un album' }).click();
  await expect(page.getByRole('link', { name: 'Ouvrir la fiche' })).toBeVisible();

  // Le point de RAND-006 et PLAY-007 : aucun lecteur n'est monté par un tirage.
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.getByText('1 sur 3 vus dans cette session')).toBeVisible();

  await testInfo.attach(`aleatoire-${testInfo.project.name}`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});

test('la session s’épuise puis propose de recommencer (RAND-003, RAND-007)', async ({ page }) => {
  await signIn(page);
  await page.goto('/aleatoire');

  const titles: string[] = [];

  for (let index = 1; index <= 3; index += 1) {
    await page.getByRole('button', { name: /Tirer un/ }).click();

    // Attendre le compteur, et non la simple présence d'un album : sans cela, on lirait
    // encore le tirage précédent, toujours affiché pendant la requête.
    await expect(page.getByText(`${index} sur 3 vus dans cette session`)).toBeVisible();

    titles.push(
      (await page.getByRole('link', { name: 'Ouvrir la fiche' }).getAttribute('href')) ?? '',
    );
  }

  // Aucun album ne se répète dans une session.
  expect(new Set(titles).size).toBe(3);

  await page.getByRole('button', { name: /Tirer un/ }).click();
  await expect(page.getByText('Vous avez vu tous les albums éligibles.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Recommencer une session' })).toBeVisible();

  await page.getByRole('button', { name: 'Recommencer une session' }).click();
  await expect(page.getByRole('link', { name: 'Ouvrir la fiche' })).toBeVisible();
});

test('les filtres restreignent le périmètre du tirage (RAND-004)', async ({ page }) => {
  await signIn(page);
  await page.goto('/aleatoire');

  await page.getByRole('checkbox', { name: /Electronic/ }).check({ force: true });
  await page.getByRole('button', { name: 'Tirer un album' }).click();

  await expect(page.getByRole('heading', { name: 'Deuxième Album', level: 2 })).toBeVisible();
  await expect(page.getByText('1 sur 1 vus dans cette session')).toBeVisible();
});
