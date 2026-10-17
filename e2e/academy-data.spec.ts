import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const authFile = path.resolve('e2e/.auth/state.json');

test.beforeEach(async ({ page }) => {
  if (fs.existsSync(authFile)) {
    try {
      const state = JSON.parse(fs.readFileSync(authFile, 'utf8'));
      if (state.idb && state.idb.firebaseLocalStorageDb) {
        await page.goto('/api/health');
        await page.evaluate(async (dump) => {
          const dbName = 'firebaseLocalStorageDb';
          const stores = dump[dbName];
          if (!stores) return;
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 3000);
            const req = indexedDB.open(dbName, 1);
            req.onblocked = () => { clearTimeout(timer); resolve(); };
            req.onerror = () => { clearTimeout(timer); resolve(); };
            req.onupgradeneeded = () => {
              const db = req.result;
              for (const storeName of Object.keys(stores)) {
                if (!db.objectStoreNames.contains(storeName)) {
                  db.createObjectStore(storeName, { keyPath: 'fbase_key' });
                }
              }
            };
            req.onsuccess = () => {
              const db = req.result;
              const storeNames = Object.keys(stores).filter((s) => db.objectStoreNames.contains(s));
              if (storeNames.length === 0) {
                db.close();
                clearTimeout(timer);
                resolve();
                return;
              }
              const tx = db.transaction(storeNames, 'readwrite');
              for (const storeName of storeNames) {
                const store = tx.objectStore(storeName);
                for (const item of stores[storeName]) {
                  store.put(item);
                }
              }
              tx.oncomplete = () => {
                db.close();
                clearTimeout(timer);
                resolve();
              };
              tx.onerror = () => {
                db.close();
                clearTimeout(timer);
                resolve();
              };
            };
          });
        }, state.idb);
      }
    } catch (err) {
      console.warn('[test] Could not restore IndexedDB state:', err);
    }
  }
});

test.describe('Academy Trainee Data & Interactive Controls', () => {
  test('opening /academy creates trainee and Learners shows at least 1', async ({ page }) => {
    await page.goto('/academy');

    // Wait for the Training Path to be visible
    await expect(page.locator('text=TRAINING PATH')).toBeVisible({ timeout: 15000 });

    // Locate the Learners count within the Learners card
    const learnersCard = page.locator('div.grid > div').filter({ hasText: 'Learners' });
    const learnersValue = learnersCard.locator('.text-headline-lg');

    await expect(learnersValue).toBeVisible({ timeout: 10000 });

    // Poll until learners count is at least 1 (after enroll completes and onSnapshot receives data)
    await expect.poll(async () => {
      const text = await learnersValue.textContent();
      return parseInt(text?.trim() || '0', 10);
    }, { timeout: 20000, intervals: [500, 1000] }).toBeGreaterThanOrEqual(1);
  });

  test('badge icon has a tooltip and opens the drawer', async ({ page }) => {
    await page.goto('/academy');
    await expect(page.locator('text=TRAINING PATH')).toBeVisible({ timeout: 15000 });

    // Find the badge buttons
    const badgeBtn = page.locator('button[title="Offset Master"]');
    await expect(badgeBtn).toBeVisible({ timeout: 10000 });
    await expect(badgeBtn).toHaveAttribute('aria-label', 'Offset Master');

    // Verify all 4 badge buttons have title and aria-label
    for (const label of ['Offset Master', 'Safe Approach', 'Tap Whisperer', 'Safe Starter']) {
      const btn = page.locator(`button[title="${label}"]`);
      await expect(btn).toBeVisible();
      await expect(btn).toHaveAttribute('aria-label', label);
    }

    // Clicking opens the drawer
    await badgeBtn.click();
    const drawerTitle = page.locator('text=Academy Badges Shelf');
    await expect(drawerTitle).toBeVisible({ timeout: 5000 });

    // Verify badges are listed in the drawer
    await expect(page.locator('text=Activate tool length compensation').first()).toBeVisible();

    // Close the drawer
    const closeBtn = drawerTitle.locator('xpath=ancestor::div[contains(@class, "fixed")]').locator('button:has(span:text-is("close"))');
    await closeBtn.click();
    await expect(drawerTitle).not.toBeVisible({ timeout: 5000 });
  });

  test('no button on the map is a no-op', async ({ page }) => {
    await page.goto('/academy');
    await expect(page.locator('text=TRAINING PATH')).toBeVisible({ timeout: 15000 });

    // 1. Badge shelf button click opens drawer (DOM change)
    const badgeBtn = page.locator('button[title="Offset Master"]');
    await expect(badgeBtn).toBeVisible({ timeout: 10000 });
    await badgeBtn.click();
    const badgesDrawer = page.locator('text=Academy Badges Shelf');
    await expect(badgesDrawer).toBeVisible();

    // Close drawer
    const drawerClose = badgesDrawer.locator('xpath=ancestor::div[contains(@class, "fixed")]').locator('button:has(span:text-is("close"))');
    await drawerClose.click();
    await expect(badgesDrawer).not.toBeVisible();

    // 2. Admin roster button if visible
    const viewTraineesBtn = page.locator('button:has-text("View trainees")');
    if (await viewTraineesBtn.isVisible()) {
      const traineesPromise = page.waitForResponse((r) => r.url().includes('/api/academy/trainees') && r.status() === 200);
      await viewTraineesBtn.click();
      await traineesPromise;
      const rosterDrawer = page.locator('text=Academy Trainees Roster');
      await expect(rosterDrawer).toBeVisible({ timeout: 10000 });

      // Close drawer
      const rosterClose = rosterDrawer.locator('xpath=ancestor::div[contains(@class, "fixed")]').locator('button:has(span:text-is("close"))');
      await rosterClose.click();
      await expect(rosterDrawer).not.toBeVisible();
    }

    // 3. Mission card click navigates to mission view (Navigation / DOM change)
    // Wait for Mission 01 to be interactive (status current or passed)
    await expect(page.locator('text=START MISSION').or(page.locator('text=REPLAY MISSION')).first()).toBeVisible({ timeout: 15000 });
    const mission1Card = page.locator('text=The Missing Offset').locator('xpath=ancestor::div[contains(@class, "cursor-pointer")]').first();
    await expect(mission1Card).toBeVisible();
    await mission1Card.click();

    // MissionView should appear with instructor panel or simulation button
    await expect(page.locator('text=Gemini instructor')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('button:has-text("Run Simulation")')).toBeVisible({ timeout: 10000 });

    // Navigate back to Academy Map
    const backBtn = page.locator('button:has-text("Back to Map")');
    await expect(backBtn).toBeVisible({ timeout: 10000 });
    await backBtn.click();

    // Verify we are back on the Academy Map
    await expect(page.locator('text=TRAINING PATH')).toBeVisible({ timeout: 10000 });
  });
});
