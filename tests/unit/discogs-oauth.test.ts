import { describe, expect, it } from 'vitest';

import { authorizeUrl, buildAuthorizationHeader } from '@/modules/auth/discogs-oauth';

describe('en-tête OAuth 1.0a', () => {
  it('encode les valeurs et respecte la forme attendue par Discogs', () => {
    const header = buildAuthorizationHeader({
      oauth_consumer_key: 'clef',
      oauth_signature: 'secret&',
      oauth_callback: 'http://localhost:3004/api/auth/discogs/callback',
    });

    expect(header.startsWith('OAuth ')).toBe(true);
    expect(header).toContain('oauth_consumer_key="clef"');
    // Le `&` de la signature PLAINTEXT et les `:` `/` de l'URL doivent être encodés.
    expect(header).toContain('oauth_signature="secret%26"');
    expect(header).toContain('oauth_callback="http%3A%2F%2Flocalhost%3A3004');
  });

  it('sépare les paramètres par une virgule et un espace', () => {
    const header = buildAuthorizationHeader({ a: '1', b: '2' });

    expect(header).toBe('OAuth a="1", b="2"');
  });
});

describe('URL d’autorisation', () => {
  it('porte le request token en paramètre', () => {
    const url = new URL(authorizeUrl('token-abc'));

    expect(url.origin).toBe('https://www.discogs.com');
    expect(url.pathname).toBe('/oauth/authorize');
    expect(url.searchParams.get('oauth_token')).toBe('token-abc');
  });

  it('n’expose jamais un secret dans l’URL (§18.1)', () => {
    const url = authorizeUrl('token-abc');

    expect(url).not.toContain('oauth_token_secret');
    expect(url).not.toContain(process.env.DISCOGS_CONSUMER_SECRET ?? '§introuvable§');
  });
});
