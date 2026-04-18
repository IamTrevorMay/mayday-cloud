const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  // Build and serve static files instead of using dev server.
  // Avoids CRA/webpack issues with spaces in directory paths.
  webServer: {
    command: 'npx serve -s build -l 3000',
    port: 3000,
    timeout: 15000,
    reuseExistingServer: true,
  },
});
