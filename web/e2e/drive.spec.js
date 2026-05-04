import { test, expect, MOCK_FILES } from './fixtures.js';

test.describe('Drive — file browser', () => {
  test('file listing renders', async ({ authenticatedPage: page }) => {
    for (const f of MOCK_FILES) {
      await expect(page.locator(`text=${f.name}`).first()).toBeVisible();
    }
  });

  test('navigate into folder and back via breadcrumb', async ({ authenticatedPage: page }) => {
    // Click the "Documents" folder row in the file list (not sidebar)
    await page.locator('text=Documents').first().click();
    // Subfolder files should appear
    await expect(page.locator('text=notes.txt')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('text=data.csv')).toBeVisible();
    // Click the breadcrumb "My Files" (not the sidebar one which has an svg icon)
    await page.locator('button:has-text("My Files")').filter({ hasNot: page.locator('svg') }).click();
    // Root files restored
    await expect(page.locator('text=readme.txt')).toBeVisible({ timeout: 5_000 });
  });

  test('create folder', async ({ authenticatedPage: page }) => {
    let mkdirCalled = false;
    await page.route('**/api/nas/mkdir', (route) => {
      mkdirCalled = true;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });

    await page.click('[title="New folder"]');
    const input = page.locator('input[placeholder="Folder name..."]');
    await expect(input).toBeVisible({ timeout: 3_000 });
    await input.fill('Test Folder');
    await input.press('Enter');
    await page.waitForTimeout(500);
    expect(mkdirCalled).toBe(true);
  });

  test('sidebar navigation', async ({ authenticatedPage: page }) => {
    const sidebar = page.locator('nav');

    // Favorites
    await sidebar.locator('button:has-text("Favorites")').click();
    await expect(page.locator('text=Favorites').first()).toBeVisible();

    // Shared Links
    await sidebar.locator('button:has-text("Shared Links")').click();
    await expect(page.locator('text=Shared Links').first()).toBeVisible();

    // Trash
    await sidebar.locator('button:has-text("Trash")').click();
    await expect(page.locator('text=Trash').first()).toBeVisible();

    // Settings (not inside nav, but in sidebar area)
    await page.locator('button:has-text("Settings")').click();
    await expect(page.locator('text=Settings').first()).toBeVisible();

    // Back to My Files
    await sidebar.locator('button:has-text("My Files")').click();
    await expect(page.locator('text=readme.txt')).toBeVisible({ timeout: 5_000 });
  });

  test('status indicator shows Connected', async ({ authenticatedPage: page }) => {
    await expect(page.locator('text=Connected')).toBeVisible();
  });
});
