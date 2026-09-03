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
  // Sous `sm:`, les liens sont dans un panneau replié par défaut (Lot 6bis) : l'ouvrir
  // avant de vérifier leur présence. Ce bouton n'existe pas dans l'arbre d'accessibilité
  // visible au-dessus de `sm:` (`sm:hidden`) — la nav horizontale y suffit déjà.
  const menuToggle = header.getByRole('button', { name: 'Ouvrir le menu' });
  if (await menuToggle.isVisible()) {
    await menuToggle.click();
  }

  await expect(header.getByRole('link', { name: 'Accueil' })).toBeVisible();
  await expect(header.getByRole('link', { name: 'Collection' })).toBeVisible();
  await expect(header.getByRole('link', { name: 'Aléatoire' })).toBeVisible();
  await expect(header.getByRole('link', { name: 'Radio' })).toBeVisible();
  await expect(header.getByRole('link', { name: 'Paramètres' })).toBeVisible();

  // Aucun débordement horizontal de la page (§20.1), avec ou sans le panneau ouvert.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);

  await testInfo.attach(`header-${testInfo.project.name}`, {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('le menu mobile de l’en-tête liste tout sans défilement caché (Lot 6bis)', async ({
  page,
}) => {
  // 320 px : sous `sm:` (640 px), pas le préréglage « mobile » (Pixel 7, 412 px). C'est
  // à cette largeur que le défaut a été mesuré — la nav horizontale précédente exigeait
  // ~200 px de défilement pour atteindre « Radio » et « Paramètres », hors écran par
  // défaut, sans autre indice visuel qu'un léger dégradé.
  await page.setViewportSize({ width: 320, height: 700 });
  await signIn(page);
  await page.goto('/collection');

  const header = page.getByRole('banner');
  await expect(header.getByRole('link', { name: 'Radio' })).toHaveCount(0);

  const toggle = header.getByRole('button', { name: 'Ouvrir le menu' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();

  await expect(header.getByRole('button', { name: 'Fermer le menu' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  // Les cinq liens, tous visibles d'un coup, sans avoir à défiler.
  for (const name of ['Accueil', 'Collection', 'Aléatoire', 'Radio', 'Paramètres']) {
    await expect(header.getByRole('link', { name })).toBeVisible();
  }

  await header.getByRole('link', { name: 'Radio' }).click();
  await expect(page).toHaveURL(/\/radio/);
  // La navigation referme le panneau (filet de sécurité par changement de route).
  await expect(header.getByRole('button', { name: 'Ouvrir le menu' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
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

test('le lecteur survit à une navigation vers Radio depuis l’accueil (SPEC-GAPS G-17)', async ({
  page,
}) => {
  // Défaut réel constaté le 2026-09-03 : la tuile Radio de l'accueil (et plusieurs
  // autres liens internes) étaient de simples `<a>`, qui déclenchent une navigation
  // plein document — celle-ci démonte tout le layout racine, lecteur persistant y
  // compris, au lieu d'une navigation côté client qui le laisse en place.
  await signIn(page);
  await page.goto(`/sorties/${releaseWithVideoId}`);
  await page.getByRole('button', { name: 'Lire l’album' }).click();

  const player = page.getByRole('region', { name: 'Lecture en cours' });
  await expect(player).toBeVisible();
  // Le titre de piste n'apparaît dans le lecteur que si la résolution le fournit ; ce
  // qui identifie la lecture en cours de façon fiable, ici comme après la navigation,
  // c'est le titre de l'édition, toujours renseigné.
  await expect(player.getByText('Album Avec Vidéo')).toBeVisible();

  // `page.goto` déclenche lui-même une vraie navigation plein document — pas ce qu'on
  // veut vérifier ici. On rejoint l'accueil par un clic sur un lien déjà à l'écran,
  // pour rester dans une navigation côté client de bout en bout.
  await page.getByRole('link', { name: 'Discogs Player' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(player).toBeVisible();

  // La tuile de l'accueil, pas le lien « Radio » de l'en-tête (même libellé, deux
  // liens) : c'est elle qui causait le défaut, scopée via `<main>` pour la distinguer.
  await page.locator('main').getByRole('link', { name: /Radio/ }).click();

  await expect(page).toHaveURL(/\/radio$/);
  // Toujours visible, avec la même piste : une navigation plein document aurait tout
  // réinitialisé (le lecteur redémarre à `idle`, sans rien en cours).
  await expect(player).toBeVisible();
  await expect(player.getByText('Album Avec Vidéo')).toBeVisible();
});

test('sur petit mobile, les boutons du lecteur passent sous le titre plutôt que de l’écraser', async ({
  page,
}) => {
  // 320 px, pas le préréglage « mobile » (Pixel 7, plus large) : c'est à cette largeur —
  // toujours courante (iPhone SE) — que le défaut a été mesuré. Quatre boutons (son,
  // suivant, replier, fermer) sur la même ligne que la pochette et le titre ne
  // laissaient plus que 46 px au titre, tronqué à 3-4 caractères.
  await page.setViewportSize({ width: 320, height: 690 });
  await signIn(page);
  await page.goto(`/sorties/${releaseWithVideoId}`);
  await page.getByRole('button', { name: 'Lire l’album' }).click();

  const title = page
    .getByRole('region', { name: 'Lecture en cours' })
    .locator('p.truncate')
    .first();
  await expect(title).toBeVisible({ timeout: 10_000 });

  const box = await title.boundingBox();
  expect(box).not.toBeNull();
  // Largement au-dessus des ~46 px mesurés avant correction ; sous ~360 px de large de
  // conteneur, un titre normal ne devrait plus jamais être écrasé à ce point.
  expect(box!.width).toBeGreaterThan(150);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test('la vidéo dépliée remplit son cadre sans déborder (Lot 6bis)', async ({ page }) => {
  await signIn(page);
  await page.goto(`/sorties/${releaseWithVideoId}`);
  await page.getByRole('button', { name: 'Lire l’album' }).click();

  const container = page.locator('.youtube-player-container');
  const video = page.locator('iframe[src*="youtube.com"]');
  await expect(video).toBeVisible({ timeout: 10_000 });

  const containerBox = await container.boundingBox();
  const videoBox = await video.boundingBox();
  expect(containerBox).not.toBeNull();
  expect(videoBox).not.toBeNull();

  // L'API YouTube crée l'iframe avec des dimensions par défaut (640×360 en dur) : sans
  // la règle CSS dédiée (globals.css), elle déborde de son cadre 16:9 au lieu de s'y
  // adapter — défaut réel observé, visible à l'écran comme une vidéo rognée. Tolérance
  // d'un pixel pour l'arrondi sous-pixel.
  expect(Math.abs(videoBox!.width - containerBox!.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(videoBox!.height - containerBox!.height)).toBeLessThanOrEqual(1);
});

test('le bouton de volume coupe puis rétablit le son de la vidéo', async ({ page }) => {
  await signIn(page);
  await page.goto(`/sorties/${releaseWithVideoId}`);
  await page.getByRole('button', { name: 'Lire l’album' }).click();
  await expect(page.locator('iframe[src*="youtube.com"]')).toBeVisible({ timeout: 10_000 });

  const button = page.getByRole('button', { name: 'Couper le son' });
  await expect(button).toHaveAttribute('aria-pressed', 'false');

  await button.click();

  const unmute = page.getByRole('button', { name: 'Rétablir le son' });
  await expect(unmute).toHaveAttribute('aria-pressed', 'true');

  await unmute.click();
  await expect(page.getByRole('button', { name: 'Couper le son' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test('le bouton « piste suivante » avance dans l’album', async ({ page }) => {
  await signIn(page);
  await page.goto(`/sorties/${releaseWithVideoId}`);
  await page.getByRole('button', { name: 'Lire l’album' }).click();
  await expect(page.getByText('Première Piste')).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: 'Piste suivante' }).click();

  // La seconde piste de cette édition n'a pas de correspondance connue (fixture) : le
  // repli manuel apparaît, preuve que le bouton a bien avancé plutôt que de rejouer la
  // même piste.
  await expect(page.getByText('Cette piste n’a pas de correspondance connue.')).toBeVisible({
    timeout: 10_000,
  });
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

test('« Now Spinning » apparaît pendant la lecture, même le lecteur replié, et s’ouvre en plein écran', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/collection');

  // Rien avant toute lecture : « pendant la lecture » (demande produit), pas en
  // permanence.
  const disc = page.getByRole('button', { name: 'Afficher « Now Spinning » en plein écran' });
  await expect(disc).toHaveCount(0);

  await page.goto(`/sorties/${releaseWithVideoId}`);
  await page.getByRole('button', { name: 'Lire l’album' }).click();
  await expect(page.getByRole('region', { name: 'Lecture en cours' })).toBeVisible();

  await expect(disc).toBeVisible();

  // Replier la barre du lecteur ne doit pas faire disparaître le disque d'ambiance :
  // c'est justement l'intérêt de le sortir de la barre elle-même.
  await page.getByRole('button', { name: 'Replier le lecteur' }).click();
  await expect(disc).toBeVisible();

  await disc.click();

  const fullscreenRegion = page.getByRole('region', { name: 'Now Spinning' });
  await expect(fullscreenRegion).toBeVisible();
  // Le titre de piste n'est affiché que si la résolution le fournit ; le titre de
  // l'édition, lui, est toujours renseigné (voir le test de persistance ci-dessus).
  await expect(fullscreenRegion.getByText('Album Avec Vidéo')).toBeVisible();

  await fullscreenRegion.getByRole('button', { name: 'Quitter le plein écran' }).click();
  await expect(fullscreenRegion).toHaveCount(0);
  // Le disque d'ambiance reste affiché après la sortie du plein écran.
  await expect(disc).toBeVisible();
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
