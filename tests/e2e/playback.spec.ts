/**
 * Lecture (SPECIFICATION.md §13, §14, §4.2, ADR-0006, ADR-0007).
 *
 * Deux albums de test : l'un avec une vidéo Discogs qui s'apparie au titre (résolution
 * gratuite, sans réseau), l'autre sans aucune vidéo (repli manuel — sans clé YouTube en
 * environnement de test, la recherche automatique échoue proprement et retombe sur ce
 * repli, ce que ce test vérifie explicitement).
 */
import { createHash, randomBytes } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL ?? '', { max: 2 });

const DISCOGS_USER_ID = '997000001';

let token: string;
let releaseWithVideoId: string;
let releaseWithoutVideoId: string;

async function cleanup() {
  await sql`delete from users where discogs_user_id = ${DISCOGS_USER_ID}`;
  await sql`delete from discogs_releases where discogs_release_id like 'test-9970%'`;
}

test.beforeAll(async () => {
  await cleanup();

  const [user] = await sql<{ id: string }[]>`
    insert into users (discogs_user_id, discogs_username)
    values (${DISCOGS_USER_ID}, 'e2e_playback')
    returning id
  `;
  const userId = user!.id;

  // Édition avec une vidéo Discogs dont le titre correspond à la piste : résolution
  // sans aucun appel réseau (§13.1 étape 3).
  const [releaseA] = await sql<{ id: string }[]>`
    insert into discogs_releases (
      discogs_release_id, title, artists_text, search_text, title_normalized, artists_normalized
    ) values (
      'test-9970001', 'Album Avec Vidéo', 'Artiste Test',
      'album avec video artiste test', 'album avec video', 'artiste test'
    )
    returning id
  `;
  releaseWithVideoId = 'test-9970001';

  await sql`
    insert into discogs_tracks (release_id, discogs_position, ordinal, title, title_normalized, type)
    values (${releaseA!.id}, 'A1', 0, 'Première Piste', 'premiere piste', 'track')
  `;
  // Une seconde piste, sur la même édition, sans aucune correspondance : reproduit le
  // scénario réel signalé — lire une piste résolue, puis une piste introuvable.
  await sql`
    insert into discogs_tracks (release_id, discogs_position, ordinal, title, title_normalized, type)
    values (${releaseA!.id}, 'A2', 1, 'Deuxième Piste Introuvable', 'deuxieme piste introuvable', 'track')
  `;
  await sql`
    insert into discogs_release_videos (release_id, url_canonical, provider, title)
    values (${releaseA!.id}, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            'youtube', 'Artiste Test - Première Piste (Official Video)')
  `;
  await sql`
    insert into collection_instances (user_id, release_id, discogs_instance_id)
    values (${userId}, ${releaseA!.id}, '99700011')
  `;

  // Édition sans vidéo : la résolution automatique échoue (pas de clé en test) et doit
  // retomber sur le repli manuel sans jamais planter (§13.1 étape 5).
  const [releaseB] = await sql<{ id: string }[]>`
    insert into discogs_releases (
      discogs_release_id, title, artists_text, search_text, title_normalized, artists_normalized
    ) values (
      'test-9970002', 'Album Sans Vidéo', 'Autre Artiste',
      'album sans video autre artiste', 'album sans video', 'autre artiste'
    )
    returning id
  `;
  releaseWithoutVideoId = 'test-9970002';

  await sql`
    insert into discogs_tracks (release_id, discogs_position, ordinal, title, title_normalized, type)
    values (${releaseB!.id}, 'A1', 0, 'Piste Sans Correspondance', 'piste sans correspondance', 'track')
  `;
  await sql`
    insert into collection_instances (user_id, release_id, discogs_instance_id)
    values (${userId}, ${releaseB!.id}, '99700021')
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

test('l’en-tête donne accès aux sections principales sans déborder', async ({ page }, testInfo) => {
  await signIn(page);
  await page.goto('/collection');

  const header = page.getByRole('banner');
  await expect(header.getByRole('link', { name: 'Accueil' })).toBeVisible();
  await expect(header.getByRole('link', { name: 'Collection' })).toBeVisible();
  await expect(header.getByRole('link', { name: 'Aléatoire' })).toBeVisible();
  await expect(header.getByRole('link', { name: 'Paramètres' })).toBeVisible();

  // Aucun débordement horizontal de la page (§20.1 : la nav défile dans son propre
  // conteneur plutôt que de casser la mise en page sur petit mobile).
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);

  await testInfo.attach(`header-${testInfo.project.name}`, {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('le bouton play d’un album résout depuis la vidéo Discogs, sans écran de disponibilité', async ({
  page,
}) => {
  await signIn(page);
  await page.goto(`/sorties/${releaseWithVideoId}`);

  // La fiche n'affiche plus de bloc "Disponibilité" : ce que la vidéo indique n'est
  // montré qu'une fois la lecture demandée, jamais avant (§4.2).
  await expect(page.getByText('vidéo(s) connue(s)')).toHaveCount(0);

  await page.getByRole('button', { name: 'Lire l’album' }).click();

  await expect(page.getByRole('region', { name: 'Lecture en cours' })).toBeVisible();
  await expect(page.getByText('Première Piste')).toBeVisible();
  await expect(page.getByText('Résolution en cours…')).toHaveCount(0, { timeout: 5_000 });
});

test('lire une piste sans correspondance juste après une piste résolue ne casse pas la page', async ({
  page,
}) => {
  // Reproduit le scénario réel signalé : sélectionner une piste résolue via l'API
  // YouTube (montage impératif d'un <iframe> hors de React), puis une piste sans
  // correspondance. La première version faisait planter React (`insertBefore` /
  // `NotFoundError`) parce que le nœud cible YouTube changeait de position dans le JSX
  // entre les deux états — voir `playback-context.tsx` et `player-bar.tsx`.
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await signIn(page);
  await page.goto(`/sorties/${releaseWithVideoId}`);

  const tracks = page.getByRole('button', { name: 'Lire cette piste' });
  await tracks.nth(0).click();

  await expect(page.getByRole('region', { name: 'Lecture en cours' })).toBeVisible();
  await expect(page.getByText('Première Piste')).toBeVisible();
  await expect(page.getByText('Résolution en cours…')).toHaveCount(0, { timeout: 5_000 });

  await tracks.nth(1).click();

  // Le repli manuel s'affiche pour la seconde piste, sans écran d'erreur Next.js et sans
  // laisser l'ancien lecteur tourner en arrière-plan.
  await expect(page.getByText('Cette piste n’a pas de correspondance connue.')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator('[id*="nextjs"]')).toHaveCount(0);
  await expect(page.getByText('Runtime')).toHaveCount(0);
  await expect(page.locator('iframe[src*="youtube.com"]')).toHaveCount(0);

  expect(pageErrors).toEqual([]);
});

test('sans correspondance connue, le repli manuel s’affiche sans planter', async ({ page }) => {
  await signIn(page);
  await page.goto(`/sorties/${releaseWithoutVideoId}`);

  await page.getByRole('button', { name: 'Lire cette piste' }).click();

  await expect(page.getByText('Cette piste n’a pas de correspondance connue.')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole('link', { name: 'Rechercher sur YouTube' })).toBeVisible();
  // Préférence Spotify non renseignée pour ce compte : pas de repli Spotify (ADR-0006).
  await expect(page.getByRole('link', { name: 'Rechercher sur Spotify' })).toHaveCount(0);
});

test('le bouton play d’une tuile ne navigue pas vers la fiche album', async ({ page }) => {
  await signIn(page);
  await page.goto('/collection');

  await page.getByLabel(/Rechercher/).fill('Album Avec Vidéo');
  await page.getByRole('button', { name: 'Lire l’album' }).first().click();

  // Toujours sur la collection : le clic sur play n'a pas suivi le lien de la tuile.
  await expect(page).toHaveURL(/\/collection/);
  await expect(page.getByRole('region', { name: 'Lecture en cours' })).toBeVisible();
});
