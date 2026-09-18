import { createHash, randomBytes } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL ?? '', { max: 2 });
const identities = ['test-stats-owner', 'test-stats-friend'];
const R = (n: number) => `test-stats-release-${n}`;
let ownerId: string;
let friendId: string;
let token: string;

async function cleanup() {
  await sql`delete from tasks where dedupe_key like 'discogs.fetch_statistics:test-stats-release-%'`;
  await sql`delete from users where discogs_user_id in ${sql(identities)}`;
  await sql`delete from discogs_releases where discogs_release_id in ${sql(Array.from({ length: 13 }, (_, i) => R(i + 1)))}`;
}

test.beforeAll(async () => {
  await cleanup();
  const [owner] =
    await sql`insert into users (discogs_user_id, discogs_username, spotify_enabled) values (${identities[0]!}, 'stats_owner', false) returning id`;
  const [friend] =
    await sql`insert into users (discogs_user_id, discogs_username, spotify_enabled) values (${identities[1]!}, 'stats_friend', false) returning id`;
  ownerId = owner!.id as string;
  friendId = friend!.id as string;
  await sql`insert into collection_shares (owner_id, grantee_id) values (${friendId}, ${ownerId})`;
  for (let n = 1; n <= 13; n++) {
    const [release] = await sql`insert into discogs_releases
      (discogs_release_id, title, artists_text, title_normalized, community_have, community_want, lowest_price_eur, num_for_sale, details_fetched_at, statistics_fetched_at)
      values (${R(n)}, ${n === 7 ? 'Album de mon ami' : `Édition ${n}`}, 'Artiste des statistiques', ${`edition ${n}`},
      ${n === 1 ? null : n * 10}, ${n === 1 ? 0 : n * 100}, ${n * 25.5}, 2, now(), now()) returning id`;
    await sql`insert into collection_instances (user_id, release_id, discogs_instance_id, date_added) values
      (${n >= 7 ? friendId : ownerId}, ${release!.id}, ${`test-stats-instance-${n}`}, ${new Date(Date.UTC(2026, 0, 20 - n))})`;
  }
  token = randomBytes(32).toString('base64url');
  await sql`insert into sessions (user_id, token_hash, expires_at) values
    (${ownerId}, ${createHash('sha256').update(token).digest('hex')}, ${new Date(Date.now() + 3_600_000)})`;
});

test.beforeEach(async ({ page }) => {
  await sql`update sessions set viewing_as_user_id = null where user_id = ${ownerId}`;
  await sql`update collection_instances set is_active = true where user_id = ${ownerId}`;
  await sql`update discogs_releases set statistics_fetched_at = now(), community_want = 0, lowest_price_eur = 25.5 where discogs_release_id = ${R(1)}`;
  await sql`update collection_shares set revoked_at = null where owner_id = ${friendId} and grantee_id = ${ownerId}`;
  await page
    .context()
    .addCookies([{ name: 'dp_session', value: token, domain: 'localhost', path: '/' }]);
});

test.afterAll(async () => {
  await cleanup();
  await sql.end();
});

test('les tops personnels sont classés, accessibles et sans débordement', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const wanted = page.getByRole('region', { name: 'Les plus wanted', exact: true });
  const valuable = page.getByRole('region', {
    name: 'Les mieux valorisés à la vente',
    exact: true,
  });
  await expect(wanted.getByRole('listitem')).toHaveCount(5);
  await expect(valuable.getByRole('listitem')).toHaveCount(5);
  await expect(wanted.getByRole('listitem').first()).toContainText('Édition 6');
  await expect(valuable.getByRole('listitem').first()).toContainText('153,00');
  await expect(wanted.getByText('Album de mon ami')).toHaveCount(0);
  await expect(page.getByText(/ne représente pas une vente conclue/)).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect(page.getByText(/Actualisation terminée/)).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('link', { name: 'Paramètres' })).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('navigation')).toHaveCount(0);
  await expect(wanted.getByRole('listitem')).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    accessibility.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious'),
  ).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('home-statistics.png'), fullPage: true });
  await wanted.getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: 'Édition 6', exact: true })).toBeVisible();
  await expect(page.getByText('En collection', { exact: true })).toBeVisible();
  await expect(page.getByText('En wantlist', { exact: true })).toBeVisible();
});

