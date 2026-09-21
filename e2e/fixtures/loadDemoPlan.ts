import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { transformSync } from 'esbuild';

export const PLAN_STORAGE_KEY = 'arc-planner:plan';
export const CONFIG_STORAGE_KEY = 'arc-planner:config';

const REPO_ROOT = join(__dirname, '..', '..');

export async function loadRawDemoPlanObject(): Promise<Record<string, unknown>> {
  const tsPath = join(
    REPO_ROOT,
    'src',
    'app',
    'core',
    'demo-plan',
    'news-portal.plan.ts',
  );
  const source = readFileSync(tsPath, 'utf8');

  const startMarker = 'const GENERATED_AT';
  const startIdx = source.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error(
      'Could not locate `const GENERATED_AT` marker in demo plan source.',
    );
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
  const strippedImports = scriptBody.replace(/^import[^;]*;?\s*$/gm, '');
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
  return result as Record<string, unknown>;
}

export interface SeedOptions {
  plan?: Record<string, unknown>;
  openrouterApiKey?: string;
  configOverride?: Record<string, unknown>;
}

export const DEMO_CONFIG = {
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

export async function seedDemoPlanToLocalStorage(
  page: import('@playwright/test').Page,
  options: SeedOptions = {},
): Promise<void> {
  const plan = options.plan ?? (await loadRawDemoPlanObject());
  const config = options.configOverride ?? DEMO_CONFIG;

  if (options.openrouterApiKey) {
    const cfg = config as { config?: { providerApiKeys?: Record<string, string> } };
    if (cfg.config?.providerApiKeys) {
      cfg.config.providerApiKeys['openrouter'] = options.openrouterApiKey;
    }
  }

  await page.evaluate(
    ([planKey, planJson, configKey, configJson]) => {
      window.localStorage.setItem(planKey, planJson);
      window.localStorage.setItem(configKey, configJson);
    },
    [
      PLAN_STORAGE_KEY,
      JSON.stringify({ plan, tokenStats: null }),
      CONFIG_STORAGE_KEY,
      JSON.stringify(config),
    ],
  );
}
