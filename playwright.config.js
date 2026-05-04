import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './web/e2e',
  timeout: 30_000,
  retries: 0,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  webServer: {
    command: 'npx serve web/build -l 5173 -s',
    port: 5173,
    reuseExistingServer: !process.env.CI,
  },
});