test('les classements et la barre progressent automatiquement toutes les cinq secondes', async ({
  page,
}) => {
  await sql`update discogs_releases set statistics_fetched_at = now() - interval '25 hours' where discogs_release_id = ${R(1)}`;
  let polls = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/collection/highlights')) polls++;
  });
  await page.goto('/');
  const progress = page.getByRole('progressbar', {
    name: 'Actualisation des valeurs de la collection',
  });
  await expect(progress).toHaveAttribute('aria-valuenow', '5');
  await expect(progress).toHaveAttribute('aria-valuemax', '6');
  await expect(page.getByText(/Mise à jour des classements dans \d s/)).toBeVisible();
  const spotlight = page.getByRole('region', { name: 'Un disque au hasard', exact: true });
  await expect(spotlight.getByRole('link')).toBeVisible();
  const suggested = await spotlight.getByRole('link').getAttribute('href');
  await sql`update discogs_releases set statistics_fetched_at = now(), community_want = 9999, lowest_price_eur = 9999 where discogs_release_id = ${R(1)}`;
  await expect(progress).toHaveCount(0, { timeout: 12_000 });
  for (const title of ['Les plus wanted', 'Les mieux valorisés à la vente']) {
    await expect(
      page.getByRole('region', { name: title, exact: true }).getByRole('listitem').first(),
    ).toContainText('Édition 1');
  }
  await expect(spotlight.getByRole('link')).toHaveAttribute('href', suggested!);
  const completedPolls = polls;
  await page.waitForTimeout(5500);
  expect(polls).toBe(completedPolls);
  expect(polls).toBeGreaterThan(0);
});

test('la suggestion change au rafraîchissement et au clic sur un autre disque', async ({
  page,
}) => {
  await page.goto('/');
  const spotlight = page.getByRole('region', { name: 'Un disque au hasard', exact: true });
  await expect(spotlight.getByRole('link')).toBeVisible();
  const first = await spotlight.getByRole('link').getAttribute('href');
  await page.reload();
  await expect(spotlight.getByRole('link')).toBeVisible();
  const second = await spotlight.getByRole('link').getAttribute('href');
  expect(second).not.toBe(first);
  await spotlight.getByRole('button', { name: 'Un autre disque' }).click();
  await expect(spotlight.getByRole('link')).not.toHaveAttribute('href', second!);
});

test('le fil ouvre la collection de l’ami et disparaît après révocation', async ({ page }) => {
  await page.goto('/');
  const activity = page.getByRole('region', { name: 'Dans les bacs de vos amis' });
  await expect(activity.getByText('stats_friend a ajouté à sa collection')).toHaveCount(6);
  await activity.getByRole('button', { name: /Album de mon ami/ }).click();
  await expect(page.getByRole('heading', { name: 'Album de mon ami', exact: true })).toBeVisible();
  await expect(page.getByText('Vous consultez la collection de stats_friend.')).toBeVisible();
  await sql`update collection_shares set revoked_at = now() where owner_id = ${friendId} and grantee_id = ${ownerId}`;
  await page.goto('/');
  await expect(activity.getByText('Album de mon ami')).toHaveCount(0);
  await expect(activity.getByRole('link', { name: 'Voir mes amis' })).toBeVisible();
});

test('les nouvelles API exigent une session et ignorent un propriétaire fourni par le client', async ({
  page,
  request,
}) => {
  for (const path of ['highlights', 'spotlight']) {
    expect((await request.get(`/api/collection/${path}`)).status()).toBe(401);
  }
  const response = await page.request.get(`/api/collection/highlights?userId=${friendId}`);
  expect(response.status()).toBe(200);
  expect((await response.json()).total).toBe(6);
});

test('les compteurs figurent sur chaque album, avec zéro distinct d’inconnu', async ({ page }) => {
  await page.goto('/collection');
  const albumList = page.getByRole('main').getByRole('list').first();
  await expect(albumList.getByText('En collection', { exact: true })).toHaveCount(6);
  await expect(albumList.getByText('En wantlist', { exact: true })).toHaveCount(6);
  const album = albumList.getByRole('listitem').filter({ hasText: 'Édition 1' });
  await expect(album.getByLabel('Donnée indisponible')).toBeVisible();
  await expect(album.locator('dd').last()).toHaveText('0');
});

test('les tops restent personnels chez un ami et ouvrent la bonne édition', async ({ page }) => {
  await sql`update sessions set viewing_as_user_id = ${friendId} where user_id = ${ownerId}`;
  await page.goto('/');
  await expect(page.getByText('Vous consultez la collection de stats_friend.')).toBeVisible();
  const wanted = page.getByRole('region', { name: 'Les plus wanted', exact: true });
  await expect(wanted.getByRole('listitem').first()).toContainText('Édition 6');
  await expect(wanted.getByText('Album de mon ami')).toHaveCount(0);
  await wanted.getByRole('button').first().click();
  await expect(page.getByRole('heading', { name: 'Édition 6', exact: true })).toBeVisible();
  await expect(page.getByText('Vous consultez la collection de stats_friend.')).toHaveCount(0);
});

