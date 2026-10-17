import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const authFile = path.resolve('e2e/.auth/state.json');

async function capture() {
  const browser = await chromium.launch({ headless: true });
  
  // 1. Desktop screenshot (1440px)
  const desktopContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: fs.existsSync(authFile) ? authFile : undefined,
  });
  const desktopPage = await desktopContext.newPage();

  // Restore IndexedDB
  if (fs.existsSync(authFile)) {
    const state = JSON.parse(fs.readFileSync(authFile, 'utf8'));
    if (state.idb && state.idb.firebaseLocalStorageDb) {
      await desktopPage.goto('http://localhost:3000/api/health');
      await desktopPage.evaluate(async (dump) => {
        const dbName = 'firebaseLocalStorageDb';
        const stores = dump[dbName];
        if (!stores) return;
        await new Promise((resolve) => {
          const req = indexedDB.open(dbName, 1);
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
            if (storeNames.length === 0) { db.close(); resolve(); return; }
            const tx = db.transaction(storeNames, 'readwrite');
            for (const storeName of storeNames) {
              const store = tx.objectStore(storeName);
              for (const item of stores[storeName]) {
                store.put(item);
              }
            }
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => { db.close(); resolve(); };
          };
          req.onerror = () => resolve();
        });
      }, state.idb);
    }
  }

  await desktopPage.goto('http://localhost:3000/academy');
  await desktopPage.waitForSelector('text=TRAINING PATH', { timeout: 15000 });
  await desktopPage.waitForTimeout(2000); // allow onSnapshot to update
  await desktopPage.screenshot({ path: 'docs/after/academy-map-desktop.png', fullPage: true });
  console.log('Saved docs/after/academy-map-desktop.png');
  await desktopContext.close();

  // 2. Mobile screenshot (375px)
  const mobileContext = await browser.newContext({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
    storageState: fs.existsSync(authFile) ? authFile : undefined,
  });
  const mobilePage = await mobileContext.newPage();

  // Restore IndexedDB
  if (fs.existsSync(authFile)) {
    const state = JSON.parse(fs.readFileSync(authFile, 'utf8'));
    if (state.idb && state.idb.firebaseLocalStorageDb) {
      await mobilePage.goto('http://localhost:3000/api/health');
      await mobilePage.evaluate(async (dump) => {
        const dbName = 'firebaseLocalStorageDb';
        const stores = dump[dbName];
        if (!stores) return;
        await new Promise((resolve) => {
          const req = indexedDB.open(dbName, 1);
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
            if (storeNames.length === 0) { db.close(); resolve(); return; }
            const tx = db.transaction(storeNames, 'readwrite');
            for (const storeName of storeNames) {
              const store = tx.objectStore(storeName);
              for (const item of stores[storeName]) {
                store.put(item);
              }
            }
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => { db.close(); resolve(); };
          };
          req.onerror = () => resolve();
        });
      }, state.idb);
    }
  }

  await mobilePage.goto('http://localhost:3000/academy');
  await mobilePage.waitForSelector('text=TRAINING PATH', { timeout: 15000 });
  await mobilePage.waitForTimeout(2000);
  await mobilePage.screenshot({ path: 'docs/after/academy-map-mobile.png', fullPage: true });
  console.log('Saved docs/after/academy-map-mobile.png');
  await mobileContext.close();

  await browser.close();
}

capture().catch((err) => {
  console.error('Failed to capture screenshots:', err);
  process.exit(1);
});
