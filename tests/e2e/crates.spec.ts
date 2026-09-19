import { createHash, randomBytes } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL ?? '', { max: 2 });
const identities = ['test-crates-owner', 'test-crates-friend'];
const releaseId = (n: number) => `test-crates-release-${n}`;
const artistId = (n: number) => `99882210${n}`;
const editions = [
  { title: 'Aube Jazz', genres: ['Jazz', 'Blues'], year: 1998, country: 'France' },
  { title: 'Bleu Minuit', genres: ['Jazz'], year: 1998, country: 'Italy' },
  { title: 'Cercle Bleu', genres: ['Jazz'], year: 1984, country: 'Japan' },
  { title: 'Delta', genres: ['Jazz'], year: 1972, country: 'US' },
  { title: 'Échos électriques', genres: ['Electronic'], year: 1984, country: 'Germany' },
  { title: 'Disque sans métadonnées', genres: [], year: null, country: null },
  { title: 'Solo Atlantique', genres: ['Jazz'], year: 2003, country: 'Senegal' },
  { title: 'Disque retiré', genres: ['Jazz'], year: 1998, country: 'France' },
];
let ownerId: string;
let friendId: string;
let token: string;

async function cleanup() {
  await sql`delete from tasks where type = 'catalog.fetch_artist_origin' and payload->>'discogsArtistId' in ${sql(editions.map((_, index) => artistId(index + 1)))}`;
  await sql`delete from tasks where dedupe_key like 'discogs.fetch_statistics:test-crates-release-%'`;
  await sql`delete from users where discogs_user_id in ${sql(identities)}`;
  await sql`delete from discogs_releases where discogs_release_id in ${sql(editions.map((_, index) => releaseId(index + 1)))}`;
  await sql`delete from discogs_artists where discogs_artist_id in ${sql(editions.map((_, index) => artistId(index + 1)))}`;
}

async function chooseCrate(page: Page, label: RegExp) {
  const selector = page.getByRole('combobox', { name: 'Choisir un bac', exact: true });
  const option = selector.locator('option').filter({ hasText: label });
  await expect(option).toHaveCount(1);
  await selector.selectOption((await option.getAttribute('value'))!);
}

/** Vrais événements tactiles sur mobile, mêmes gestes à la souris sur desktop. */
async function dragCrate(page: Page, isMobile: boolean, dx: number, dy: number) {
  const scene = page.getByRole('region', { name: 'Bac à vinyle 3D', exact: true });
  await scene.scrollIntoViewIfNeeded();
  const bounds = (await scene.boundingBox())!;
  const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  if (isMobile) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...start, id: 1 }],
    });
    for (let step = 1; step <= 8; step++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: start.x + (dx * step) / 8, y: start.y + (dy * step) / 8, id: 1 }],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + dx, start.y + dy, { steps: 8 });
    await page.mouse.up();
  }
}

