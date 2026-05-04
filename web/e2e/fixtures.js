import { test as base, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TEST_USER = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  email: 'test@example.com',
  display_name: 'Test User',
};

const now = Date.now() / 1000;

export const TEST_SESSION = {
  access_token: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYWFhYWFhYS1iYmJiLWNjY2MtZGRkZC1lZWVlZWVlZWVlZWUiLCJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20iLCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImV4cCI6OTk5OTk5OTk5OX0.fake',
  refresh_token: 'fake-refresh-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(now) + 3600,
  user: {
    id: TEST_USER.id,
    email: TEST_USER.email,
    app_metadata: { provider: 'email' },
    user_metadata: { display_name: TEST_USER.display_name },
    aud: 'authenticated',
    role: 'authenticated',
    created_at: '2026-01-01T00:00:00Z',
  },
};

export const MOCK_FILES = [
  { name: 'Documents', path: 'Documents', type: 'directory', size: 0, modified: '2026-04-01T00:00:00Z', extension: null },
  { name: 'Photos', path: 'Photos', type: 'directory', size: 0, modified: '2026-03-15T00:00:00Z', extension: null },
  { name: 'readme.txt', path: 'readme.txt', type: 'file', size: 1024, modified: '2026-04-10T12:00:00Z', extension: 'txt' },
  { name: 'report.pdf', path: 'report.pdf', type: 'file', size: 204800, modified: '2026-04-09T08:30:00Z', extension: 'pdf' },
  { name: 'demo.mp4', path: 'demo.mp4', type: 'file', size: 52428800, modified: '2026-04-08T16:00:00Z', extension: 'mp4' },
];

const SUBFOLDER_FILES = [
  { name: 'notes.txt', path: 'Documents/notes.txt', type: 'file', size: 512, modified: '2026-04-02T10:00:00Z', extension: 'txt' },
  { name: 'data.csv', path: 'Documents/data.csv', type: 'file', size: 2048, modified: '2026-04-03T14:00:00Z', extension: 'csv' },
];

// Supabase localStorage key (matches the project URL used in build)
const SB_STORAGE_KEY = 'sb-cuqurazxkyotoqsznjil-auth-token';

// ---------------------------------------------------------------------------
// mockApi fixture — intercepts all API & Supabase network calls
// ---------------------------------------------------------------------------

async function setupMockApi(page, fileOverrides) {
  const files = fileOverrides || MOCK_FILES;

  // ---- Supabase GoTrue ----
  await page.route('**/auth/v1/token*', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(TEST_SESSION),
    });
  });

  await page.route('**/auth/v1/user', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(TEST_SESSION.user),
    });
  });

  await page.route('**/auth/v1/signup', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(TEST_SESSION),
    });
  });

  await page.route('**/auth/v1/logout', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  // ---- Supabase REST (profiles, etc.) ----
  await page.route('**/rest/v1/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  // ---- API auth routes ----
  await page.route('**/api/auth/signup', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ session: TEST_SESSION, user: TEST_SESSION.user }),
    });
  });

  await page.route('**/api/auth/studio', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ session: TEST_SESSION, user: TEST_SESSION.user }),
    });
  });

  // ---- NAS routes ----
  await page.route('**/api/nas/health', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ connected: true }),
    });
  });

  await page.route(url => url.pathname.endsWith('/api/nas/list'), (route) => {
    const url = new URL(route.request().url());
    const reqPath = url.searchParams.get('path') || '/';
    // Return subfolder files when navigating into a folder
    const listing = reqPath === '/' || reqPath === '' ? files : SUBFOLDER_FILES;
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ path: reqPath, items: listing }),
    });
  });

  await page.route('**/api/nas/upload', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    });
  });

  await page.route('**/api/nas/mkdir', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });

  await page.route('**/api/nas/delete', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });

  await page.route(url => url.pathname.startsWith('/api/nas/thumb'), (route) => {
    route.fulfill({ status: 404, body: '' });
  });

  await page.route('**/api/nas/storage', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ total: 60_000_000_000_000, used: 12_000_000_000_000, free: 48_000_000_000_000 }),
    });
  });

  // ---- Shares, keys, favorites ----
  await page.route('**/api/shares**', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });

  await page.route('**/api/keys**', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });

  await page.route('**/api/nas/favorites**', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export const test = base.extend({
  // Provides setupMockApi bound to the current page
  mockApi: async ({ page }, use) => {
    await setupMockApi(page);
    await use({ page, setupMockApi: (files) => setupMockApi(page, files) });
  },

  // Seeds auth session into localStorage then navigates with all mocks active
  authenticatedPage: async ({ page }, use) => {
    // Polyfill navigator.locks — headless Chromium can pass a null lock to
    // callbacks, which Supabase auth-js interprets as a failed acquisition,
    // causing getSession() to return null.
    await page.addInitScript(() => {
      if (navigator.locks) {
        navigator.locks.request = async function (name, optionsOrFn, maybeFn) {
          const fn = typeof optionsOrFn === 'function' ? optionsOrFn : maybeFn;
          return fn({ name, mode: 'exclusive' });
        };
      }
    });

    // Seed Supabase session before navigating
    await page.addInitScript(({ key, session }) => {
      window.localStorage.setItem(key, JSON.stringify(session));
    }, { key: SB_STORAGE_KEY, session: TEST_SESSION });

    await setupMockApi(page);
    await page.goto('/');
    // Wait for Drive to load
    await page.locator('text=Connected').waitFor({ timeout: 10_000 });
    await use(page);
  },
});

export { expect };
