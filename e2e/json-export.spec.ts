import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { seedDemoPlanToLocalStorage } from './fixtures/loadDemoPlan';

test.describe('JSON export', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await seedDemoPlanToLocalStorage(page, {
      openrouterApiKey: 'demo-placeholder',
    });
  });

  test('JSON tab renders the Download plan.json button when seeded with a plan', async ({
    page,
  }) => {
    await page.goto('/export', { waitUntil: 'networkidle' });

    const jsonTab = page
      .locator('p-tab', { has: page.locator('text=/JSON/i') })
      .or(page.locator('p-tab').filter({ hasText: /^.*JSON.*$/ }))
      .first();
    await jsonTab.click();

    await expect(
      page.locator('app-export-json, [id="export-json-heading"]').first(),
    ).toBeVisible({ timeout: 10_000 });

    await expect(
      page
        .locator('button, p-button')
        .filter({ hasText: /download plan\.json/i })
        .first(),
    ).toBeVisible();
  });

  test('JSON download fires with the expected filename and parses as the demo plan', async ({
    page,
  }) => {
    await page.goto('/export', { waitUntil: 'networkidle' });

    const jsonTab = page
      .locator('p-tab', { has: page.locator('text=/JSON/i') })
      .or(page.locator('p-tab').filter({ hasText: /^.*JSON.*$/ }))
      .first();
    await jsonTab.click();

    await expect(
      page.locator('app-export-json, [id="export-json-heading"]').first(),
    ).toBeVisible({ timeout: 10_000 });

    const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
    await page
      .locator('button, p-button')
      .filter({ hasText: /download plan\.json/i })
      .first()
      .click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^\d{3}-.+-plan\.json$/);

    const savedPath = await download.path();
    expect(savedPath).toBeTruthy();
    const text = readFileSync(savedPath!, 'utf8');
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const meta = parsed['meta'] as Record<string, unknown> | undefined;
    expect(meta).toBeTruthy();
    expect(typeof meta!['title']).toBe('string');
    expect(typeof meta!['featureSlug']).toBe('string');

    expect(page.url()).toContain('/export');
  });
});
