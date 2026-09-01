/**
 * Connexion PostgreSQL partagée par l'application Web et le worker (§9.2).
 *
 * Un seul pool par processus : Next.js recharge les modules en développement, on
 * mémorise donc la connexion sur `globalThis` pour ne pas épuiser les connexions.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { getEnv } from '@/lib/env';

import * as schema from './schema';

type DbGlobal = typeof globalThis & {
  __discogsPlayerSql?: postgres.Sql;
};

function getSql(): postgres.Sql {
  const store = globalThis as DbGlobal;
  store.__discogsPlayerSql ??= postgres(getEnv().DATABASE_URL, {
    max: 10,
    // Les identifiants de connexion ne doivent jamais apparaître dans une trace.
    onnotice: () => {},
  });
  return store.__discogsPlayerSql;
}

export const sql = getSql();
export const db = drizzle(sql, { schema });

/** Sonde de disponibilité utilisée par `/api/health`. */
export async function checkDatabase(): Promise<{ ok: boolean; latencyMs: number }> {
  const startedAt = performance.now();
  await sql`select 1`;
  return { ok: true, latencyMs: Math.round(performance.now() - startedAt) };
}