test('une collection vide explique comment obtenir les tops', async ({ page }) => {
  await sql`update collection_instances set is_active = false where user_id = ${ownerId}`;
  await page.goto('/');
  await expect(page.getByText('Importez votre collection pour découvrir vos tops.')).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Le top de votre collection' })
      .getByRole('link', { name: 'Synchroniser' }),
  ).toHaveAttribute('href', '/import');
});

test('le sélecteur du header reste disponible sur chaque écran et ouvre la collection depuis une fiche', async ({
  page,
}) => {
  const header = page.getByRole('banner');
  const switcher = header.getByRole('combobox', { name: 'Collection affichée' });
  for (const path of [
    '/',
    '/collection',
    '/aleatoire',
    '/radio',
    '/amis',
    '/parametres',
    '/import',
  ]) {
    await page.goto(path);
    await expect(switcher).toBeVisible();
    await expect(switcher).toHaveValue(ownerId);
    await switcher.selectOption(friendId);
    await expect(switcher).toHaveValue(friendId);
    await expect(switcher.locator('option:checked')).toHaveText('stats_friend');
    await switcher.selectOption(ownerId);
    await expect(switcher).toHaveValue(ownerId);
  }
  await page.goto(`/sorties/${R(1)}`);
  await switcher.selectOption(friendId);
  await expect(page).toHaveURL(/\/collection$/);
  await expect(page.getByRole('link', { name: /Album de mon ami/ })).toBeVisible();
  await expect(switcher).toHaveValue(friendId);
});

test('les trois nouveaux tris ordonnent les albums de la collection', async ({ page }) => {
  await page.goto('/collection');
  const sort = page.getByRole('combobox', { name: 'Trier', exact: true });
  for (const value of ['have_desc', 'want_desc', 'value_desc']) {
    await sort.selectOption(value);
    await expect(
      page.getByRole('main').getByRole('list').getByRole('listitem').first(),
    ).toContainText('Édition 6');
    await expect(
      page.getByRole('main').getByRole('list').getByRole('listitem').last(),
    ).toContainText('Édition 1');
  }
  await expect(page.getByText(/Valeur marchande : prix minimum/)).toBeVisible();
});

test('le sélecteur est à côté du logo, hors du burger, même à 320 px', async ({ page }) => {
  await page.goto('/');
  const header = page.getByRole('banner');
  const switcher = header.getByRole('combobox', { name: 'Collection affichée' });
  const widths = [page.viewportSize()!.width, 320];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    const logo = await header.getByRole('link', { name: 'Dig', exact: true }).boundingBox();
    const select = await switcher.boundingBox();
    expect(logo).not.toBeNull();
    expect(select).not.toBeNull();
    expect(select!.x).toBeGreaterThan(logo!.x + logo!.width);
    expect(Math.abs(select!.y + select!.height / 2 - logo!.y - logo!.height / 2)).toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await header.getByRole('button', { name: 'Ouvrir le menu' }).click();
  await expect(switcher).toBeVisible();
  await expect(page.locator('#mobile-nav-panel').getByRole('combobox')).toHaveCount(0);
  await switcher.selectOption(friendId);
  await expect(switcher).toHaveValue(friendId);
});

test('six pochettes et Voir plus ouvrent les ajouts récents de l’ami', async ({ page }) => {
  await page.goto('/');
  const activity = page.getByRole('region', { name: 'Dans les bacs de vos amis' });
  const items = activity.getByRole('listitem');
  await expect(items).toHaveCount(6);
  const first = (await items.nth(0).boundingBox())!;
  const second = (await items.nth(1).boundingBox())!;
  const third = (await items.nth(2).boundingBox())!;
  expect(second.y).toBe(first.y);
  expect(second.x).toBeGreaterThan(first.x);
  if (page.viewportSize()!.width < 1024) {
    expect(third.x).toBe(first.x);
    expect(third.y).toBeGreaterThan(first.y);
  } else {
    expect(third.y).toBe(first.y);
  }
  await activity.getByRole('button', { name: 'Voir les ajouts de stats_friend' }).first().click();
  await expect(page).toHaveURL(/\/collection\?sort=date_added_desc$/);
  await expect(page.getByRole('combobox', { name: 'Collection affichée' })).toHaveValue(friendId);
  const sort = page.getByRole('combobox', { name: 'Trier', exact: true });
  await expect(sort).toHaveValue('date_added_desc');
  const albums = page.getByRole('main').getByRole('list').getByRole('listitem');
  await expect(albums).toHaveCount(7);
  await expect(albums.first()).toContainText('Album de mon ami');
  await expect(albums.last()).toContainText('Édition 13');
  await sort.selectOption('value_desc');
  await expect(albums.first()).toContainText('Édition 13');
  await page.getByRole('banner').getByRole('link', { name: 'Dig', exact: true }).click();
  await activity.getByRole('link', { name: 'Voir les ajouts de stats_friend' }).first().click();
  await expect(sort).toHaveValue('date_added_desc');
  await expect(albums.first()).toContainText('Album de mon ami');
});

