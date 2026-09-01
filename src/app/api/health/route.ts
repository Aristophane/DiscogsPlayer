/**
 * Sonde de santé (SPECIFICATION.md §24, Lot 0).
 *
 * Renvoie l'état de l'application, de la base et des migrations. Volontairement sans
 * information sensible : cette route peut être appelée par un superviseur externe.
 */
import { NextResponse } from 'next/server';

import { checkDatabase, sql } from '@/db/client';
import { ApiError } from '@/lib/api-error';
import { getEnv } from '@/lib/env';
import { moduleLogger, requestId } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const log = moduleLogger('health');

/** Nombre de migrations Drizzle appliquées, ou `null` si la table n'existe pas encore. */
async function appliedMigrations(): Promise<number | null> {
  const rows = await sql<{ count: string }[]>`
    select count(*)::text as count
    from information_schema.tables
    where table_schema = 'drizzle' and table_name = '__drizzle_migrations'
  `;

  if (rows[0]?.count === '0') {
    return null;
  }

  const applied = await sql<{ count: string }[]>`
    select count(*)::text as count from drizzle.__drizzle_migrations
  `;
  return Number(applied[0]?.count ?? 0);
}

export async function GET(request: Request): Promise<NextResponse> {
  const id = requestId(request.headers);
  const env = getEnv();

  try {
    const database = await checkDatabase();
    const migrations = await appliedMigrations();

    return NextResponse.json(
      {
        status: 'ok',
        version: process.env.npm_package_version ?? '0.1.0',
        environment: env.NODE_ENV,
        providersMode: env.PROVIDERS_MODE,
        database,
        migrations: { applied: migrations },
        requestId: id,
      },
      { headers: { 'cache-control': 'no-store', 'x-request-id': id } },
    );
  } catch (cause) {
    log.error({ requestId: id, err: cause }, 'health check failed');

    return new ApiError({
      code: 'HEALTH_DATABASE_UNAVAILABLE',
      message: 'La base de données est momentanément indisponible.',
      status: 503,
      retryable: true,
      cause,
    }).toResponse(id);
  }
}
