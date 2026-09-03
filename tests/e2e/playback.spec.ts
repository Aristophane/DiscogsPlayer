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
let releasePendingId: string;

async function cleanup() {
  await sql`delete from users where discogs_user_id = ${DISCOGS_USER_ID}`;
  await sql`delete from discogs_releases where discogs_release_id like 'test-9970%'`;
  // Sans FK vers `discogs_releases` : la tâche de récupération prioritaire (Lot 6bis)
  // déclenchée en visitant la fiche « en attente » doit être nettoyée à part.
  await sql`delete from tasks where dedupe_key like 'release:test-9970%'`;
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

  // Édition dont l'import en arrière-plan n'a pas encore ramené les pistes : aucune ligne
  // `discogs_tracks`, `details_fetched_at` laissé à `null` (Lot 6bis).
  const [releaseC] = await sql<{ id: string }[]>`
    insert into discogs_releases (
      discogs_release_id, title, artists_text, search_text, title_normalized, artists_normalized
    ) values (
      'test-9970003', 'Album En Attente', 'Artiste Attente',
      'album en attente artiste attente', 'album en attente', 'artiste attente'
    )
    returning id
  `;
  releasePendingId = 'test-9970003';

  await sql`
    insert into collection_instances (user_id, release_id, discogs_instance_id)
    values (${userId}, ${releaseC!.id}, '99700031')
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

test('le lecteur se replie sans interrompre la vidéo (Lot 6bis)', async ({ page }) => {
  await signIn(page);
  await page.goto(`/sorties/${releaseWithVideoId}`);
  await page.getByRole('button', { name: 'Lire l’album' }).click();

  const video = page.locator('iframe[src*="youtube.com"]');
  await expect(video).toBeVisible({ timeout: 10_000 });

  const toggle = page.getByRole('button', { name: 'Replier le lecteur' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  await toggle.click();

  await expect(page.getByRole('button', { name: 'Déplier le lecteur' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );

  // Rognée à hauteur nulle par l'ancêtre replié — la preuve directe du mécanisme, plus
  // fiable ici que `toBeVisible()` : Playwright ne détecte pas un rognage par overflow
  // d'un ancêtre, seulement la visibilité propre de l'élément (vérifié : un clic au
  // centre de l'iframe ne touche plus l'iframe une fois repliée, mais `toBeVisible()`
  // la rapporte quand même visible).
  await expect(page.locator('#player-bar-expandable')).toHaveCSS('height', '0px');
  // Toujours dans le DOM, pas démontée : contrairement à `display: none`, qui coupe la
  // lecture dans la plupart des navigateurs (voir le commentaire d'en-tête de
  // player-bar.tsx), le repli visuel seul laisse le son continuer.
  await expect(video).toBeAttached();
  await expect(video).toHaveAttribute('src', /youtube\.com/);

  // La piste reste identifiable même repliée : c'est le but du repli, pas une fermeture.
  await expect(page.getByText('Première Piste')).toBeVisible();

  await page.getByRole('button', { name: 'Déplier le lecteur' }).click();
  await expect(page.getByRole('button', { name: 'Replier le lecteur' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(page.locator('#player-bar-expandable')).not.toHaveCSS('height', '0px');
  await expect(video).toBeVisible();
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

test('une édition sans pistes encore chargées affiche l’attente, pas un vide silencieux (Lot 6bis)', async ({
  page,
}) => {
  await signIn(page);
  await page.goto(`/sorties/${releasePendingId}`);

  // Pas le message statique « pas encore chargée » (répondait avant à ce même cas) :
  // celui-ci suppose une action en cours, l'autre une simple lacune.
  await expect(page.getByText('Récupération des pistes en cours…')).toBeVisible();
  await expect(page.getByText('La liste des pistes n’est pas encore chargée.')).toHaveCount(0);

  // La visite a fait passer cette édition devant la file d'import (§9.4, Lot 6bis) : une
  // tâche existe, à une priorité strictement supérieure à celle de l'import ordinaire.
  const [task] = await sql<{ priority: number; status: string }[]>`
    select priority, status from tasks where dedupe_key = ${'release:' + releasePendingId}
  `;
  expect(task).toBeDefined();
  expect(task!.priority).toBeGreaterThan(0);
  expect(['queued', 'running', 'retry_wait']).toContain(task!.status);

  // Cliquer play pendant l'attente ne renvoie pas un échec immédiat : le lecteur reste en
  // chargement, avec un message propre à cette situation plutôt que le message générique.
  await page.getByRole('button', { name: 'Lire l’album' }).click();
  await expect(page.getByText('Récupération des pistes de l’album…')).toBeVisible();
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
