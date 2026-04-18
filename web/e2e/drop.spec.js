const { test, expect } = require('@playwright/test');

test.describe('Drop page (public share links)', () => {
  test('shows error for invalid token', async ({ page }) => {
    await page.goto('/drop/invalid-token-123');
    // Should show some kind of error or "not found" state
    await expect(page.locator('text=/not found|invalid|expired|error/i')).toBeVisible({ timeout: 10000 });
  });

  test('renders drop page structure', async ({ page }) => {
    await page.goto('/drop/any-token');
    // The page should load without crashing, even if the token is invalid
    // Verify the page doesn't show a blank white screen
    await expect(page.locator('body')).not.toBeEmpty();
  });
});
