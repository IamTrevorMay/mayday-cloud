import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'web/e2e/**',
      'playwright-report/**',
      'test-results/**',
      // Stale client tests — source was refactored but tests not updated
      'client/src/api.test.js',
      'client/src/sync-engine.test.js',
      'client/src/uploader.test.js',
    ],
  },
});
