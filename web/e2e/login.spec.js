const { test, expect } = require('@playwright/test');

test.describe('Login page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    // Wait for auth loading state to resolve before testing UI
    await page.waitForSelector('h1:has-text("Mayday Cloud")', { timeout: 10000 });
  });

  test('renders the login page with branding', async ({ page }) => {
    await expect(page.locator('h1')).toHaveText('Mayday Cloud');
    await expect(page.locator('text=Your private cloud storage')).toBeVisible();
  });

  test('shows Sign In tab active by default', async ({ page }) => {
    await expect(page.locator('input[placeholder="Email"]')).toBeVisible();
    await expect(page.locator('input[placeholder="Password"]')).toBeVisible();
    await expect(page.locator('form button[type="submit"]')).toBeVisible();
  });

  test('switches to Sign Up tab', async ({ page }) => {
    await page.click('button:has-text("Sign Up")');
    await expect(page.locator('input[placeholder="Display name (optional)"]')).toBeVisible();
    await expect(page.locator('input[placeholder="Email"]')).toBeVisible();
    await expect(page.locator('input[placeholder="Password (min 8 characters)"]')).toBeVisible();
    await expect(page.locator('button:has-text("Create Account")')).toBeVisible();
  });

  test('shows Studio login form when button clicked', async ({ page }) => {
    await page.click('button:has-text("Sign in with Mayday Studio")');
    await expect(page.locator('input[placeholder="Studio email"]')).toBeVisible();
    await expect(page.locator('input[placeholder="Studio password"]')).toBeVisible();
    await expect(page.locator('button:has-text("Sign in with Studio")')).toBeVisible();
  });

  test('back link from Studio returns to Sign In', async ({ page }) => {
    await page.click('button:has-text("Sign in with Mayday Studio")');
    await page.click('button:has-text("Back to Cloud sign in")');
    await expect(page.locator('input[placeholder="Email"]')).toBeVisible();
    await expect(page.locator('input[placeholder="Password"]')).toBeVisible();
  });

  test('Sign In shows error on invalid credentials', async ({ page }) => {
    await page.fill('input[placeholder="Email"]', 'bad@example.com');
    await page.fill('input[placeholder="Password"]', 'wrongpassword');
    await page.click('form button[type="submit"]');
    // Should show an error (network error or invalid credentials)
    await expect(page.locator('text=/Invalid|error|failed|fetch/i')).toBeVisible({ timeout: 10000 });
  });

  test('Sign Up validates password length client-side', async ({ page }) => {
    await page.click('button:has-text("Sign Up")');
    await page.fill('input[placeholder="Email"]', 'test@example.com');
    await page.fill('input[placeholder="Password (min 8 characters)"]', 'short');
    await page.click('button:has-text("Create Account")');
    await expect(page.locator('text=Password must be at least 8 characters')).toBeVisible();
  });

  test('clears form fields when switching modes', async ({ page }) => {
    await page.fill('input[placeholder="Email"]', 'test@example.com');
    await page.fill('input[placeholder="Password"]', 'somepassword');
    await page.click('button:has-text("Sign Up")');
    const emailInput = page.locator('input[placeholder="Email"]');
    await expect(emailInput).toHaveValue('');
  });

  test('or divider is visible', async ({ page }) => {
    await expect(page.getByText('or', { exact: true })).toBeVisible();
  });

  test('Studio button is visible from Sign In and Sign Up tabs', async ({ page }) => {
    await expect(page.locator('button:has-text("Sign in with Mayday Studio")')).toBeVisible();
    await page.click('button:has-text("Sign Up")');
    await expect(page.locator('button:has-text("Sign in with Mayday Studio")')).toBeVisible();
  });
});
