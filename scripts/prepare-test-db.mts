/**
 * Prépare la base de test (§22.2).
 *
 * Les tests d'intégration partagent PostgreSQL avec le développement local, où tournent
 * un worker et une vraie collection. Sans base dédiée, le worker consomme les tâches
 * créées par les tests et le nettoyage des tests menace les données réelles : les deux
 * incidents ont été observés. Une base séparée supprime la classe entière de problèmes.
 */
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { testDatabaseUrl } from './test-database-url.mts';

const target = new URL(testDatabaseUrl(process.env.DATABASE_URL ?? ''));
const databaseName = target.pathname.slice(1);

// On se connecte à la base d'administration pour pouvoir créer la base de test.
const adminUrl = new URL(target);
adminUrl.pathname = '/postgres';

const admin = postgres(adminUrl.toString(), { max: 1 });
const existing = await admin`select 1 from pg_database where datname = ${databaseName}`;

if (existing.length === 0) {
  await admin.unsafe(`create database "${databaseName}"`);
  console.log(`base de test créée : ${databaseName}`);
} else {
  console.log(`base de test déjà présente : ${databaseName}`);
}

await admin.end();

const client = postgres(target.toString(), { max: 1 });
await migrate(drizzle(client), { migrationsFolder: './src/db/migrations' });
await client.end();

console.log('migrations appliquées sur la base de test');
