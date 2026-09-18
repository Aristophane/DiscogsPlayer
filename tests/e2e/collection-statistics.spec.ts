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
  await sql`delete from discogs_releases where discogs_release_id in ${sql(Array.from({ length: 7 }, (_, i) => R(i + 1)))}`;
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
  for (let n = 1; n <= 7; n++) {
    const [release] = await sql`insert into discogs_releases
      (discogs_release_id, title, artists_text, title_normalized, community_have, community_want, lowest_price_eur, num_for_sale, details_fetched_at, statistics_fetched_at)
      values (${R(n)}, ${n === 7 ? 'Album de mon ami' : `Édition ${n}`}, 'Artiste des statistiques', ${`edition ${n}`},
      ${n === 1 ? null : n * 10}, ${n === 1 ? 0 : n * 100}, ${n * 25.5}, 2, now(), now()) returning id`;
    await sql`insert into collection_instances (user_id, release_id, discogs_instance_id) values
      (${n === 7 ? friendId : ownerId}, ${release!.id}, ${`test-stats-instance-${n}`})`;
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
  await page.getByRole('button', { name: 'Actualiser l’affichage' }).click();
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
  await expect(progress).toHaveAttribute('aria-valuenow', '6', { timeout: 12_000 });
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
  await expect(activity.getByText('stats_friend a ajouté à sa collection')).toBeVisible();
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