test.beforeAll(async () => {
  await cleanup();
  const [owner] =
    await sql`insert into users (discogs_user_id, discogs_username, spotify_enabled) values (${identities[0]!}, 'crates_owner', false) returning id`;
  const [friend] =
    await sql`insert into users (discogs_user_id, discogs_username, spotify_enabled) values (${identities[1]!}, 'crates_friend', false) returning id`;
  ownerId = owner!.id as string;
  friendId = friend!.id as string;
  await sql`insert into collection_shares (owner_id, grantee_id) values (${friendId}, ${ownerId})`;
  for (const [index, edition] of editions.entries()) {
    const number = index + 1;
    const [release] = await sql`insert into discogs_releases
      (discogs_release_id, title, artists_text, title_normalized, artists_normalized, genres,
        year, country, primary_image_url, details_fetched_at, statistics_fetched_at)
      values (${releaseId(number)}, ${edition.title}, 'Atelier Quartet', ${edition.title.toLowerCase()},
        'atelier quartet', ${edition.genres}, ${edition.year}, ${edition.country},
        ${number === 6 ? null : `https://i.discogs.com/test-crates-${number}.jpg`}, now(), now()) returning id`;
    const origins = number === 1 ? ['Senegal'] : edition.country ? [edition.country] : [];
    const [artist] =
      await sql`insert into discogs_artists (discogs_artist_id, name, name_normalized, origin_countries, origin_source_url, origin_checked_at, origin_next_check_at, origin_lookup_version)
      values (${artistId(number)}, 'Atelier Quartet', 'atelier quartet', ${origins}, ${origins.length ? 'https://www.wikidata.org/wiki/Q1' : null}, now(), now() + interval '30 days', 2) returning id`;
    await sql`insert into discogs_release_artists (release_id, artist_id, position) values (${release!.id}, ${artist!.id}, 0)`;
    await sql`insert into collection_instances (user_id, release_id, discogs_instance_id, date_added, is_active)
      values (${number === 7 ? friendId : ownerId}, ${release!.id}, ${`test-crates-instance-${number}`},
        ${new Date(Date.UTC(2026, 0, number))}, ${number !== 8})`;
    if (number === 1) {
      await sql`insert into collection_instances (user_id, release_id, discogs_instance_id, date_added)
        values (${ownerId}, ${release!.id}, 'test-crates-duplicate', ${new Date(Date.UTC(2026, 1, 1))})`;
    }
  }
  token = randomBytes(32).toString('base64url');
  await sql`insert into sessions (user_id, token_hash, expires_at) values
    (${ownerId}, ${createHash('sha256').update(token).digest('hex')}, ${new Date(Date.now() + 3_600_000)})`;
});

