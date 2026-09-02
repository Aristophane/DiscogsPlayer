// Une seule source de secrets locaux : .env.local, comme pour l'application Next.
import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

config({ path: '.env.local' });

/**
 * Migrations : additives et réversibles (SPECIFICATION.md §24, discipline de travail).
 * Aucune migration déjà appliquée ne doit être modifiée.
 */
export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
});
