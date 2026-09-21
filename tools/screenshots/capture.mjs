#!/usr/bin/env node
/**
 * Screenshot capture for the Auto Architect README.
 *
 * Boots nothing on its own — it expects `npm start` (Angular dev server on
 * http://localhost:4200) to already be running in another terminal, OR for
 * `BASE_URL` to point at any reachable deployment of the SPA.
 *
 * One-time setup (only if Chromium is not yet installed for Playwright):
 *
 *   npx playwright install chromium
 *
 * Usage:
 *
 *   node tools/screenshots/capture.mjs
 *   BASE_URL=http://localhost:4200 node tools/screenshots/capture.mjs
 *
 * Writes:
 *   docs/screenshots/planner.png
 *   docs/screenshots/editor.png
 *   docs/screenshots/diagram.png
 *
 * Exit code 0 on success, non-zero on any failure (timeouts, missing selectors,
 * unreachable server).
 */

import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4200';
const OUT_DIR = join(REPO_ROOT, 'docs', 'screenshots');
const VIEWPORT = { width: 1280, height: 800 };
const DEVICE_SCALE = 2;
const SELECTOR_TIMEOUT_MS = 15_000;

const PLAN_STORAGE_KEY = 'arc-planner:plan';
const CONFIG_STORAGE_KEY = 'arc-planner:config';

async function loadRawDemoPlanObject() {
  const tsPath = join(
    REPO_ROOT,
    'src',
    'app',
    'core',
    'demo-plan',
    'microblog.plan.ts',
  );
  const source = readFileSync(tsPath, 'utf8');

  const startMarker = 'const GENERATED_AT';
  const startIdx = source.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error('Could not locate `const c4Context =` in demo plan source.');
  }

  const endMarker = '};';
  const endSearchFrom = source.indexOf('const rawDemoPlan = ', startIdx);
  if (endSearchFrom === -1) {
    throw new Error('Could not locate `const rawDemoPlan =` in demo plan source.');
  }

  let depth = 0;
  let endIdx = -1;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let prev = '';
  for (let i = endSearchFrom; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1] ?? '';

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (prev === '*' && ch === '/') inBlockComment = false;
      prev = ch;
      continue;
    }
    if (inSingle) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === '`') inTemplate = false;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      prev = ch;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        endIdx = i + 1;
        break;
      }
    }
  }
  if (endIdx === -1) {
    throw new Error('Could not find matching closing brace for rawDemoPlan object.');
  }

  const scriptBody = source.slice(startIdx, endIdx);
  const strippedImports = scriptBody.replace(
    /^import[^;]*;?\s*$/gm,
    '',
  );
  const transpiled = transformSync(strippedImports, {
    loader: 'ts',
    format: 'esm',
    target: 'es2022',
    treeShaking: false,
  }).code;
  const exportInjection = '\nexport { rawDemoPlan };\n';
  const withExports = transpiled + exportInjection;

  const dataUri =
    'data:text/javascript;base64,' +
    Buffer.from(withExports, 'utf8').toString('base64');
  const mod = await import(dataUri);
  const result = mod.rawDemoPlan;
  if (!result || typeof result !== 'object') {
    throw new Error('Loaded rawDemoPlan produced a non-object value.');
  }
  return result;
}

