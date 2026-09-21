import { test, expect } from '@playwright/test';
import { CONFIG_STORAGE_KEY } from './fixtures/loadDemoPlan';

test.describe('Refine with questions flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(([configKey, configJson]) => {
      window.localStorage.setItem(configKey, configJson);
    }, [
      CONFIG_STORAGE_KEY,
      JSON.stringify({
        v: 3,
        config: {
          provider: 'openrouter',
          providerApiKeys: {
            openrouter: 'demo-placeholder',
            lmstudio: '',
            claude: '',
            chatgpt: '',
            grok: '',
            minimax: '',
          },
          providerConfigs: {
            openrouter: {
              selectedModel: 'anthropic/claude-3.5-sonnet',
              customBaseUrl: 'https://openrouter.ai/api/v1',
              defaultTemperature: 0.2,
              defaultMaxTokens: 16384,
            },
            lmstudio: { selectedModel: '', customBaseUrl: '' },
            claude: { selectedModel: '', customBaseUrl: '' },
            chatgpt: { selectedModel: '', customBaseUrl: '' },
            grok: { selectedModel: '', customBaseUrl: '' },
            minimax: { selectedModel: '', customBaseUrl: '' },
          },
          auditRepairMaxAttempts: 1,
          parallelSectionConcurrency: 6,
          plannerMaxAttempts: 75,
          requestTimeoutMs: 90_000,
        },
      }),
    ]);
  });

  test('does not include the "Why we ask" copy in the planner UI', async ({ page }) => {
    await page.goto('/planner', { waitUntil: 'networkidle' });
    const text = (await page.locator('body').textContent()) ?? '';
    expect(text.toLowerCase()).not.toContain('why we ask');
    expect(text.toLowerCase()).not.toContain('why we\u2019re asking');
  });

  test('Refine button is present in the planner view', async ({ page }) => {
    await page.goto('/planner', { waitUntil: 'networkidle' });

    const refineButton = page
      .locator('button, p-button')
      .filter({ hasText: /refine/i })
      .first();
    await expect(refineButton).toBeVisible({ timeout: 10_000 });
  });

  test('Refine panel becomes reachable after clicking Refine (requires real LLM key for question generation)', async ({ page }) => {
    test.skip(
      !process.env['OPENROUTER_KEY'],
      'Refine-with-Questions flow requires a live OpenRouter API key; set OPENROUTER_KEY in the environment to enable this test.',
    );

    await page.goto('/planner', { waitUntil: 'networkidle' });

    const refineButton = page
      .locator('button, p-button')
      .filter({ hasText: /refine/i })
      .first();
    await refineButton.click();
    await expect(
      page.locator('app-refinement-chat, app-refine-with-ai').first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
