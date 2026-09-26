import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PLAN_STORAGE_KEY = 'arc-planner:plan';
export const CONFIG_STORAGE_KEY = 'arc-planner:config';

const REPO_ROOT = join(__dirname, '..', '..');

export async function loadRawDemoPlanObject(): Promise<Record<string, unknown>> {
  const jsonPath = join(
    REPO_ROOT,
    'src',
    'assets',
    'data',
    'microblog-demo.plan.json',
  );
  const source = readFileSync(jsonPath, 'utf8');
  return JSON.parse(source) as Record<string, unknown>;
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
