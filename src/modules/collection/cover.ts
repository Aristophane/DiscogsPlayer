/**
 * Résolution des URL de pochettes (SPEC-GAPS G-03).
 *
 * Une URL Discogs n'est jamais rendue telle quelle : elle passe par le proxy serveur, qui
 * porte le `User-Agent` requis et contourne les restrictions de hotlinking. Une URL d'une
 * autre origine est refusée ici, pas seulement côté serveur — le composant ne doit pas
 * pouvoir fabriquer une requête vers un hôte arbitraire.
 */
const ALLOWED_HOSTS = new Set(['i.discogs.com', 'img.discogs.com', 'st.discogs.com']);

export function coverProxyUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) {
    return null;
  }

  const path = url.pathname.split('/').filter((segment) => segment !== '');

  return `/api/images/${url.hostname}/${path.join('/')}${url.search}`;
}
