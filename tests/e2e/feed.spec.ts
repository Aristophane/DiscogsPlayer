import { createHash, randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL ?? '', { max: 2 });
const identities = ['test-feed-browser-own', 'test-feed-browser-friend'];
const releaseId = 'test-feed-browser-record';
let ownerId: string;
let friendId: string;
let token: string;

async function cleanup() {
  const people = await sql`select id from users where discogs_user_id in ${sql(identities)}`;
  for (const person of people)
    await sql`delete from tasks where dedupe_key like ${`feed:${String(person.id)}:%`}`;
  await sql`delete from users where discogs_user_id in ${sql(identities)}`;
  await sql`delete from discogs_releases where discogs_release_id = ${releaseId}`;
}

test.beforeAll(async () => {
  await cleanup();
  const [own] =
    await sql`insert into users (discogs_user_id, discogs_username, spotify_enabled) values (${identities[0]!}, 'Wolfgang', 'no') returning id`;
  const [friend] =
    await sql`insert into users (discogs_user_id, discogs_username, spotify_enabled) values (${identities[1]!}, 'Camille', 'no') returning id`;
  ownerId = String(own!.id);
  friendId = String(friend!.id);
  await sql`insert into collection_shares (owner_id, grantee_id) values (${friendId}, ${ownerId})`;
  const [record] =
    await sql`insert into discogs_releases (discogs_release_id, title, artists_text, community_have, community_want, lowest_price_eur, num_for_sale, statistics_fetched_at) values (${releaseId}, 'Un disque à redécouvrir', 'Les artistes de nos collections', 123, 456, 28.50, 3, now()) returning id`;
  for (const id of [ownerId, friendId])
    await sql`insert into collection_instances (user_id, release_id, discogs_instance_id) values (${id}, ${record!.id}, ${`test-feed-copy-${id}`})`;
  token = randomBytes(32).toString('base64url');
  await sql`insert into sessions (user_id, token_hash, expires_at) values (${ownerId}, ${createHash('sha256').update(token).digest('hex')}, ${new Date(Date.now() + 3_600_000)})`;
});

test.beforeEach(async ({ page }) => {
  await sql`delete from feed_editions where user_id = ${ownerId}`;
  await sql`update sessions set viewing_as_user_id = null where user_id = ${ownerId}`;
  await sql`update collection_shares set revoked_at = null where owner_id = ${friendId} and grantee_id = ${ownerId}`;
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [edition] =
    await sql`insert into feed_editions (user_id, day, status) values (${ownerId}, ${today}, 'ready') returning id`;
  for (let n = 0; n < 19; n++) {
    const content = {
      kind: n % 3 === 0 ? 'artist' : n % 3 === 1 ? 'album' : 'news',
      title: 'Un disque à redécouvrir',
      artists: `Les artistes de nos collections ${n}`,
      coverUrl: null,
      year: 1999,
      ownerUsername: n % 2 ? 'Camille' : null,
      addedAt: null,
      statistic: null,
      story: {
        kind: n % 3 === 0 ? 'artist' : n % 3 === 1 ? 'album' : 'news',
        title:
          [
            'Dans les coulisses du studio',
            'Une autre façon d’écouter',
            'Les artistes prennent la parole',
          ][n % 3] + ` · ${n + 1}`,
        text: 'Un extrait de démonstration pour découvrir les récits, les portraits et les actualités liés aux disques de nos collections. '.repeat(
          6,
        ),
        sourceName: 'Source de démonstration',
        sourceUrl: 'https://fr.wikipedia.org/wiki/Musique',
        language: 'fr',
        publishedAt: null,
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      },
    };
    await sql`insert into feed_posts (edition_id, user_id, owner_id, discogs_release_id, day, position, content_key, content) values (${edition!.id}, ${ownerId}, ${n % 2 ? friendId : ownerId}, ${releaseId}, ${today}, ${n}, ${`test-feed-browser-${n}`}, ${sql.json(content)})`;
  }
  await page
    .context()
    .addCookies([{ name: 'dp_session', value: token, domain: 'localhost', path: '/' }]);
});

test.afterAll(async () => {
  await cleanup();
  await sql.end();
});

test('le fil affiche plusieurs publications, se déplie et reste accessible sur chaque écran', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Votre fil', exact: true })).toHaveClass(
    'sr-only',
  );
  await expect(page.getByText('Votre sélection du jour')).toHaveCount(0);
  await expect(page.getByText(/Les disques que vous aimez ont des histoires/)).toHaveCount(0);
  const cover = await page.locator('[data-feed-cover]').first().boundingBox();
  const article = await page.getByRole('article').first().boundingBox();
  const smallScreen = page.viewportSize()!.width < 640;
  expect(cover!.width).toBe(smallScreen ? 104 : 160);
  expect(cover!.x).toBeLessThan(article!.x + article!.width / 3);
  const visible = await page.getByRole('article').evaluateAll((nodes) => {
    const headerBottom = document.querySelector('header')!.getBoundingClientRect().bottom;
    const bounds = nodes.map((node) => node.getBoundingClientRect());
    return {
      complete: bounds.filter(({ top, bottom }) => top >= headerBottom && bottom <= innerHeight)
        .length,
      started: bounds.filter(({ top, bottom }) => top < innerHeight && bottom > headerBottom)
        .length,
    };
  });
  expect(visible.complete).toBeGreaterThanOrEqual(2);
  expect(visible.started).toBeGreaterThanOrEqual(3);
  await page.screenshot({ path: testInfo.outputPath('feed.png'), fullPage: false });
  const first = page.getByRole('article').first();
  const collapsedHeight = (await first.boundingBox())!.height;
  const secondTop = (await page.getByRole('article').nth(1).boundingBox())!.y;
  await first.getByRole('button', { name: 'Voir plus', exact: true }).click();
  await expect(first.getByRole('button', { name: 'Réduire' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect((await first.boundingBox())!.height).toBeGreaterThan(collapsedHeight);
  await first.getByRole('button', { name: 'Réduire', exact: true }).click();
  expect((await page.getByRole('article').nth(1).boundingBox())!.y).toBeCloseTo(secondTop, 0);
  await first.getByRole('button', { name: 'Voir plus', exact: true }).click();
  await expect(first.getByRole('link', { name: /Source de démonstration/ })).toHaveAttribute(
    'href',
    'https://fr.wikipedia.org/wiki/Musique',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    accessibility.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious'),
  ).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('feed-expanded.png'), fullPage: false });
});

