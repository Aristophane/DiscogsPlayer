import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'node',
    include: [
      'tests/unit/**/*.test.ts',
      'tests/unit/**/*.test.tsx',
      'tests/integration/**/*.test.ts',
    ],
    // Les tests d'intégration partagent une base : les faire tourner en parallèle
    // provoquerait des interférences sur les mêmes lignes.
    fileParallelism: false,
    setupFiles: ['tests/setup.ts'],
    // §22.3 : aucun appel réseau réel en test.
    env: {
      PROVIDERS_MODE: 'fixtures',
      // Compte administrateur simulé, pour vérifier que le rôle vient bien de la
      // configuration et jamais du nom d'utilisateur (§5.2).
      ADMIN_DISCOGS_USER_IDS: '990000003',
    },
  },
});
