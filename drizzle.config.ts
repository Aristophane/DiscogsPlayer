import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

/**
 * Migrations : additives et réversibles (SPECIFICATION.md §24, discipline de travail).
 * Aucune migration déjà appliquée ne doit être modifiée.
 */
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
});
