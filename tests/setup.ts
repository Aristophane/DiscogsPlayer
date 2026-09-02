import { config } from 'dotenv';
import '@testing-library/jest-dom/vitest';

/**
 * Les tests d'intégration parlent à la base locale ; les tests unitaires n'en ont pas
 * besoin mais partagent la même configuration validée. Aucun appel API réel : le mode
 * fournisseurs est forcé sur `fixtures` par la configuration Vitest (§22.3).
 */
config({ path: '.env.local' });
