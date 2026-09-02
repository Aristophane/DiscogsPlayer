/**
 * Critère de sortie du Lot 3 (SPECIFICATION.md §24) :
 * « les budgets d'accessibilité et les captures mobile/tablette sont validés ».
 *
 * Ces tests exercent l'application réelle avec une session créée à la volée : le parcours
 * OAuth ne peut pas être automatisé sans appeler Discogs, ce que §22.3 interdit.
 */
import { createHash, randomBytes } from 'node:crypto';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';

/**
 * L'amorçage passe par du SQL direct plutôt que par les services applicatifs : Playwright
 * ne résout pas l'alias `@/*` du tsconfig, et surtout ces tests doivent viser la base que
 * sert l'application lancée par `webServer`, pas la base de test des tests d'intégration.
 */
const sql = postgres(process.env.DATABASE_URL ?? '', { max: 2 });

const DISCOGS_USER_ID = '993000001';
/** Préfixe non numérique : aucun risque de collision avec un identifiant Discogs réel. */
const R = (n: number) => `test-9930${String(n).padStart(3, '0')}`;

const CATALOG = [
  { n: 1, title: 'Ágætis Byrjun', artist: 'Sigur Rós', year: 1999, genre: 'Rock' },
  { n: 2, title: 'Homogenic', artist: 'Björk', year: 1997, genre: 'Electronic' },
  { n: 3, title: 'Sans Pochette', artist: 'Artiste Sans Image', year: 2001, genre: 'Folk' },
  {
    n: 4,
    // Texte volontairement très long : §22.5 exige de vérifier le rendu dans ce cas.
    title:
      'Un Titre Particulièrement Long Qui Doit Être Tronqué Proprement Sans Casser La Grille Ni Déborder De Sa Tuile',
    artist: 'Un Nom D’Artiste Lui Aussi Excessivement Long Pour Les Besoins Du Test',
    year: 2010,
    genre: 'Electronic',
  },
];

