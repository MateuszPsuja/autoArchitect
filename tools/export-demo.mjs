#!/usr/bin/env node
/**
 * Headless exporter for the demo plan artefacts.
 *
 * Regenerates the three demo artefacts under `export/` directly from the
 * `MICROBLOG_DEMO_PLAN` literal in `src/app/core/demo-plan/microblog.plan.ts`:
 *
 *   - microblog-demo-plan.json  — `JSON.stringify(rawDemoPlan, null, 2)`
 *   - microblog-demo-docs.zip   — the spec-kit markdown bundle produced by
 *                                  `MarkdownRendererService.toMarkdownFiles`
 *                                  via the running Angular dev server
 *   - microblog-demo-spec.pdf   — designed PDF produced by the in-app PDF
 *                                  export; skipped with a warning if the LLM
 *                                  is not configured
 *
 * Bootstraps nothing on its own for the JSON — that one is pure data.
 * For the ZIP and PDF it drives the dev server with Playwright (same trick
 * as `tools/screenshots/capture.mjs`) so we don't have to bootstrap the
 * Angular DI graph in Node.
 *
 * Usage:
 *
 *   node tools/export-demo.mjs
 *   BASE_URL=http://localhost:4200 node tools/export-demo.mjs
 *
 * Exit code 0 when at least plan.json and docs.zip are written; non-zero on
 * any hard failure.
 */

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { transformSync } from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4200';
const OUT_DIR = join(REPO_ROOT, 'export');
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
    throw new Error('Could not locate `const GENERATED_AT` in demo plan source.');
  }

  const startOfRaw = source.indexOf('const rawDemoPlan = ', startIdx);
  if (startOfRaw === -1) {
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
  for (let i = startOfRaw; i < source.length; i++) {
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

async function writePlanJson(plan) {
  const out = join(OUT_DIR, 'microblog-demo-plan.json');
  writeFileSync(out, JSON.stringify(plan, null, 2));
  console.log(`[export:demo] wrote ${out}`);
}

async function captureZip(context, plan) {
  const page = await context.newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.evaluate(
      ([planKey, planJson]) => {
        window.localStorage.setItem(planKey, planJson);
      },
      [PLAN_STORAGE_KEY, JSON.stringify({ plan, tokenStats: null })],
    );

    await page.goto(`${BASE_URL}/export`, { waitUntil: 'networkidle' });

    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
    await page
      .locator('app-export-zip button, app-export-zip p-button button')
      .first()
      .click();
    const download = await downloadPromise;
    const out = join(OUT_DIR, 'microblog-demo-docs.zip');
    await download.saveAs(out);
    console.log(`[export:demo] wrote ${out}`);
  } finally {
    await page.close();
  }
}

async function capturePdf(context, plan) {
  const page = await context.newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.evaluate(
      ([planKey, planJson]) => {
        window.localStorage.setItem(planKey, planJson);
      },
      [PLAN_STORAGE_KEY, JSON.stringify({ plan, tokenStats: null })],
    );

    await page.goto(`${BASE_URL}/export`, { waitUntil: 'networkidle' });

    const disabledReason = page.locator(
      '[data-testid="export-pdf-disabled-reason"]',
    );
    if ((await disabledReason.count()) > 0) {
      const reason = (await disabledReason.first().textContent()) ?? '';
      console.warn(
        `[export:demo] skipping PDF — button disabled: ${reason.trim()}`,
      );
      return false;
    }

    const downloadPromise = page.waitForEvent('download', { timeout: 180_000 });
    await page
      .locator('app-export-pdf button, app-export-pdf p-button button')
      .first()
      .click();
    const download = await downloadPromise;
    const out = join(OUT_DIR, 'microblog-demo-spec.pdf');
    await download.saveAs(out);
    console.log(`[export:demo] wrote ${out}`);
    return true;
  } finally {
    await page.close();
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const plan = await loadRawDemoPlanObject();
  await writePlanJson(plan);

  console.log(`[export:demo] BASE_URL = ${BASE_URL}`);
  console.log(`[export:demo] waiting for dev server to generate docs.zip + spec.pdf...`);
  await waitForServer(BASE_URL);

  const browser = await chromium.launch();
  let zipOk = false;
  let pdfOk = false;
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    try {
      await captureZip(context, plan);
      zipOk = true;
    } catch (err) {
      console.warn(`[export:demo] ZIP capture failed: ${String(err)}`);
    }
    try {
      pdfOk = await capturePdf(context, plan);
    } catch (err) {
      console.warn(`[export:demo] PDF capture failed: ${String(err)}`);
    }
  } finally {
    await browser.close();
  }

  if (!zipOk) {
    throw new Error('docs.zip was not written — see warnings above.');
  }

  console.log(
    `[export:demo] done (zip=${zipOk ? 'ok' : 'MISSING'}, pdf=${pdfOk ? 'ok' : 'skipped'})`,
  );
}

main().catch((err) => {
  console.error('[export:demo] FAILED:', err);
  process.exit(1);
});