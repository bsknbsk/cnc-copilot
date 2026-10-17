import { test as setup } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const authFile = path.resolve('e2e/.auth/state.json');

setup('authenticate with Google', async ({ page }) => {
  setup.setTimeout(300000); // 5 minutes for user interaction

  if (fs.existsSync(authFile)) {
    try {
      const existing = JSON.parse(fs.readFileSync(authFile, 'utf8'));
      if (
        existing &&
        existing.idb &&
        existing.idb.firebaseLocalStorageDb &&
        existing.idb.firebaseLocalStorageDb.firebaseLocalStorage &&
        existing.idb.firebaseLocalStorageDb.firebaseLocalStorage.length > 0
      ) {
        console.log('[auth.setup] Valid auth state already exists at e2e/.auth/state.json');
        return;
      }
    } catch {
      // Re-authenticate
    }
  }

  console.log('[auth.setup] Opening CNC Copilot. Please complete Google Sign-In in the browser window...');
  await page.goto('/');

  // If signed out, click Sign in to trigger Google login popup automatically
  const signInBtn = page.locator('button[aria-label="Sign in with Google"]');
  try {
    if (await signInBtn.isVisible({ timeout: 5000 })) {
      console.log('[auth.setup] Triggering Google Sign-In popup...');
      await signInBtn.click();
    }
  } catch {
    // Already navigating or popup triggered
  }

  // Wait for user to sign in: User Profile Menu button appears when signed in
  const profileButton = page.locator('button[aria-label="User Profile Menu"]');
  await profileButton.waitFor({ state: 'visible', timeout: 300000 });

  // Wait for Firebase to finish writing credentials to IndexedDB
  await page.waitForTimeout(3000);

  // Extract IndexedDB databases and object stores
  const idbDump = await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    const result: Record<string, Record<string, any[]>> = {};
    for (const dbInfo of dbs) {
      if (!dbInfo.name) continue;
      await new Promise<void>((resolve) => {
        const req = indexedDB.open(dbInfo.name!);
        req.onsuccess = async () => {
          const db = req.result;
          const storeNames = Array.from(db.objectStoreNames);
          result[dbInfo.name!] = {};
          if (storeNames.length === 0) {
            db.close();
            resolve();
            return;
          }
          const tx = db.transaction(storeNames, 'readonly');
          for (const sName of storeNames) {
            const store = tx.objectStore(sName);
            await new Promise<void>((resStore) => {
              const allReq = store.getAll();
              allReq.onsuccess = () => {
                result[dbInfo.name!][sName] = allReq.result;
                resStore();
              };
              allReq.onerror = () => resStore();
            });
          }
          db.close();
          resolve();
        };
        req.onerror = () => resolve();
      });
    }
    return result;
  });

  const storage = await page.context().storageState();
  fs.mkdirSync(path.dirname(authFile), { recursive: true });
  fs.writeFileSync(authFile, JSON.stringify({ ...storage, idb: idbDump }, null, 2));
  console.log('[auth.setup] Auth state successfully saved to', authFile);
});
