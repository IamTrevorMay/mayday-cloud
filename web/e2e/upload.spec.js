import { test, expect } from './fixtures.js';

// Helper: create a file and dispatch a change event on the hidden file input.
// We use Object.defineProperty so that the app's `e.target.value = ''` does not
// clear the FileList before the async handleUploadFiles reads it.
async function triggerUpload(page, fileName, content) {
  await page.evaluate(({ fileName, content }) => {
    const input = document.querySelector('input[type="file"]');
    const file = new File([content], fileName, { type: 'text/plain' });
    const dt = new DataTransfer();
    dt.items.add(file);
    Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { fileName, content });
}

test.describe('Upload flows', () => {
  test('upload via button', async ({ authenticatedPage: page }) => {
    let uploadCalled = false;
    await page.route('**/api/nas/upload', (route) => {
      uploadCalled = true;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });

    await triggerUpload(page, 'testfile.txt', 'hello world');
    await page.waitForTimeout(2_000);
    expect(uploadCalled).toBe(true);
  });

  test('multiple file upload', async ({ authenticatedPage: page }) => {
    // Chrome restricts synthetic DragEvent.dataTransfer.files, so we test
    // multi-file upload via the file input instead — same handleUploadFiles path.
    const uploadPaths = [];
    await page.route('**/api/nas/upload', (route) => {
      uploadPaths.push(route.request().url());
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });

    await page.evaluate(() => {
      const input = document.querySelector('input[type="file"]');
      const dt = new DataTransfer();
      dt.items.add(new File(['aaa'], 'file1.txt', { type: 'text/plain' }));
      dt.items.add(new File(['bbb'], 'file2.txt', { type: 'text/plain' }));
      Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await page.waitForTimeout(2_000);
    expect(uploadPaths.length).toBe(2);
  });

  test('upload error shows status', async ({ authenticatedPage: page }) => {
    await page.route('**/api/nas/upload', (route) => {
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Disk full' }) });
    });

    await triggerUpload(page, 'fail.txt', 'data');
    await expect(page.locator('text=Error').or(page.locator('text=Disk full'))).toBeVisible({ timeout: 5_000 });
  });

  test('mid-upload navigation does not crash', async ({ authenticatedPage: page }) => {
    await page.route('**/api/nas/upload', async (route) => {
      await new Promise((r) => setTimeout(r, 2_000));
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });

    await triggerUpload(page, 'slow.txt', 'data');

    // Navigate away mid-upload (Settings is outside <nav>)
    await page.locator('button:has-text("Settings")').click();
    await page.waitForTimeout(500);
    // Navigate back (My Files is inside <nav>)
    await page.locator('nav button:has-text("My Files")').click();
    // Page should not crash — file listing still visible
    await expect(page.locator('text=My Files').first()).toBeVisible({ timeout: 5_000 });
  });
});
