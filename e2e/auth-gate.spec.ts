import { test, expect } from '@playwright/test';

test.describe('Unauthenticated Shared Authentication Gates', () => {
  // Use a completely clean context without saved auth storage
  test.use({ storageState: { cookies: [], origins: [] } });

  test('/agent requires Google sign in and renders Landing Page', async ({ page }) => {
    await page.goto('/agent');
    await expect(page.locator('button:has-text("Sign in with Google")')).toBeVisible({ timeout: 10000 });
    // Shopfloor agent composer should not be visible
    await expect(page.locator('textarea')).not.toBeVisible();
  });

  test('/academy requires Google sign in and renders Landing Page', async ({ page }) => {
    await page.goto('/academy');
    await expect(page.locator('button:has-text("Sign in with Google")')).toBeVisible({ timeout: 10000 });
    // Mission map training path should not be visible
    await expect(page.locator('text=TRAINING PATH')).not.toBeVisible();
  });

  test('/kb requires Google sign in and renders Landing Page', async ({ page }) => {
    await page.goto('/kb');
    await expect(page.locator('button:has-text("Sign in with Google")')).toBeVisible({ timeout: 10000 });
    // Knowledge base upload should not be visible
    await expect(page.locator('text=Upload Manual')).not.toBeVisible();
  });
});
