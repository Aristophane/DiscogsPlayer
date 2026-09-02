import { config } from 'dotenv';
import { defineConfig, devices } from '@playwright/test';

// Les specs amorcent la base servie par l'application lancée ci-dessous.
config({ path: '.env.local' });

const baseURL = process.env.APP_BASE_URL ?? 'http://localhost:3004';

export default defineConfig({
  testDir: './tests/e2e',
  // Les specs amorcent une base partagée avec l'application : en parallèle, chaque
  // worker rejouerait l'amorçage et effacerait les données des autres.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: { baseURL, trace: 'on-first-retry' },
  projects: [
    // §20.2 et §22.5 : les parcours sont validés en priorité sur petit mobile.
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    {
      // Tablette définie par sa taille d'écran plutôt que par un profil iPad : celui-ci
      // impose WebKit, un second navigateur à installer pour une couverture que §22.5
      // n'exige pas — c'est le rendu responsive qui est vérifié ici.
      name: 'tablette',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 820, height: 1180 },
        isMobile: false,
      },
    },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
