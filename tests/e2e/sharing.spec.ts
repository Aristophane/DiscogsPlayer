/**
 * Partage de collection (Lot 7, demande produit 2026-09-03) : parcours réel dans un
 * navigateur, de bout en bout — invitation générée depuis les paramètres, acceptée par
 * un ami déjà connecté, bascule visible sur la collection, retour à la sienne, puis
 * révocation qui reprend l'accès immédiatement. Le parcours OAuth ne peut pas être
 * automatisé (§22.3) : les deux sessions sont créées directement en base, comme dans
 * `collection.spec.ts`.
 */
import { createHash, randomBytes } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL ?? '', { max: 2 });

const ALICE_DISCOGS_ID = '994000001';
const BOB_DISCOGS_ID = '994000002';
const RELEASE_ID = 'test-9940001';

let aliceToken: string;
let bobToken: string;

async function cleanup() {
  await sql`delete from users where discogs_user_id in (${ALICE_DISCOGS_ID}, ${BOB_DISCOGS_ID})`;
  await sql`delete from discogs_releases where discogs_release_id = ${RELEASE_ID}`;
}

async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await sql`
    insert into sessions (user_id, token_hash, expires_at)
    values (${userId}, ${createHash('sha256').update(token).digest('hex')},
            ${new Date(Date.now() + 3_600_000)})
  `;
  return token;
}

test.beforeAll(async () => {
  await cleanup();

  const [alice] = await sql<{ id: string }[]>`
    insert into users (discogs_user_id, discogs_username)
    values (${ALICE_DISCOGS_ID}, 'e2e_alice_sharing')
    returning id
  `;
  const [bob] = await sql<{ id: string }[]>`
    insert into users (discogs_user_id, discogs_username)
    values (${BOB_DISCOGS_ID}, 'e2e_bob_sharing')
    returning id
  `;

  const [release] = await sql<{ id: string }[]>`
    insert into discogs_releases (
      discogs_release_id, title, year, genres, styles, artists_text,
      search_text, title_normalized, artists_normalized, primary_image_url
    ) values (
      ${RELEASE_ID}, 'Album Partagé', 2005, ${sql.array(['Rock'])}, ${sql.array(['Test'])},
      'Artiste Partagé', 'album partage artiste partage', 'album partage', 'artiste partage', null
    )
    returning id
  `;
  await sql`
    insert into collection_instances (user_id, release_id, discogs_instance_id, date_added)
    values (${alice!.id}, ${release!.id}, '9940001', ${new Date()})
  `;

  aliceToken = await createSession(alice!.id);
  bobToken = await createSession(bob!.id);
});

test.afterAll(async () => {
  await cleanup();
  await sql.end();
});

async function signInAs(page: Page, token: string) {
  await page.context().clearCookies();
  await page
    .context()
    .addCookies([{ name: 'dp_session', value: token, domain: 'localhost', path: '/' }]);
}

test('un ami accepte une invitation, consulte la collection, puis y perd l’accès à la révocation', async ({
  page,
}) => {
  // Alice génère un lien d'invitation depuis ses paramètres.
  await signInAs(page, aliceToken);
  await page.goto('/parametres');
  await page.getByRole('button', { name: 'Générer un lien d’invitation' }).click();

  const inviteCode = await page.locator('code').innerText();
  const inviteUrl = new URL(inviteCode);
  const inviteToken = inviteUrl.pathname.split('/').pop();
  expect(inviteToken).toBeTruthy();

  // Bob ouvre le lien : il est déjà connecté, il voit de qui vient l'invitation.
  await signInAs(page, bobToken);
  await page.goto(`/invitations/${inviteToken}`);
  await expect(page.getByRole('heading', { name: 'e2e_alice_sharing vous invite' })).toBeVisible();

  await page.getByRole('button', { name: 'Accepter l’invitation' }).click();

  // La bascule est immédiate : Bob atterrit sur la collection d'Alice, avec l'indicateur
  // visible (§18.5, aucune ambiguïté sur la source consultée).
  await expect(page).toHaveURL(/\/collection$/);
  await expect(page.getByText('Vous consultez la collection de e2e_alice_sharing.')).toBeVisible();
  await expect(page.getByRole('link', { name: /Album Partagé/ })).toBeVisible();

  // Retour explicite à sa propre collection, vide.
  await page.getByRole('button', { name: 'Revenir à ma collection' }).click();
  await expect(page.getByText('Vous consultez la collection de')).toHaveCount(0);
  await expect(page.getByText('Votre collection est vide pour le moment')).toBeVisible();

  // Depuis ses paramètres, Bob peut aussi rebasculer vers la collection reçue.
  await page.goto('/parametres');
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/collection-shares/active')),
    page.getByRole('button', { name: 'Consulter cette collection' }).click(),
  ]);
  await page.goto('/collection');
  await expect(page.getByText('Vous consultez la collection de e2e_alice_sharing.')).toBeVisible();

  // Alice révoque l'accès : effet immédiat, sans que Bob ait besoin de se reconnecter.
  await signInAs(page, aliceToken);
  await page.goto('/parametres');
  await expect(page.getByText('e2e_bob_sharing')).toBeVisible();
  await page.getByRole('button', { name: 'Retirer l’accès' }).click();
  await expect(page.getByText('Vous ne partagez votre collection avec personne')).toBeVisible();

  await signInAs(page, bobToken);
  await page.goto('/collection');
  await expect(page.getByText('Vous consultez la collection de')).toHaveCount(0);
  await expect(page.getByText('Votre collection est vide pour le moment')).toBeVisible();
});

test('un lien d’invitation déjà consommé est refusé', async ({ page }) => {
  await signInAs(page, aliceToken);
  await page.goto('/parametres');
  await page.getByRole('button', { name: 'Générer un lien d’invitation' }).click();
  const inviteCode = await page.locator('code').innerText();
  const inviteToken = new URL(inviteCode).pathname.split('/').pop();

  await signInAs(page, bobToken);
  await page.goto(`/invitations/${inviteToken}`);
  await page.getByRole('button', { name: 'Accepter l’invitation' }).click();
  await expect(page).toHaveURL(/\/collection$/);

  // Rejeu du même lien : usage unique, refusé sans planter.
  await page.goto(`/invitations/${inviteToken}`);
  await expect(page.getByRole('heading', { name: 'Invitation introuvable' })).toBeVisible();

  // Nettoyage du partage créé par ce second test, pour ne pas fausser d'autres specs.
  await sql`delete from collection_shares where owner_id in (
    select id from users where discogs_user_id = ${ALICE_DISCOGS_ID}
  )`;
});
