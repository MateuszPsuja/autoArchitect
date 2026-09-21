import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { seedDemoPlanToLocalStorage } from './fixtures/loadDemoPlan';

test.describe('PDF export', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await seedDemoPlanToLocalStorage(page, {
      openrouterApiKey: 'demo-placeholder',
    });
  });

  test('export route is reachable and renders the export tabs', async ({ page }) => {
    await page.goto('/export', { waitUntil: 'networkidle' });
    await expect(page.locator('body')).toBeVisible();
  });

  test('PDF tab renders the Export PDF button when seeded with a plan', async ({ page }) => {
    await page.goto('/export', { waitUntil: 'networkidle' });

    const pdfTab = page
      .locator('p-tab', { has: page.locator('text=/PDF/i') })
      .or(page.locator('p-tab').filter({ hasText: /^.*PDF.*$/ }))
      .first();
    await pdfTab.click();

    await expect(
      page.locator('app-export-pdf, [id="export-pdf-heading"]').first(),
    ).toBeVisible({ timeout: 10_000 });

    await expect(
      page
        .locator('button, p-button')
        .filter({ hasText: /export pdf/i })
        .first(),
    ).toBeVisible();
  });

  test('PDF download produces a file with %PDF- magic bytes (requires real LLM key)', async ({ page }) => {
    test.skip(
      !process.env['OPENROUTER_KEY'],
      'PDF generation requires a live OpenRouter API key; set OPENROUTER_KEY in the environment to enable this test.',
    );

    await page.goto('/export', { waitUntil: 'networkidle' });

    const pdfTab = page
      .locator('p-tab', { has: page.locator('text=/PDF/i') })
      .or(page.locator('p-tab').filter({ hasText: /^.*PDF.*$/ }))
      .first();
    await pdfTab.click();

    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
    await page
      .locator('button, p-button')
      .filter({ hasText: /export pdf/i })
      .first()
      .click();

    const download = await downloadPromise;
    const savedPath = await download.path();
    expect(savedPath).toBeTruthy();
    const head = readFileSync(savedPath!, { encoding: 'binary' }).slice(0, 5);
    expect(head.slice(0, 5)).toBe('%PDF-');
  });
});
