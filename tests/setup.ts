import { config } from 'dotenv';

import { testDatabaseUrl } from '../scripts/test-database-url.mts';
import '@testing-library/jest-dom/vitest';

/**
 * Les tests d'intégration parlent à la base locale ; les tests unitaires n'en ont pas
 * besoin mais partagent la même configuration validée. Aucun appel API réel : le mode
 * fournisseurs est forcé sur `fixtures` par la configuration Vitest (§22.3).
 */
config({ path: '.env.local' });

// Base dédiée aux tests : le développement local fait tourner un worker qui, sinon,
// consommerait les tâches créées ici, et le nettoyage des tests toucherait de vraies
// données. Les deux incidents ont été observés avant cette séparation.
process.env.DATABASE_URL = testDatabaseUrl(process.env.DATABASE_URL ?? '');