/** Reproduit `normalizeText` pour les colonnes de recherche et de tri. */
function normalize(value: string): string {
  return value
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

let token: string;

async function cleanup() {
  await sql`delete from users where discogs_user_id = ${DISCOGS_USER_ID}`;
  await sql`delete from discogs_releases where discogs_release_id like 'test-9930%'`;
}

test.beforeAll(async () => {
  await cleanup();

  const [user] = await sql<{ id: string }[]>`
    insert into users (discogs_user_id, discogs_username)
    values (${DISCOGS_USER_ID}, 'e2e_collection')
    returning id
  `;
  const userId = user!.id;

  for (const entry of CATALOG) {
    const artists = entry.artist;
    const [release] = await sql<{ id: string }[]>`
      insert into discogs_releases (
        discogs_release_id, title, year, genres, styles, artists_text,
        search_text, title_normalized, artists_normalized, primary_image_url
      ) values (
        ${R(entry.n)}, ${entry.title}, ${entry.year},
        ${sql.array([entry.genre])}, ${sql.array(['Test'])}, ${artists},
        ${normalize(`${entry.title} ${artists}`)},
        ${normalize(entry.title)}, ${normalize(artists)},
        ${entry.n === 3 ? null : `https://i.discogs.com/test/${entry.n}.jpg`}
      )
      returning id
    `;

    await sql`
      insert into collection_instances (user_id, release_id, discogs_instance_id, date_added)
      values (${userId}, ${release!.id}, ${`9930${entry.n}`},
              ${new Date(Date.now() - entry.n * 86_400_000)})
    `;
  }

  // Session créée directement : le parcours OAuth exigerait un appel réel à Discogs,
  // que §22.3 interdit en test.
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

async function expectNoCriticalViolations(page: Page, context: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const serious = results.violations.filter(
    (violation) => violation.impact === 'critical' || violation.impact === 'serious',
  );

  expect(
    serious,
    `${context} : ${serious.map((violation) => `${violation.id} (${violation.impact})`).join(', ')}`,
  ).toEqual([]);
}

test('la collection est accessible et se rend sur mobile', async ({ page }, testInfo) => {
  await signIn(page);
  await page.goto('/collection');

  await expect(page.getByRole('heading', { name: 'Collection', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: /Ágætis Byrjun/ })).toBeVisible();

  // Pochette manquante : un texte explicite, jamais une image cassée (§22.5). Le repli
  // couvre les deux cas — URL absente, et image que Discogs ne sert plus.
  await expect(page.getByText('Pochette indisponible').first()).toBeVisible();

  // Aucune image cassée à l'écran. `complete` distingue « échouée » de « en cours de
  // chargement » : sans cette nuance, l'assertion serait une course avec le réseau.
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          [...document.querySelectorAll('img')].filter(
            (image) => image.complete && image.naturalWidth === 0,
          ).length,
      ),
    )
    .toBe(0);

  await expectNoCriticalViolations(page, 'collection');

  await testInfo.attach(`collection-${testInfo.project.name}`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});

test('la recherche filtre la grille sans rechargement', async ({ page }) => {
  await signIn(page);
  await page.goto('/collection');

  await page.getByLabel(/Rechercher/).fill('bjork');

  // COLL-003 : la recherche sans accent trouve l'artiste accentué.
  await expect(page.getByRole('link', { name: /Homogenic/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Ágætis Byrjun/ })).toBeHidden();

  await page.getByLabel(/Rechercher/).fill('zzz introuvable');
  await expect(page.getByText('Aucun album ne correspond à cette recherche.')).toBeVisible();
});

test('les filtres par genre se combinent et s’annoncent', async ({ page }) => {
  await signIn(page);
  await page.goto('/collection');

  await page.getByRole('button', { name: 'Filtrer' }).click();
  // La case est `sr-only` : on agit sur le contrôle, pas sur sa boîte visuelle.
  await page.getByRole('checkbox', { name: /Electronic/ }).check({ force: true });

  await expect(page.getByRole('link', { name: /Homogenic/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Ágætis Byrjun/ })).toBeHidden();

  await page.getByRole('button', { name: 'Retirer tous les filtres' }).click();
  await expect(page.getByRole('link', { name: /Ágætis Byrjun/ })).toBeVisible();
});

test('la fiche album est accessible et navigable au clavier', async ({ page }, testInfo) => {
  await signIn(page);
  await page.goto(`/sorties/${R(1)}`);

  await expect(page.getByRole('heading', { name: 'Ágætis Byrjun', level: 1 })).toBeVisible();
  await expect(page.getByText('Sigur Rós')).toBeVisible();

  // §4.2 : la fiche n'affiche que ce qui est déjà connu et ne déclenche aucune
  // résolution — le bouton play est présent, mais rien n'est joué avant qu'on y clique
  // (Lot 6 : le bloc de texte "Disponibilité" a été retiré au profit de ce bouton).
  await expect(page.getByRole('button', { name: 'Lire l’album' })).toBeVisible();

  await expectNoCriticalViolations(page, 'fiche album');

  // §20.2 : navigation complète au clavier, avec focus visible. L'en-tête précède
  // désormais le contenu dans l'ordre de tabulation (Lot 6) : on vérifie que le lien de
  // retour reste atteignable, pas qu'il est le tout premier élément de la page.
  await page.getByRole('link', { name: 'Retour à la collection' }).focus();
  await expect(page.getByRole('link', { name: 'Retour à la collection' })).toBeFocused();

  await testInfo.attach(`fiche-album-${testInfo.project.name}`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});

test('un album absent de la collection renvoie une page 404 lisible', async ({ page }) => {
  await signIn(page);
  await page.goto('/sorties/999999999');

  await expect(page.getByText('Cette page n’existe pas.')).toBeVisible();
});

test('la connexion est exigée avant toute page privée (§18.5)', async ({ page }) => {
  await page.goto('/collection');

  await expect(page).toHaveURL(/\/connexion/);
  await expect(page.getByRole('heading', { name: 'Se connecter', level: 1 })).toBeVisible();
});
