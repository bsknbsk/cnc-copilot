import { test, expect } from '@playwright/test';

test.describe('Machining Calculator and 3D Simulation', () => {
  test('renders 3D simulation canvas and operates playback controls', async ({ page }) => {
    await page.goto('/calculator');

    // Verify header and page title
    await expect(page.locator('h1:has-text("Machining Calculator")')).toBeVisible({ timeout: 10000 });

    // Verify Kienzle Force V4.2 label was removed
    await expect(page.locator('text=Kinematic Engine: Kienzle Force V4.2')).not.toBeVisible();

    // Verify Turning option is removed from tabs
    await expect(page.locator('button:has-text("Turning")')).not.toBeVisible();

    // Verify remaining tabs are present
    await expect(page.locator('button:has-text("Milling")')).toBeVisible();
    await expect(page.locator('button:has-text("Drilling")')).toBeVisible();
    await expect(page.locator('button:has-text("Tapping")')).toBeVisible();
    await expect(page.locator('button:has-text("Boring")')).toBeVisible();

    // Verify 3D canvas is mounted
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    // Verify simulation overlay text
    await expect(page.locator('text=Simulation: Tool Contact & Chip Geometry')).toBeVisible();

    // Verify physics metrics are computed and displayed
    await expect(page.locator('text=Spindle Speed (n)')).toBeVisible();
    await expect(page.locator('text=Feed Rate (Vf)')).toBeVisible();
    await expect(page.locator('text=Spindle Torque')).toBeVisible();
    await expect(page.locator('text=Material Removal Rate')).toBeVisible();

    // Verify simulation controls: Pause / Play toggle
    const pauseBtn = page.locator('button[aria-label="Pause Simulation"]');
    await expect(pauseBtn).toBeVisible();
    await pauseBtn.click();

    const playBtn = page.locator('button[aria-label="Play Simulation"]');
    await expect(playBtn).toBeVisible();
    await playBtn.click();
    await expect(page.locator('button[aria-label="Pause Simulation"]')).toBeVisible();

    // Verify Speed multiplier toggle
    const speedBtn = page.locator('button:has-text("1x")');
    await expect(speedBtn).toBeVisible();
    await speedBtn.click();
    await expect(page.locator('button:has-text("1.5x")')).toBeVisible();

    // Verify Replay resets simulation
    const replayBtn = page.locator('button[aria-label="Reset View"]');
    await expect(replayBtn).toBeVisible();
    await replayBtn.click();
  });
});