test('le défilement charge la suite sans remplacer les premières cartes', async ({ page }) => {
  await page.goto('/');
  const first = await page.getByRole('article').first().getByRole('heading').innerText();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.getByRole('article')).toHaveCount(19);
  expect(await page.getByRole('article').first().getByRole('heading').innerText()).toBe(first);
  await expect(page.getByRole('button', { name: 'Charger la suite' })).toHaveCount(0);
});

test('le fil protège son historique, exige une session et valide les curseurs', async ({
  page,
  request,
}) => {
  expect((await request.get('/api/feed')).status()).toBe(401);
  const data = await (await page.request.get(`/api/feed?userId=${friendId}`)).json();
  expect(data.items).toHaveLength(12);
  expect(
    data.items.some((item: { ownerUsername: string | null }) => item.ownerUsername === null),
  ).toBe(true);
  expect((await page.request.get('/api/feed?cursor=invalid')).status()).toBe(400);
  expect((await page.request.get('/api/feed?limit=101')).status()).toBe(400);
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Votre fil', exact: true })).not.toHaveAttribute(
    'aria-busy',
    'true',
  );
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.getByRole('article')).toHaveCount(19);
  // Keep enough content below the anchor on tall tablets with the compact layout.
  // This still anchors beyond the first page of twelve posts.
  const friendCard = page.getByRole('article').nth(14);
  await friendCard.getByRole('button', { name: 'Voir plus', exact: true }).click();
  const savedFriendId = (await friendCard.getAttribute('data-feed-id'))!;
  await friendCard.evaluate((node) => {
    const headerBottom = document.querySelector('header')!.getBoundingClientRect().bottom;
    window.scrollTo({
      top: scrollY + node.getBoundingClientRect().top - headerBottom + 60,
      behavior: 'instant',
    });
  });
  await expect
    .poll(() =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) ?? '{}').anchor?.id,
        `dp:feed-reading:${ownerId}`,
      ),
    )
    .toBe(savedFriendId);
  await sql`update collection_shares set revoked_at = now() where owner_id = ${friendId} and grantee_id = ${ownerId}`;
  await page.reload();
  await expect(page.getByRole('article').getByText('Collection de Camille')).toHaveCount(0);
});

test('la lecture reprend sur la même publication dépliée après navigation, rechargement et réouverture', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Votre fil', exact: true })).not.toHaveAttribute(
    'aria-busy',
    'true',
  );
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.getByRole('article')).toHaveCount(19);
  const card = page.getByRole('article').nth(14);
  await card.getByRole('button', { name: 'Voir plus', exact: true }).click();
  const id = (await card.getAttribute('data-feed-id'))!;
  const before = await card.evaluate((node) => {
    const top = document.querySelector('header')!.getBoundingClientRect().bottom;
    window.scrollTo({
      top: window.scrollY + node.getBoundingClientRect().top - top + 60,
      behavior: 'instant',
    });
    return node.getBoundingClientRect().top;
  });
  await expect
    .poll(() =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) ?? '{}').anchor?.id,
        `dp:feed-reading:${ownerId}`,
      ),
    )
    .toBe(id);
  const header = page.getByRole('banner');
  async function navigate(label: string) {
    const menu = header.getByRole('button', { name: 'Ouvrir le menu' });
    if (await menu.isVisible()) await menu.click();
    await header.getByRole('link', { name: label, exact: true }).click();
  }
  await navigate('Stats');
  await expect(page).toHaveURL(/\/stats$/);
  await navigate('Accueil');
  await expect(page).toHaveURL(/\/$/);
  const restored = page.locator(`[data-feed-id="${id}"]`);
  await expect(restored).toBeAttached();
  await expect
    .poll(() => restored.evaluate((node) => node.getBoundingClientRect().top))
    .toBeCloseTo(before, 0);
  await expect(restored.getByRole('button', { name: 'Réduire' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await page.reload();
  await expect(restored).toBeAttached();
  await expect
    .poll(() => restored.evaluate((node) => node.getBoundingClientRect().top))
    .toBeCloseTo(before, 0);
  const reopened = await context.newPage();
  await reopened.goto('/');
  const resumed = reopened.locator(`[data-feed-id="${id}"]`);
  await expect(resumed).toBeAttached();
  await expect
    .poll(() => resumed.evaluate((node) => node.getBoundingClientRect().top))
    .toBeCloseTo(before, 0);
  await reopened.close();
});
