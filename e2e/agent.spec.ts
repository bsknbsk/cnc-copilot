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

  await page.goto('/agent');
  await page.waitForSelector('textarea');

  // Click New Session to ensure clean test state
  const newSessionBtn = page.locator('button:has-text("New Session")');
  if (await newSessionBtn.isVisible()) {
    await newSessionBtn.click();
    await page.waitForTimeout(500);
  }
});

test.describe('Shopfloor Agent Natural Replies and Multimodal', () => {
  test('greeting: natural conversational reply, plain bubble, no forbidden text', async ({ page }) => {
    const textarea = page.locator('textarea');
    await textarea.fill('hi');
    await page.locator('button:has(span:text-is("arrow_upward"))').click();

    // Within 30s a model bubble appears
    const modelBubble = page.locator('.prose').last();
    await expect(modelBubble).toBeVisible({ timeout: 30000 });

    // It is NOT the Diagnostic Resolution card
    const diagCard = page.locator('text=Diagnostic Resolution');
    expect(await diagCard.count()).toBe(0);

    // Reply is under 400 characters
    const replyText = (await modelBubble.textContent()) || '';
    expect(replyText.length).toBeLessThan(400);

    // Page has no forbidden text
    const bodyText = (await page.textContent('body')) || '';
    for (const forbidden of [
      'Fault Confidence',
      'Reasoning Chain',
      'VERIFIED',
      'High Precision',
      'ONLINE',
      'Inconel',
      'NODE ID',
    ]) {
      expect(bodyText).not.toContain(forbidden);
    }
  });

  test('general question: answers with plain markdown and mentions work offset/coordinate', async ({ page }) => {
    const textarea = page.locator('textarea');
    await textarea.fill('What does G54 do?');
    await page.locator('button:has(span:text-is("arrow_upward"))').click();

    // Model reply appears
    const modelBubble = page.locator('.prose').last();
    await expect(modelBubble).toBeVisible({ timeout: 45000 });

    // Reply mentions work offset or work coordinate
    const replyText = (await modelBubble.textContent()) || '';
    expect(replyText).toMatch(/work offset|work coordinate|coordinate system/i);

    // Not a diagnosis card
    const diagCard = page.locator('text=Diagnostic Resolution');
    expect(await diagCard.count()).toBe(0);
  });

  test('alarm: renders Diagnostic Resolution card with code SV0401, steps, no Fault Confidence', async ({ page }) => {
    const textarea = page.locator('textarea');
    await textarea.fill('Fanuc alarm SV0401 on X axis');
    await page.locator('button:has(span:text-is("arrow_upward"))').click();

    // Diagnostic Resolution card appears
    await expect(page.locator('text=Diagnostic Resolution')).toBeVisible({ timeout: 45000 });

    // Shows alarm code SV0401
    await expect(page.locator('.font-mono', { hasText: 'SV0401' }).first()).toBeVisible();

    // Has at least one step
    await expect(page.locator('ol li').first()).toBeVisible();

    // No Fault Confidence box
    const bodyText = (await page.textContent('body')) || '';
    expect(bodyText).not.toContain('Fault Confidence');
  });

  test('camera: live video preview, capture, use photo, thumbnail chip, model reply', async ({ page }) => {
    // Click camera button
    await page.locator('button[title*="Capture"]').first().click();

    // A video element is playing (<video>)
    const video = page.locator('video');
    await expect(video).toBeVisible({ timeout: 10000 });
    await page.waitForFunction(() => {
      const v = document.querySelector('video');
      return v && v.videoWidth > 0;
    });

    // Click "Capture"
    await page.locator('button:has-text("Capture")').click();

    // A preview appears with "Retake" and "Use photo"
    await expect(page.locator('button:has-text("Retake")')).toBeVisible();
    await expect(page.locator('button:has-text("Use photo")')).toBeVisible();

    // Click "Use photo"
    await page.locator('button:has-text("Use photo")').click();

    // Modal closes
    await expect(page.locator('text=Pendant Camera')).not.toBeVisible();

    // Thumbnail chip appears in composer
    await expect(page.locator('img[alt="Attachment thumbnail"]')).toBeVisible();

    // Send with text "What does this screen show?"
    const textarea = page.locator('textarea');
    await textarea.fill('What does this screen show?');
    await page.locator('button:has(span:text-is("arrow_upward"))').click();

    // Model reply appears
    await expect(
      page.locator('.prose').or(page.locator('text=Diagnostic Resolution')).last()
    ).toBeVisible({ timeout: 35000 });
  });

  test('attachment: set alarm.jpg on attachment input, thumbnail appears, remove (x) removes it', async ({ page }) => {
    // Upload attachment
    const fileInput = page.locator('input[type="file"][accept*="image/jpeg"]');
    await fileInput.setInputFiles('e2e/fixtures/alarm.jpg');

    // Thumbnail chip appears
    const thumbnail = page.locator('img[alt="Attachment thumbnail"]');
    await expect(thumbnail).toBeVisible({ timeout: 10000 });

    // Remove (x) removes it
    const removeBtn = page.locator('button[title="Remove image"], button[title="Remove attachment"]');
    await expect(removeBtn).toBeVisible();
    await removeBtn.click();
    await expect(thumbnail).not.toBeVisible();
  });

  test('voice: media recorder listening, stop, transcribing, input filled with transcript', async ({ page }) => {
    // Click VOICE AGENT to start recording
    const voiceBtn = page.locator('button:has-text("VOICE AGENT"), button:has-text("Voice Agent")');
    await voiceBtn.click();

    // Label shows LISTENING and timer increments
    await expect(page.locator('text=LISTENING')).toBeVisible({ timeout: 5000 });

    // Wait 6 seconds
    await page.waitForTimeout(6000);

    // Click again to stop
    await page.locator('button:has-text("LISTENING")').click();

    // TRANSCRIBING... appears
    await expect(page.locator('text=TRANSCRIBING...')).toBeVisible({ timeout: 5000 });

    // The text box ends up containing "feed" or "end mill" (case-insensitive)
    const textarea = page.locator('textarea');
    await expect(textarea).toHaveValue(/feed|end mill/i, { timeout: 30000 });
  });

  test('enter key: enter sends message, shift+enter inserts newline', async ({ page }) => {
    const textarea = page.locator('textarea');

    // Test Shift+Enter inserts newline
    await textarea.fill('Line 1');
    await textarea.press('Shift+Enter');
    await textarea.type('Line 2');
    const valueWithNewline = await textarea.inputValue();
    expect(valueWithNewline).toContain('\n');

    // Clear and test Enter sends message
    await textarea.fill('hello world test enter');
    await textarea.press('Enter');

    // Textarea is cleared on send
    await expect(textarea).toHaveValue('');

    // Message appears in user bubble
    await expect(page.locator('p:has-text("hello world test enter")').last()).toBeVisible();
  });

  test('unauthenticated: /api/agent/transcribe without token returns 401', async ({ request }) => {
    const res = await request.post('/api/agent/transcribe', {
      data: Buffer.from('test audio content'),
      headers: {
        'content-type': 'audio/webm',
      },
    });
    expect(res.status()).toBe(401);
  });
});