test.beforeEach(async ({ page }) => {
  await sql`update sessions set viewing_as_user_id = null where user_id = ${ownerId}`;
  await sql`update collection_instances set is_active = (discogs_instance_id <> 'test-crates-instance-8') where user_id = ${ownerId}`;
  await sql`update collection_shares set revoked_at = null where owner_id = ${friendId} and grantee_id = ${ownerId}`;
  await page
    .context()
    .addCookies([{ name: 'dp_session', value: token, domain: 'localhost', path: '/' }]);
  // Les pochettes sont interceptées avant le proxy : aucun fournisseur réel n'est appelé.
  await page.route('**/api/images/**', async (route) => {
    const number = Number(
      route
        .request()
        .url()
        .match(/test-crates-(\d+)/)?.[1] ?? 1,
    );
    const colors = ['#254a50', '#714532', '#66623e', '#374c70', '#634a69', '#786347', '#3d6051'];
    await route.fulfill({
      contentType: 'image/svg+xml',
      body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><rect width="600" height="600" fill="${colors[(number - 1) % colors.length]}"/><circle cx="300" cy="300" r="205" fill="#f4e4c3"/><circle cx="300" cy="300" r="138" fill="none" stroke="#151819" stroke-width="30"/><text x="300" y="325" fill="#151819" font-size="72" text-anchor="middle">${number}</text><text x="40" y="555" fill="#fff5df" font-size="32">ATELIER QUARTET</text></svg>`,
    });
  });
});

test.afterAll(async () => {
  await cleanup();
  await sql.end();
});

test('le suivi des origines progresse sans interrompre les pochettes et expose la source Discogs', async ({
  page,
}) => {
  await sql`update discogs_artists set origin_checked_at = null, origin_next_check_at = null where discogs_artist_id = ${artistId(6)}`;
  try {
    await page.goto('/bacs');
    await page
      .getByRole('combobox', { name: 'Ranger les bacs', exact: true })
      .selectOption('continent');
    await expect(page.getByText(/Artistes : 5 identifiés · 1 à rechercher/)).toBeVisible();
    await chooseCrate(page, /Origine inconnue/);
    await sql`update discogs_artists set origin_countries = ARRAY['South Africa'], origin_source_url = 'https://www.discogs.com/artist/5353905', origin_checked_at = now(), origin_next_check_at = now() + interval '30 days' where discogs_artist_id = ${artistId(6)}`;
    await sql`update tasks set status = 'completed' where type = 'catalog.fetch_artist_origin' and payload->>'discogsArtistId' = ${artistId(6)}`;
    await expect(page.getByText(/Artistes : 6 identifiés · 0 à rechercher/)).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByRole('heading', { name: 'Disque sans métadonnées', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Actualiser les bacs', exact: true }).click();
    await expect(
      page.getByText('6 disque(s) avec une origine sur 6', { exact: true }),
    ).toBeVisible();
    await chooseCrate(page, /Afrique/);
    await page.getByRole('button', { name: 'Disque suivant', exact: true }).click();
    await expect(
      page.getByRole('link', { name: 'Source de l’origine de l’artiste 1 sur Discogs' }),
    ).toHaveAttribute('href', 'https://www.discogs.com/artist/5353905');
    const response = await page.request.get('/api/collection/origins?userId=' + friendId);
    expect(await response.json()).toMatchObject({ ownerId, total: 6, known: 6 });
  } finally {
    await sql`update discogs_artists set origin_countries = ARRAY[]::text[], origin_source_url = null, origin_checked_at = now(), origin_next_check_at = now() + interval '1 day' where discogs_artist_id = ${artistId(6)}`;
  }
});

test('le header ouvre des bacs par genre, année ou continent sans doubler les exemplaires', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const header = page.getByRole('banner');
  const menu = header.getByRole('button', { name: 'Ouvrir le menu' });
  if (await menu.isVisible()) await menu.click();
  await header.getByRole('link', { name: 'Bac à vinyle', exact: true }).click();
  await expect(page).toHaveURL(/\/bacs$/);
  await expect(
    page.getByRole('heading', { name: 'Bac à vinyle', exact: true, level: 1 }),
  ).toBeVisible();
  const grouping = page.getByRole('combobox', { name: 'Ranger les bacs', exact: true });
  const position = page.getByRole('slider', { name: 'Parcourir le bac', exact: true });
  await expect(grouping).toHaveValue('genre');
  await chooseCrate(page, /Jazz/);
  await expect(position).toHaveAttribute('max', '4');
  await expect(page.getByRole('button', { name: 'Ouvrir Aube Jazz', exact: true })).toBeVisible();
  await grouping.selectOption('year');
  await chooseCrate(page, /1998/);
  await expect(position).toHaveAttribute('max', '2');
  await grouping.selectOption('continent');
  await chooseCrate(page, /Europe/);
  await expect(position).toHaveAttribute('max', '2');
  await chooseCrate(page, /Afrique/);
  await expect(page.getByRole('heading', { name: 'Aube Jazz', exact: true })).toBeVisible();
  await expect(page.getByText('Origine : Senegal')).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Source de l’origine de l’artiste 1 sur Wikidata' }),
  ).toHaveAttribute('href', 'https://www.wikidata.org/wiki/Q1');
  await page.screenshot({ path: testInfo.outputPath('artist-origins.png'), fullPage: true });
  await chooseCrate(page, /Origine inconnue/);
  await expect(position).toHaveAttribute('max', '1');
  await expect(
    page.getByRole('button', { name: 'Ouvrir Disque sans métadonnées', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Disque retiré', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Solo Atlantique', { exact: true })).toHaveCount(0);
  // A completed background enrichment becomes visible without reimporting the collection.
  await sql`update discogs_artists set origin_countries = ARRAY['Senegal'], origin_source_url = 'https://www.wikidata.org/wiki/Q2' where discogs_artist_id = ${artistId(6)}`;
  await page.getByRole('button', { name: 'Actualiser les bacs', exact: true }).click();
  await expect(
    page
      .getByRole('combobox', { name: 'Choisir un bac', exact: true })
      .locator('option')
      .filter({ hasText: /Origine inconnue/ }),
  ).toHaveCount(0);
  await chooseCrate(page, /Afrique/);
  await expect(position).toHaveAttribute('max', '2');
  await sql`update discogs_artists set origin_countries = ARRAY[]::text[], origin_source_url = null where discogs_artist_id = ${artistId(6)}`;
});

test('le scroll, le clavier et les boutons traversent les bacs dans les limites de la collection', async ({
  page,
}, testInfo) => {
  await page.goto('/bacs');
  await chooseCrate(page, /Jazz/);
  const scene = page.getByRole('region', { name: 'Bac à vinyle 3D', exact: true });
  const position = page.getByRole('slider', { name: 'Parcourir le bac', exact: true });
  const previous = page.getByRole('button', { name: 'Disque précédent', exact: true });
  const next = page.getByRole('button', { name: 'Disque suivant', exact: true });
  const crate = page.getByRole('combobox', { name: 'Choisir un bac', exact: true });
  await expect(previous).toBeEnabled();
  await previous.click();
  await expect(crate.locator('option:checked')).toContainText('Electronic');
  await expect(previous).toBeDisabled();
  await next.click();
  await expect(crate.locator('option:checked')).toContainText('Jazz');
  await expect(position).toHaveValue('1');
  await scene.hover();
  await page.mouse.wheel(0, 160);
  await expect(position).not.toHaveValue('1');
  await scene.focus();
  await page.keyboard.press('Home');
  await expect(position).toHaveValue('1');
  // Après une pause, les petits deltas d'un pavé tactile doivent encore s'additionner.
  await page.waitForTimeout(650);
  await scene.hover();
  // L'émulation mobile CDP exprime ces deltas en pixels physiques.
  const wheelScale =
    testInfo.project.name === 'mobile' ? await page.evaluate(() => devicePixelRatio) : 1;
  for (let step = 0; step < 5; step++) await page.mouse.wheel(0, 10 * wheelScale);
  await expect(position).toHaveValue('2');
  await scene.focus();
  await page.keyboard.press('Home');
  await expect(position).toHaveValue('1');
  await page.keyboard.press('ArrowRight');
  await expect(position).toHaveValue('2');
  await page.screenshot({ path: testInfo.outputPath('vinyl-flipped.png'), fullPage: true });
  await page.keyboard.press('ArrowLeft');
  await expect(position).toHaveValue('1');
  await page.keyboard.press('End');
  await expect(position).toHaveValue('4');
  await expect(next).toBeEnabled();
  await previous.click();
  await expect(position).toHaveValue('3');
  await next.click();
  await expect(position).toHaveValue('4');
  await next.click();
  await expect(crate.locator('option:checked')).toContainText('Genre non renseigné');
  await expect(position).toHaveValue('1');
  await expect(next).toBeDisabled();
  await previous.click();
  await expect(crate.locator('option:checked')).toContainText('Jazz');
  await expect(position).toHaveValue('4');
});

test('les glissements changent de pochette et un clic volontaire ouvre ensuite la fiche', async ({
  page,
  isMobile,
}) => {
  await page.goto('/bacs');
  await chooseCrate(page, /Jazz/);
  const scene = page.getByRole('region', { name: 'Bac à vinyle 3D', exact: true });
  const position = page.getByRole('slider', { name: 'Parcourir le bac', exact: true });
  for (const [dx, dy] of [
    [0, -120],
    [-120, 0],
  ]) {
    await scene.focus();
    await page.keyboard.press('Home');
    await expect(position).toHaveValue('1');
    await dragCrate(page, isMobile, dx!, dy!);
    await expect(position).not.toHaveValue('1');
    await expect(page).toHaveURL(/\/bacs$/);
    await expect(scene).not.toHaveAttribute('data-opening', 'true');
  }
  const active = scene.getByRole('button', { name: /^Ouvrir / });
  const title = (await active.getAttribute('aria-label'))!.slice('Ouvrir '.length);
  const selectedRelease = releaseId(editions.findIndex((edition) => edition.title === title) + 1);
  // Le prochain pointerdown doit autoriser ce clic après la capture du geste précédent.
  if (isMobile) await active.tap();
  else await active.click();
  await expect(page).toHaveURL(new RegExp(`/sorties/${selectedRelease}$`));
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
});

test('la pochette sort du bac avant la fiche et respecte la réduction des animations', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.install({ time: new Date('2026-09-18T10:00:00') });
  await page.goto('/bacs');
  await chooseCrate(page, /Jazz/);
  const cover = page.getByRole('img', { name: 'Aube Jazz, par Atelier Quartet', exact: true });
  await expect(cover).toHaveJSProperty('complete', true);
  await expect
    .poll(() => cover.evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await expect(cover).toHaveCSS('opacity', '1');
  await page.clock.pauseAt(new Date('2026-09-18T10:01:00'));
  const scene = page.getByRole('region', { name: 'Bac à vinyle 3D', exact: true });
  // L'horloge fige l'étape d'extraction sans dépendre des délais du poste ou de la CI.
  await page.getByRole('button', { name: 'Ouvrir Aube Jazz', exact: true }).dispatchEvent('click');
  await expect(scene).toHaveAttribute('data-opening', 'true');
  await expect(page).toHaveURL(/\/bacs$/);
  await page.clock.runFor(400);
  await expect(page).toHaveURL(/\/bacs$/);
  // L'horloge Playwright pilote la navigation, pas la chronologie CSS de la capture.
  await scene.evaluate((element) => {
    for (const animation of element.getAnimations({ subtree: true })) {
      if (animation instanceof CSSAnimation && animation.animationName.includes('pick-record')) {
        animation.pause();
        animation.currentTime = 400;
      }
    }
  });
  await page.screenshot({ path: testInfo.outputPath('vinyl-pickup.png'), fullPage: true });
  await scene.evaluate((element) => {
    for (const animation of element.getAnimations({ subtree: true })) {
      if (animation instanceof CSSAnimation && animation.animationName.includes('pick-record'))
        animation.play();
    }
  });
  await page.clock.runFor(300);
  await page.clock.resume();
  await expect(page).toHaveURL(new RegExp(`/sorties/${releaseId(1)}$`));
  await expect(page.getByRole('heading', { name: 'Aube Jazz', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/bacs$/);
  await expect(scene).toHaveAttribute('data-opening', 'false');
  await chooseCrate(page, /Jazz/);
  const sleeve = page.getByRole('button', { name: 'Ouvrir Aube Jazz', exact: true });
  await expect(sleeve).toBeEnabled();
  await sleeve.click();
  await expect(page).toHaveURL(new RegExp(`/sorties/${releaseId(1)}$`));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/bacs');
  await chooseCrate(page, /Jazz/);
  await page.clock.pauseAt(new Date('2026-09-18T10:02:00'));
  await page.getByRole('button', { name: 'Ouvrir Aube Jazz', exact: true }).dispatchEvent('click');
  // Aucune avancée d'horloge n'est nécessaire lorsque l'utilisateur réduit les mouvements.
  await expect(page).toHaveURL(new RegExp(`/sorties/${releaseId(1)}$`));
  await page.clock.resume();
});

test('les bacs suivent la collection du header et respectent les autorisations', async ({
  page,
  request,
}) => {
  const anonymous = await request.get('/bacs', { maxRedirects: 0 });
  expect(anonymous.status()).toBe(307);
  expect(anonymous.headers().location).toContain('/connexion');
  await page.goto(`/bacs?userId=${friendId}`);
  const switcher = page.getByRole('banner').getByRole('combobox', { name: 'Collection affichée' });
  await expect(switcher).toHaveValue(ownerId);
  await expect(page.getByText('Solo Atlantique', { exact: true })).toHaveCount(0);
  await switcher.selectOption(friendId);
  await expect(switcher).toHaveValue(friendId);
  await expect(
    page.getByRole('button', { name: 'Ouvrir Solo Atlantique', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Parcourir le bac', exact: true })).toHaveAttribute(
    'max',
    '1',
  );
  await sql`update collection_shares set revoked_at = now() where owner_id = ${friendId} and grantee_id = ${ownerId}`;
  await page.reload();
  await expect(switcher).toHaveValue(ownerId);
  await expect(page.getByText('Solo Atlantique', { exact: true })).toHaveCount(0);
});

test('le bac reste accessible sans débordement et traite une collection vide', async ({
  page,
}, testInfo) => {
  await page.goto('/bacs');
  await chooseCrate(page, /Jazz/);
  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    accessibility.violations.filter(
      (violation) => violation.impact === 'critical' || violation.impact === 'serious',
    ),
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('vinyl-crates.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 760 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('combobox', { name: 'Ranger les bacs', exact: true })).toBeVisible();
  await sql`update collection_instances set is_active = false where user_id = ${ownerId}`;
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Bac à vinyle', exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Parcourir le bac', exact: true })).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('link', { name: /Synchroniser/ })).toBeVisible();
});
