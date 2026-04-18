const { test, expect } = require('@playwright/test');

test.describe('Navigation and routing', () => {
  test('unauthenticated user is redirected to login', async ({ page }) => {
    await page.goto('/');
    // Wait for auth to resolve and redirect
    await page.waitForSelector('h1:has-text("Mayday Cloud")', { timeout: 10000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test('login page is accessible', async ({ page }) => {
    await page.goto('/login');
    await page.waitForSelector('h1:has-text("Mayday Cloud")', { timeout: 10000 });
    await expect(page.locator('h1')).toHaveText('Mayday Cloud');
  });

  test('unknown routes redirect to login', async ({ page }) => {
    await page.goto('/nonexistent-page');
    // Wait for auth to resolve and redirect
    await page.waitForSelector('h1:has-text("Mayday Cloud")', { timeout: 10000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test('drop page does not redirect to login', async ({ page }) => {
    await page.goto('/drop/some-token');
    // Drop page is public — should NOT redirect to login
    await expect(page).not.toHaveURL(/\/login/);
  });
});
