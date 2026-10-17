import { chromium } from '@playwright/test';

async function capture() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://localhost:3000/calculator');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'docs/after/calculator-screenshot.png', fullPage: true });
  console.log('Saved docs/after/calculator-screenshot.png');
  await browser.close();
}

capture().catch(console.error);
