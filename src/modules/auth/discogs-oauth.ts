/**
 * Client OAuth 1.0a Discogs (SPECIFICATION.md §11).
 *
 * Signature PLAINTEXT sur HTTPS (ADR-0003) : Discogs l'accepte, le transport chiffre
 * déjà le secret, et cela supprime toute une classe de bugs de normalisation HMAC.
 *
 * Toutes les réponses Discogs sont validées par Zod avant d'entrer dans le domaine :
 * une réponse externe non validée est un bug (CLAUDE.md).
 */
import { randomBytes } from 'node:crypto';

import { z } from 'zod';

import { getEnv } from '@/lib/env';

/** Discogs répond en `application/x-www-form-urlencoded` pour les étapes OAuth. */
const requestTokenSchema = z.object({
  oauth_token: z.string().min(1),
  oauth_token_secret: z.string().min(1),
  oauth_callback_confirmed: z.literal('true'),
});

const accessTokenSchema = z.object({
  oauth_token: z.string().min(1),
  oauth_token_secret: z.string().min(1),
});

const identitySchema = z.object({
  id: z.number().int().positive(),
  username: z.string().min(1),
  resource_url: z.string().optional(),
});

export type DiscogsIdentity = z.infer<typeof identitySchema>;
export type OAuthTokenPair = { token: string; tokenSecret: string };

export class DiscogsOAuthError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DiscogsOAuthError';
    this.status = status;
  }
}

/**
 * En-tête `Authorization` OAuth 1.0a.
 *
 * Exporté pour être testable : la construction de cet en-tête est la seule partie du
 * protocole où une erreur est silencieuse côté client et bruyante côté Discogs.
 */
export function buildAuthorizationHeader(params: Record<string, string>): string {
  const encoded = Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}="${encodeURIComponent(value)}"`)
    .join(', ');

  return `OAuth ${encoded}`;
}

function baseParams(): Record<string, string> {
  const env = getEnv();

  return {
    oauth_consumer_key: env.DISCOGS_CONSUMER_KEY,
    oauth_nonce: randomBytes(16).toString('hex'),
    oauth_signature_method: 'PLAINTEXT',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: '1.0',
  };
}

/** Signature PLAINTEXT : `consumerSecret&tokenSecret`, chaque partie encodée. */
function plaintextSignature(tokenSecret = ''): string {
  const env = getEnv();
  return `${encodeURIComponent(env.DISCOGS_CONSUMER_SECRET)}&${encodeURIComponent(tokenSecret)}`;
}

async function discogsFetch(url: string, authorization: string): Promise<string> {
  const env = getEnv();

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: authorization,
        // Sans User-Agent identifiant, Discogs répond 403 (SPEC-GAPS G-04).
        'User-Agent': env.DISCOGS_USER_AGENT,
        Accept: '*/*',
      },
      // Discogs est derrière Cloudflare : un appel bloqué ne doit pas pendre.
      signal: AbortSignal.timeout(10_000),
    });
  } catch (cause) {
    throw new DiscogsOAuthError('Discogs est injoignable', undefined, { cause });
  }

  const body = await response.text();

  if (!response.ok) {
    // Le corps peut contenir une page Cloudflare entière : on ne le propage pas.
    throw new DiscogsOAuthError(`Discogs a répondu ${response.status}`, response.status);
  }

  return body;
}

function parseFormEncoded(body: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body).entries());
}

/** Étape 1 : obtenir un request token, en imposant notre URL de callback. */
export async function requestToken(): Promise<OAuthTokenPair> {
  const env = getEnv();

  const authorization = buildAuthorizationHeader({
    ...baseParams(),
    oauth_signature: plaintextSignature(),
    oauth_callback: env.DISCOGS_CALLBACK_URL,
  });

  const parsed = requestTokenSchema.safeParse(
    parseFormEncoded(await discogsFetch(env.DISCOGS_REQUEST_TOKEN_URL, authorization)),
  );

  if (!parsed.success) {
    throw new DiscogsOAuthError('Réponse de request token inexploitable');
  }

  return { token: parsed.data.oauth_token, tokenSecret: parsed.data.oauth_token_secret };
}

/** Étape 2 : l'URL vers laquelle rediriger l'utilisateur pour qu'il autorise l'accès. */
export function authorizeUrl(token: string): string {
  const url = new URL(getEnv().DISCOGS_AUTHORIZE_URL);
  url.searchParams.set('oauth_token', token);
  return url.toString();
}

/** Étape 3 : échanger le verifier contre un access token durable. */
export async function accessToken(
  requestTokenPair: OAuthTokenPair,
  verifier: string,
): Promise<OAuthTokenPair> {
  const authorization = buildAuthorizationHeader({
    ...baseParams(),
    oauth_token: requestTokenPair.token,
    oauth_signature: plaintextSignature(requestTokenPair.tokenSecret),
    oauth_verifier: verifier,
  });

  const parsed = accessTokenSchema.safeParse(
    parseFormEncoded(await discogsFetch(getEnv().DISCOGS_ACCESS_TOKEN_URL, authorization)),
  );

  if (!parsed.success) {
    throw new DiscogsOAuthError('Réponse d’access token inexploitable');
  }

  return { token: parsed.data.oauth_token, tokenSecret: parsed.data.oauth_token_secret };
}

/** Étape 4 : identité du titulaire du jeton. */
export async function identity(pair: OAuthTokenPair): Promise<DiscogsIdentity> {
  const authorization = buildAuthorizationHeader({
    ...baseParams(),
    oauth_token: pair.token,
    oauth_signature: plaintextSignature(pair.tokenSecret),
  });

  const body = await discogsFetch(`${getEnv().DISCOGS_API_BASE_URL}/oauth/identity`, authorization);

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch (cause) {
    throw new DiscogsOAuthError('Réponse d’identité illisible', undefined, { cause });
  }

  const parsed = identitySchema.safeParse(json);
  if (!parsed.success) {
    throw new DiscogsOAuthError('Réponse d’identité inexploitable');
  }

  return parsed.data;
}
