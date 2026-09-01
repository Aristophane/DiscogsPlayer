/**
 * Validation de l'environnement (SPECIFICATION.md §23.2).
 *
 * Toute variable externe traverse Zod : un démarrage avec une configuration invalide
 * doit échouer immédiatement et bruyamment, jamais produire un comportement dégradé
 * silencieux.
 *
 * Ce module est exclusivement serveur. Il ne doit jamais être importé depuis un
 * composant client : aucun secret ne franchit la frontière réseau (§18.1).
 */
import { z } from 'zod';

const httpUrl = z
  .string()
  .min(1)
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'doit être une URL http(s) absolue' },
  );

/** Clé AES-256-GCM : 32 octets exactement, encodés en base64. */
const base64Key32 = z
  .string()
  .min(1)
  .refine(
    (value) => {
      try {
        return Buffer.from(value, 'base64').length === 32;
      } catch {
        return false;
      }
    },
    { message: 'doit être 32 octets encodés en base64' },
  );

const csvNumericIds = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  )
  .refine((ids) => ids.every((id) => /^\d+$/.test(id)), {
    message: 'doit être une liste d’identifiants Discogs numériques séparés par des virgules',
  });

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3004),
    APP_BASE_URL: httpUrl,
    DATABASE_URL: z.string().min(1),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    // Sessions et chiffrement (§11, §18.1)
    SESSION_SECRET: z.string().min(32),
    CREDENTIAL_ENCRYPTION_KEY: base64Key32,
    CREDENTIAL_ENCRYPTION_KEY_VERSION: z.coerce.number().int().positive().default(1),
    SESSION_IDLE_TTL_HOURS: z.coerce.number().int().positive().default(720),
    SESSION_ABSOLUTE_TTL_HOURS: z.coerce.number().int().positive().default(2160),

    // Discogs (§12)
    DISCOGS_CONSUMER_KEY: z.string().min(1),
    DISCOGS_CONSUMER_SECRET: z.string().min(1),
    DISCOGS_CALLBACK_URL: httpUrl,
    DISCOGS_REQUEST_TOKEN_URL: httpUrl.default('https://api.discogs.com/oauth/request_token'),
    DISCOGS_AUTHORIZE_URL: httpUrl.default('https://www.discogs.com/oauth/authorize'),
    DISCOGS_ACCESS_TOKEN_URL: httpUrl.default('https://api.discogs.com/oauth/access_token'),
    DISCOGS_API_BASE_URL: httpUrl.default('https://api.discogs.com'),
    // Obligatoire : l'API Discogs refuse les requêtes sans User-Agent identifiant.
    DISCOGS_USER_AGENT: z.string().min(1),
    DISCOGS_PERSONAL_TOKEN: z.string().optional(),

    // YouTube : quota compté en UNITÉS, pas en appels (ADR-0002, SPEC-GAPS G-01)
    YOUTUBE_API_KEY: z.string().optional(),
    YOUTUBE_DAILY_QUOTA_UNITS: z.coerce.number().int().positive().default(10_000),
    YOUTUBE_SEARCH_UNIT_COST: z.coerce.number().int().positive().default(100),
    YOUTUBE_VIDEOS_UNIT_COST: z.coerce.number().int().positive().default(1),
    YOUTUBE_SEARCH_RESERVE_UNITS: z.coerce.number().int().nonnegative().default(1_000),
    YOUTUBE_QUOTA_RESET_TIMEZONE: z.string().default('America/Los_Angeles'),
    // Politique YouTube : les métadonnées d'API ne survivent pas 30 jours (SPEC-GAPS G-02).
    PROVIDER_METADATA_MAX_AGE_DAYS: z.coerce.number().int().positive().max(30).default(30),

    SPOTIFY_OEMBED_URL: httpUrl.default('https://open.spotify.com/oembed'),

    ADMIN_DISCOGS_USER_IDS: csvNumericIds,

    WORKER_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),
    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1_000),
    WORKER_LOCK_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(300),

    RATELIMIT_PROPOSALS_PER_DAY: z.coerce.number().int().positive().default(50),
    RATELIMIT_CONFIRMATIONS_PER_DAY: z.coerce.number().int().positive().default(100),
    RATELIMIT_SYNC_PER_DAY: z.coerce.number().int().positive().default(10),

    PROVIDERS_MODE: z.enum(['live', 'fixtures']).default('live'),
    FIXTURES_LATENCY_MS: z.coerce.number().int().nonnegative().default(0),
    FIXTURES_ERROR_RATE: z.coerce.number().min(0).max(1).default(0),
  })
  .refine((env) => env.YOUTUBE_SEARCH_RESERVE_UNITS < env.YOUTUBE_DAILY_QUOTA_UNITS, {
    message:
      'YOUTUBE_SEARCH_RESERVE_UNITS doit être inférieur à YOUTUBE_DAILY_QUOTA_UNITS, sinon aucune recherche n’est jamais possible',
    path: ['YOUTUBE_SEARCH_RESERVE_UNITS'],
  })
  .refine((env) => env.SESSION_IDLE_TTL_HOURS <= env.SESSION_ABSOLUTE_TTL_HOURS, {
    message: 'SESSION_IDLE_TTL_HOURS ne peut pas dépasser SESSION_ABSOLUTE_TTL_HOURS',
    path: ['SESSION_IDLE_TTL_HOURS'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || !env.DISCOGS_PERSONAL_TOKEN, {
    // AUTH-003 : le jeton personnel est réservé au développement local.
    message: 'DISCOGS_PERSONAL_TOKEN est interdit en production (AUTH-003)',
    path: ['DISCOGS_PERSONAL_TOKEN'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.PROVIDERS_MODE === 'live', {
    message: 'PROVIDERS_MODE=fixtures est interdit en production',
    path: ['PROVIDERS_MODE'],
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Valide un jeu de variables. Exporté séparément de `env` pour être testable sans
 * dépendre du `process.env` réel.
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    // On énumère les *noms* de variables en défaut, jamais leurs valeurs (§18.1, §21.1).
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(racine)'} : ${issue.message}`)
      .join('\n');
    throw new Error(`Configuration d’environnement invalide :\n${details}`);
  }

  return result.data;
}

let cached: Env | undefined;

/** Environnement validé, mis en cache après le premier accès. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
