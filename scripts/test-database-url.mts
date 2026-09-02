/** Dérive l'URL de la base de test de celle du développement : même serveur, autre base. */
export function testDatabaseUrl(developmentUrl: string): string {
  if (process.env.TEST_DATABASE_URL) {
    return process.env.TEST_DATABASE_URL;
  }

  const url = new URL(developmentUrl);
  url.pathname = `${url.pathname.replace(/\/$/, '')}_test`;
  return url.toString();
}
