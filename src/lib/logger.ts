/**
 * Journalisation structurée (SPECIFICATION.md §21.1).
 *
 * Contrat : aucun jeton, cookie, secret, ni contenu de callback OAuth ne doit atteindre
 * un log. La liste de redaction ci-dessous est une défense, pas une autorisation à
 * journaliser des objets sensibles — la règle reste de ne pas les passer au logger.
 */
import pino from 'pino';

import { getEnv } from '@/lib/env';

/** Chemins systématiquement masqués, quelle que soit la profondeur. */
const REDACTED_PATHS = [
  'password',
  'token',
  'accessToken',
  'access_token',
  'oauth_token',
  'oauth_token_secret',
  'oauth_verifier',
  'consumerSecret',
  'DISCOGS_CONSUMER_SECRET',
  'DISCOGS_PERSONAL_TOKEN',
  'YOUTUBE_API_KEY',
  'SESSION_SECRET',
  'CREDENTIAL_ENCRYPTION_KEY',
  'authorization',
  'cookie',
  'set-cookie',
];

const redactPaths = REDACTED_PATHS.flatMap((key) => [
  key,
  `*.${key}`,
  `*.*.${key}`,
  `headers.${key}`,
  `req.headers.${key}`,
]);

function createLogger(): pino.Logger {
  const env = getEnv();

  return pino({
    level: env.LOG_LEVEL,
    redact: { paths: redactPaths, censor: '[redacted]' },
    base: { service: 'discogs-player' },
    ...(env.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : {}),
  });
}

let cached: pino.Logger | undefined;

export function getLogger(): pino.Logger {
  cached ??= createLogger();
  return cached;
}

/**
 * Logger d'un module applicatif (§9.3). Le champ `module` est obligatoire dans les logs
 * afin de pouvoir isoler un sous-système en exploitation.
 */
export function moduleLogger(module: string): pino.Logger {
  return getLogger().child({ module });
}

/**
 * Identifiant de corrélation d'une requête (§17.8 `requestId`, §21.1 `request_id`).
 * Réutilise l'en-tête entrant s'il est plausible, sinon en génère un.
 */
export function requestId(headers?: Headers): string {
  const incoming = headers?.get('x-request-id');
  if (incoming && /^[A-Za-z0-9_-]{8,128}$/.test(incoming)) {
    return incoming;
  }
  return crypto.randomUUID();
}