async function waitForServer(url) {
  const deadline = Date.now() + 30_000;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status < 500) return;
      lastErr = new Error(`Server responded ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `Dev server at ${url} did not become reachable in time: ${String(lastErr)}`,
  );
}

async function capturePlanner(page) {
  await page.goto(`${BASE_URL}/planner`, { waitUntil: 'networkidle' });

  const banner = page.locator('p-message').filter({ hasText: 'Provider not fully configured' });
  await banner.waitFor({ state: 'detached', timeout: SELECTOR_TIMEOUT_MS }).catch(() => {
    throw new Error(
      'Planner config-warning banner is still visible — config injection did not take effect.',
    );
  });

  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);

  const out = join(OUT_DIR, 'planner.png');
  await page.screenshot({ path: out, fullPage: false });
  console.log(`[screenshots] wrote ${out}`);
}

async function captureEditor(page) {
  await page.goto(`${BASE_URL}/editor`, { waitUntil: 'networkidle' });

  await page.evaluate(() => document.fonts.ready);

  const docsTab = page.locator('p-tab', { hasText: 'Docs' });
  await docsTab.first().click();
  await docsTab.first().waitFor({ state: 'visible' });

  await page.waitForSelector('app-plan-editor .editor-layout', {
    state: 'visible',
    timeout: SELECTOR_TIMEOUT_MS,
  });
  await page.waitForSelector('app-plan-editor app-markdown-preview .md', {
    state: 'visible',
    timeout: SELECTOR_TIMEOUT_MS,
  });

  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);

  const out = join(OUT_DIR, 'editor.png');
  await page.screenshot({ path: out, fullPage: true });
  console.log(`[screenshots] wrote ${out}`);
}

async function captureDiagram(context) {
  const diagramViewport = { width: VIEWPORT.width, height: VIEWPORT.height };
  const page = await context.newPage();
  await page.setViewportSize(diagramViewport);
  try {
    await page.goto(`${BASE_URL}/editor`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);

    const architectureTab = page.locator('p-tab', { hasText: 'Architecture' });
    await architectureTab.first().click();
    await architectureTab.first().waitFor({ state: 'visible' });

    const svg = page.locator('svg[id^="mermaid-"], app-mermaid-preview svg').first();
    await svg.waitFor({ state: 'visible', timeout: SELECTOR_TIMEOUT_MS });

    await page.waitForTimeout(800);

    const fitButton = page.locator('button[aria-label="Fit to frame"]');
    await fitButton.first().click();
    await page.waitForFunction(
      () => {
        const svgEl = document.querySelector('svg[id^="mermaid-"], app-mermaid-preview svg');
        if (!svgEl) return false;
        const rect = svgEl.getBoundingClientRect();
        return rect.height > 0 && rect.width > 0;
      },
      null,
      { timeout: SELECTOR_TIMEOUT_MS },
    );
    await page.waitForTimeout(800);

    const out = join(OUT_DIR, 'diagram.png');
    await page.screenshot({ path: out, fullPage: true });
    console.log(`[screenshots] wrote ${out}`);
  } finally {
    await page.close();
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  console.log(`[screenshots] BASE_URL = ${BASE_URL}`);
  console.log(`[screenshots] OUT_DIR  = ${OUT_DIR}`);
  await waitForServer(BASE_URL);

  const plan = await loadRawDemoPlanObject();
  const config = {
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
        lmstudio: {
          selectedModel: '',
          customBaseUrl: 'http://localhost:1234/v1',
          defaultTemperature: 0.2,
          defaultMaxTokens: 16384,
        },
        claude: {
          selectedModel: '',
          customBaseUrl: 'https://api.anthropic.com',
          defaultTemperature: 0.2,
          defaultMaxTokens: 16384,
        },
        chatgpt: {
          selectedModel: '',
          customBaseUrl: 'https://api.openai.com/v1',
          defaultTemperature: 0.2,
          defaultMaxTokens: 16384,
        },
        grok: {
          selectedModel: '',
          customBaseUrl: 'https://api.x.ai/v1',
          defaultTemperature: 0.2,
          defaultMaxTokens: 16384,
        },
        minimax: {
          selectedModel: '',
          customBaseUrl: 'https://api.minimax.io/v1',
          defaultTemperature: 0.2,
          defaultMaxTokens: 16384,
        },
      },
      auditRepairMaxAttempts: 1,
      parallelSectionConcurrency: 6,
      plannerMaxAttempts: 75,
      requestTimeoutMs: 90_000,
    },
  };

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: DEVICE_SCALE,
    });
    const page = await context.newPage();

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.evaluate(
      ([configKey, configJson]) => {
        window.localStorage.setItem(configKey, configJson);
      },
      [CONFIG_STORAGE_KEY, JSON.stringify(config)],
    );

    await capturePlanner(page);

    await page.evaluate(
      ([planKey, planJson]) => {
        window.localStorage.setItem(planKey, planJson);
      },
      [PLAN_STORAGE_KEY, JSON.stringify({ plan, tokenStats: null })],
    );

    await captureEditor(page);
    await captureDiagram(context);
  } finally {
    await browser.close();
  }

  console.log('[screenshots] done');
}

main().catch((err) => {
  console.error('[screenshots] FAILED:', err);
  process.exit(1);
});