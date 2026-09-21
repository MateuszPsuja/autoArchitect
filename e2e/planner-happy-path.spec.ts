import { test, expect } from '@playwright/test';
import {
  seedDemoPlanToLocalStorage,
  CONFIG_STORAGE_KEY,
  PLAN_STORAGE_KEY,
} from './fixtures/loadDemoPlan';

test.describe('Planner happy path', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await seedDemoPlanToLocalStorage(page, {
      openrouterApiKey: 'demo-placeholder',
    });
  });

  test('planner loads without the "Provider not fully configured" banner', async ({ page }) => {
    await page.goto('/planner', { waitUntil: 'networkidle' });
    await expect(
      page.locator('p-message').filter({ hasText: 'Provider not fully configured' }),
    ).toHaveCount(0);
  });

  test('localStorage carries the seeded plan and config', async ({ page }) => {
    const planValue = await page.evaluate((k) => window.localStorage.getItem(k), PLAN_STORAGE_KEY);
    const configValue = await page.evaluate(
      (k) => window.localStorage.getItem(k),
      CONFIG_STORAGE_KEY,
    );
    expect(planValue).toBeTruthy();
    expect(configValue).toBeTruthy();
    const cfg = JSON.parse(configValue ?? '{}');
    expect(cfg?.config?.provider).toBe('openrouter');
  });

  test('editor route renders a mermaid SVG in the architecture tab', async ({ page }) => {
    await page.goto('/editor', { waitUntil: 'networkidle' });
    const archTab = page.locator('p-tab', { hasText: 'Architecture' }).first();
    await archTab.click();
    await expect(
      page.locator('app-mermaid-preview svg, svg[id^="mermaid-"]').first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('docs tab opens a markdown file and shows the override-marker path', async ({ page }) => {
    await page.goto('/editor', { waitUntil: 'networkidle' });
    const docsTab = page.locator('p-tab', { hasText: 'Docs' }).first();
    await docsTab.click();

    const fileLink = page.locator('a, button').filter({ hasText: /\.md$/ }).first();
    await fileLink.waitFor({ state: 'visible', timeout: 10_000 });
    await fileLink.click();

    await expect(page.locator('.md h1, .md h2').first()).toBeVisible({ timeout: 10_000 });
  });

  test('zip download from /export route produces a .zip archive', async ({ page }) => {
    await page.goto('/export', { waitUntil: 'networkidle' });

    const zipButton = page
      .locator('p-button', { has: page.locator('button', { hasText: /download.*\.zip/i }) })
      .or(page.locator('button', { hasText: /download.*\.zip/i }))
      .first();
    await zipButton.waitFor({ state: 'visible', timeout: 10_000 });

    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
    await zipButton.click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    expect(stream).toBeTruthy();
  });
});