test('le tri initial de la collection suit le lien et ignore les valeurs invalides', async ({
  page,
}) => {
  await page.goto('/collection?sort=value_desc');
  await expect(page.getByRole('combobox', { name: 'Trier', exact: true })).toHaveValue(
    'value_desc',
  );
  await expect(page.getByRole('main').getByRole('listitem').first()).toContainText('Édition 6');
  await page.goto('/collection?sort=invalid');
  await expect(page.getByRole('combobox', { name: 'Trier', exact: true })).toHaveValue(
    'date_added_desc',
  );
  await expect(page.getByRole('main').getByRole('listitem').first()).toContainText('Édition 1');
});

test('le manifeste public et les icônes rendent Dig installable avec son logo', async ({
  page,
  request,
}) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    name: 'Dig',
    start_url: '/',
    scope: '/',
    display: 'standalone',
  });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sizes: '192x192', purpose: 'any' }),
      expect.objectContaining({ sizes: '512x512', purpose: 'any' }),
      expect.objectContaining({ sizes: '512x512', purpose: 'maskable' }),
    ]),
  );
  for (const icon of manifest.icons) {
    const image = await request.get(icon.src);
    expect(image.ok()).toBe(true);
    expect(image.headers()['content-type']).toContain('image/png');
    expect((await image.body()).length).toBeGreaterThan(1000);
  }
  await page.goto('/parametres');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest',
  );
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    'href',
    '/icons/apple-touch-icon.png',
  );
  expect((await request.get('/icons/apple-touch-icon.png')).ok()).toBe(true);
});

test('l’invitation native capturée à l’accueil reste disponible dans les paramètres', async ({
  page,
}) => {
  await page.goto('/');
  // Attendre l'hydratation avant d'émettre l'événement fourni habituellement par le navigateur.
  await page.getByRole('region', { name: 'Un disque au hasard' }).getByRole('link').waitFor();
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.defineProperties(event, {
      prompt: {
        value: async () => {
          document.documentElement.dataset.installPrompted = 'yes';
        },
      },
      userChoice: { value: Promise.resolve({ outcome: 'accepted' }) },
    });
    window.dispatchEvent(event);
  });
  const header = page.getByRole('banner');
  const menu = header.getByRole('button', { name: 'Ouvrir le menu' });
  if (await menu.isVisible()) await menu.click();
  await header.getByRole('link', { name: 'Paramètres', exact: true }).click();
  await page.getByRole('button', { name: 'Installer l’application', exact: true }).click();
  await expect(
    page.getByText('Installation demandée. Votre navigateur termine l’installation.'),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-install-prompted', 'yes');
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(page.getByText('L’application est installée sur cet appareil.')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Installer l’application', exact: true }),
  ).toHaveCount(0);
});

test('sans invitation native, le bouton explique l’installation manuelle', async ({ page }) => {
  await page.goto('/parametres');
  await page.getByRole('button', { name: 'Installer l’application', exact: true }).click();
  await expect(page.getByText(/Dans le menu de votre navigateur, cherchez/)).toBeVisible();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', { value: 'iPhone Safari' });
  });
  await page.reload();
  await page.getByRole('button', { name: 'Installer l’application', exact: true }).click();
  await expect(page.getByText(/Dans Safari, ouvrez le menu Partager/)).toBeVisible();
});

test('une invitation refusée peut être remplacée et une erreur propose les étapes manuelles', async ({
  page,
}) => {
  await page.goto('/parametres');
  const install = page.getByRole('button', { name: 'Installer l’application', exact: true });
  await install.click();
  for (const failure of [false, true]) {
    await page.evaluate((failure) => {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      Object.defineProperties(event, {
        prompt: {
          value: async () => {
            if (failure) throw new Error('Unavailable');
          },
        },
        userChoice: { value: Promise.resolve({ outcome: 'dismissed' }) },
      });
      window.dispatchEvent(event);
    }, failure);
    await install.click();
    await expect(
      page.getByText(failure ? /L’installation n’a pas pu démarrer/ : /Installation annulée/),
    ).toBeVisible();
    await expect(install).toBeEnabled();
  }
  await expect(page.getByText(/Dans le menu de votre navigateur, cherchez/)).toBeVisible();
});
