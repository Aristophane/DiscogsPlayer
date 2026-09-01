import { describe, expect, it } from 'vitest';

import { parseEnv } from '@/lib/env';

/** Configuration minimale valide, réutilisée par chaque cas. */
function validEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    APP_BASE_URL: 'http://localhost:3004',
    DATABASE_URL: 'postgres://discogs:discogs@localhost:5433/discogs_player',
    SESSION_SECRET: 'a'.repeat(44),
    CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    DISCOGS_CONSUMER_KEY: 'key',
    DISCOGS_CONSUMER_SECRET: 'secret',
    DISCOGS_CALLBACK_URL: 'http://localhost:3004/api/auth/discogs/callback',
    DISCOGS_USER_AGENT: 'DiscogsPlayer/0.1 +http://localhost:3004',
    ...overrides,
  };
}

describe('parseEnv', () => {
  it('accepte une configuration minimale et applique les valeurs par défaut', () => {
    const env = parseEnv(validEnv());

    expect(env.PORT).toBe(3004);
    expect(env.PROVIDERS_MODE).toBe('live');
    expect(env.YOUTUBE_DAILY_QUOTA_UNITS).toBe(10_000);
    expect(env.YOUTUBE_SEARCH_UNIT_COST).toBe(100);
    expect(env.ADMIN_DISCOGS_USER_IDS).toEqual([]);
  });

  it('rejette une clé de chiffrement qui ne fait pas 32 octets', () => {
    expect(() =>
      parseEnv(validEnv({ CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') })),
    ).toThrow(/CREDENTIAL_ENCRYPTION_KEY/);
  });

  it('rejette une URL de base qui n’est pas http(s)', () => {
    expect(() => parseEnv(validEnv({ APP_BASE_URL: 'ftp://exemple.test' }))).toThrow(
      /APP_BASE_URL/,
    );
  });

  it('exige un User-Agent Discogs, sans lequel l’API répond 403', () => {
    expect(() => parseEnv(validEnv({ DISCOGS_USER_AGENT: undefined }))).toThrow(
      /DISCOGS_USER_AGENT/,
    );
  });

  it('découpe la liste des administrateurs et refuse un nom d’utilisateur (§5.2)', () => {
    expect(
      parseEnv(validEnv({ ADMIN_DISCOGS_USER_IDS: '123, 456' })).ADMIN_DISCOGS_USER_IDS,
    ).toEqual(['123', '456']);

    expect(() => parseEnv(validEnv({ ADMIN_DISCOGS_USER_IDS: 'wolfgang' }))).toThrow(
      /ADMIN_DISCOGS_USER_IDS/,
    );
  });

  it('refuse une réserve de quota qui rendrait toute recherche impossible (ADR-0002)', () => {
    expect(() =>
      parseEnv(
        validEnv({ YOUTUBE_DAILY_QUOTA_UNITS: '1000', YOUTUBE_SEARCH_RESERVE_UNITS: '1000' }),
      ),
    ).toThrow(/YOUTUBE_SEARCH_RESERVE_UNITS/);
  });

  it('interdit le jeton personnel Discogs en production (AUTH-003)', () => {
    expect(() =>
      parseEnv(validEnv({ NODE_ENV: 'production', DISCOGS_PERSONAL_TOKEN: 'jeton' })),
    ).toThrow(/DISCOGS_PERSONAL_TOKEN/);
  });

  it('interdit le mode fixtures en production', () => {
    expect(() =>
      parseEnv(validEnv({ NODE_ENV: 'production', PROVIDERS_MODE: 'fixtures' })),
    ).toThrow(/PROVIDERS_MODE/);
  });

  it('ne divulgue jamais la valeur d’un secret dans le message d’erreur (§18.1)', () => {
    // Trop court pour être accepté : l'échec doit nommer la variable, pas citer sa valeur.
    const secret = 'secret-trop-court';

    expect(() => parseEnv(validEnv({ SESSION_SECRET: secret }))).toThrow();

    try {
      parseEnv(validEnv({ SESSION_SECRET: secret }));
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
  });
});
