import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.APP_BASE_URL ?? 'http://localhost:3004';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: { baseURL, trace: 'on-first-retry' },
  projects: [
    // §20.2 et §22.5 : les parcours sont validés en priorité sur petit mobile.
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
