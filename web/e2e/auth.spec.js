import { test, expect, TEST_SESSION, TEST_USER } from './fixtures.js';

test.describe('Auth flows', () => {
  test('signup happy path', async ({ page, mockApi }) => {
    await page.goto('/');
    // Should show auth page
    await page.click('button:has-text("Sign Up")');
    await page.fill('input[placeholder="Display name (optional)"]', 'New User');
    await page.fill('input[placeholder="Email"]', 'new@example.com');
    await page.fill('input[placeholder="Password (min 8 characters)"]', 'password123');
    await page.click('button:has-text("Create Account")');
    // After signup, should land on Drive
    await expect(page.locator('text=My Files').first()).toBeVisible({ timeout: 10_000 });
  });

  test('login happy path', async ({ page, mockApi }) => {
    await page.goto('/');
    await page.click('button:has-text("Sign In")');
    await page.fill('input[placeholder="Email"]', TEST_USER.email);
    await page.fill('input[placeholder="Password"]', 'password123');
    await page.click('button[type="submit"]:has-text("Sign In")');
    await expect(page.locator('text=My Files').first()).toBeVisible({ timeout: 10_000 });
  });

  test('studio SSO happy path', async ({ page, mockApi }) => {
    await page.goto('/');
    await page.click('button:has-text("Sign in with Mayday Studio")');
    await page.fill('input[placeholder="Studio email"]', 'studio@example.com');
    await page.fill('input[placeholder="Studio password"]', 'studiopass123');
    await page.click('button:has-text("Sign in with Studio")');
    await expect(page.locator('text=My Files').first()).toBeVisible({ timeout: 10_000 });
  });

  test('login error displays message', async ({ page }) => {
    // Override Supabase token endpoint to return error
    await page.route('**/auth/v1/token**', (route) => {
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid login credentials' }),
      });
    });
    await page.route('**/rest/v1/**', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await page.route('**/auth/v1/user', (route) => {
      route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"not authenticated"}' });
    });

    await page.goto('/');
    await page.click('button:has-text("Sign In")');
    await page.fill('input[placeholder="Email"]', 'bad@example.com');
    await page.fill('input[placeholder="Password"]', 'wrongpass');
    await page.click('button[type="submit"]:has-text("Sign In")');
    // Error should be visible
    const error = page.locator('text=Invalid login credentials');
    await expect(error).toBeVisible({ timeout: 5_000 });
  });

  test('signup short password shows client-side error', async ({ page }) => {
    await page.route('**/auth/v1/**', (route) => {
      route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
    });
    await page.route('**/rest/v1/**', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await page.goto('/');
    await page.click('button:has-text("Sign Up")');
    await page.fill('input[placeholder="Email"]', 'short@example.com');
    await page.fill('input[placeholder="Password (min 8 characters)"]', 'short');
    await page.click('button:has-text("Create Account")');
    const error = page.locator('text=at least 8 characters');
    await expect(error).toBeVisible({ timeout: 5_000 });
  });

  test('session persistence — seeded localStorage skips login', async ({ authenticatedPage }) => {
    await expect(authenticatedPage.locator('text=My Files').first()).toBeVisible();
    await expect(authenticatedPage.locator('text=Connected')).toBeVisible();
  });
});
