import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  hydratePlan,
  hydrateConfig,
  hydrateSavedPlans,
  seedDemoPlan,
  refreshDemoPlanEntries,
  migratePlan,
  PLAN_STORAGE_KEY,
  CONFIG_STORAGE_KEY,
  SAVED_PLANS_STORAGE_KEY,
  DEMO_DISMISSED_KEY,
  DEMO_SAVED_PLAN_ID,
} from './hydration';
import { minimalPlanFixture } from '../testing/fixtures';
import { MICROBLOG_DEMO_PLAN, MICROBLOG_DEMO_TOKEN_STATS } from './demo-plan/microblog.plan';
import { branchName } from './feature-slug';

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

describe('hydratePlan', () => {
  let ls: MemoryStorage;

  beforeEach(() => {
    ls = new MemoryStorage();
    Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true });
  });

  it('returns absent when no blob is present', () => {
    expect(hydratePlan(null).reason).toBe('absent');
  });

  it('returns invalid for unparseable JSON', () => {
    ls.setItem(PLAN_STORAGE_KEY, '{not json');
    expect(hydratePlan(ls.getItem(PLAN_STORAGE_KEY)).reason).toBe('invalid');
  });

  it('accepts the legacy raw-plan format', () => {
    ls.setItem(PLAN_STORAGE_KEY, JSON.stringify(minimalPlanFixture));
    const result = hydratePlan(ls.getItem(PLAN_STORAGE_KEY));
    expect(result.reason).toBe('ok');
    expect(result.plan).toBeTruthy();
  });

  it('accepts the wrapped { plan, tokenStats } format', () => {
    ls.setItem(PLAN_STORAGE_KEY, JSON.stringify({ plan: minimalPlanFixture, tokenStats: null }));
    const result = hydratePlan(ls.getItem(PLAN_STORAGE_KEY));
    expect(result.reason).toBe('ok');
    expect(result.tokenStats).toBeNull();
  });
});

describe('migratePlan (spec-kit v2 → v3)', () => {
  it('backfills branchName from featureNumber + featureSlug when missing', () => {
    const legacy = {
      ...minimalPlanFixture,
      meta: { ...minimalPlanFixture.meta },
    };
    delete (legacy.meta as Partial<typeof legacy.meta>).branchName;
    const migrated = migratePlan(legacy);

    expect(migrated.meta.branchName).toBe(
      branchName({
        meta: {
          featureNumber: migrated.meta.featureNumber,
          featureSlug: migrated.meta.featureSlug,
        },
      }),
    );
  });

  it('preserves an explicit branchName', () => {
    const migrated = migratePlan({
      ...minimalPlanFixture,
      meta: { ...minimalPlanFixture.meta, branchName: '042-explicit-branch' },
    });
    expect(migrated.meta.branchName).toBe('042-explicit-branch');
  });

  it('leaves userStories empty and constitution undefined on a legacy plan', () => {
    const legacy = {
      ...minimalPlanFixture,
      meta: { ...minimalPlanFixture.meta },
    };
    delete (legacy.meta as Partial<typeof legacy.meta>).branchName;
    (legacy as Partial<typeof legacy>).userStories = undefined as unknown as never;
    (legacy as Partial<typeof legacy>).constitution = undefined as unknown as never;

    const migrated = migratePlan(legacy);
    expect(migrated.userStories).toEqual([]);
    expect(migrated.constitution).toBeUndefined();
  });
});

describe('hydrateConfig', () => {
  it('falls back to defaults when no blob is present', () => {
    const result = hydrateConfig(null);
    expect(result.reason).toBe('absent');
    expect(result.config).toBeNull();
  });

  it('accepts the v2 wrapped envelope', () => {
    const raw = JSON.stringify({
      v: 2,
      config: {
        provider: 'openrouter',
        selectedModel: 'openrouter/x',
        defaultTemperature: 0.5,
        defaultMaxTokens: 65536,
        customBaseUrl: 'http://x',
        providerApiKeys: { openrouter: 'sk-x' },
      },
    });
    const result = hydrateConfig(raw);
    expect(result.reason).toBe('ok');
    expect(result.config?.provider).toBe('openrouter');
    expect(result.providerApiKeys.openrouter).toBe('sk-x');
  });

  it('migrates the v1 single-apiKey shape', () => {
    const raw = JSON.stringify({ provider: 'openrouter', apiKey: 'sk-legacy' });
    const result = hydrateConfig(raw);
    expect(result.providerApiKeys.openrouter).toBe('sk-legacy');
  });

  it('honours the legacy lmStudioBaseUrl row', () => {
    const raw = JSON.stringify({
      provider: 'lmstudio',
      lmStudioBaseUrl: 'http://my-old-lmstudio:1234/v1',
    });
    const result = hydrateConfig(raw);
    expect(result.config?.providerConfigs.lmstudio.customBaseUrl).toBe('http://my-old-lmstudio:1234/v1');
  });

  it('migrates a v2 wrapped envelope into per-provider slots (legacy fields → legacy provider slot)', () => {
    const raw = JSON.stringify({
      v: 2,
      config: {
        providerApiKeys: { openrouter: 'sk-x' },
        provider: 'openrouter',
        selectedModel: 'openrouter/x',
        defaultTemperature: 0.5,
        defaultMaxTokens: 65536,
        customBaseUrl: 'http://legacy-host/v1',
      },
    });
    const result = hydrateConfig(raw);
    expect(result.config?.provider).toBe('openrouter');
    expect(result.config?.providerConfigs.openrouter.selectedModel).toBe('openrouter/x');
    expect(result.config?.providerConfigs.openrouter.customBaseUrl).toBe('http://legacy-host/v1');
    expect(result.config?.providerConfigs.openrouter.defaultTemperature).toBe(0.5);

    expect(result.config?.providerConfigs.openrouter.defaultMaxTokens).toBeGreaterThanOrEqual(65_536);

    expect(result.config?.providerConfigs.claude.selectedModel).toBe('');
    expect(result.config?.providerConfigs.minimax.customBaseUrl).toBe('https://api.minimax.io/v1');
    expect(result.providerApiKeys.openrouter).toBe('sk-x');
  });

  it('round-trips a v3 wrapped envelope with explicit providerConfigs', () => {
    const raw = JSON.stringify({
      v: 3,
      config: {
        providerApiKeys: {},
        provider: 'claude',
        providerConfigs: {
          openrouter: {
            selectedModel: 'openai/gpt-4o-mini',
            customBaseUrl: 'https://openrouter.ai/api/v1',
            defaultTemperature: 0.3,
            defaultMaxTokens: 4096,
          },
          lmstudio: {
            selectedModel: '',
            customBaseUrl: 'http://localhost:1234/v1',
            defaultTemperature: 0.2,
            defaultMaxTokens: 65536,
          },
          claude: {
            selectedModel: 'claude-3-5-haiku-latest',
            customBaseUrl: 'https://api.anthropic.com',
            defaultTemperature: 0.7,
            defaultMaxTokens: 8192,
          },
          chatgpt: {
            selectedModel: '',
            customBaseUrl: 'https://api.openai.com/v1',
            defaultTemperature: 0.2,
            defaultMaxTokens: 65536,
          },
          grok: {
            selectedModel: '',
            customBaseUrl: 'https://api.x.ai/v1',
            defaultTemperature: 0.2,
            defaultMaxTokens: 65536,
          },
          minimax: {
            selectedModel: '',
            customBaseUrl: 'https://api.minimax.io/v1',
            defaultTemperature: 0.2,
            defaultMaxTokens: 65536,
          },
        },
      },
    });
    const result = hydrateConfig(raw);
    expect(result.config?.providerConfigs.openrouter.selectedModel).toBe('openai/gpt-4o-mini');
    expect(result.config?.providerConfigs.claude.selectedModel).toBe('claude-3-5-haiku-latest');
  });

  it('replaces a malformed slot with defaults', () => {
    const raw = JSON.stringify({
      v: 3,
      config: {
        providerApiKeys: {},
        provider: 'openrouter',
        providerConfigs: {
          openrouter: 'not-an-object' as unknown,
        },
      },
    });
    const result = hydrateConfig(raw);

    expect(result.config?.providerConfigs.openrouter.selectedModel).toBe('');
    expect(result.config?.providerConfigs.openrouter.customBaseUrl).toBe('https://openrouter.ai/api/v1');
  });

  it('drops unknown provider keys', () => {
    const raw = JSON.stringify({
      providerApiKeys: { openrouter: 'sk-x', bogus: 'sk-bogus' },
    });
    const result = hydrateConfig(raw);
    expect(result.providerApiKeys).not.toHaveProperty('bogus');
  });
});

describe('hydrateSavedPlans', () => {
  it('returns absent for null', () => {
    expect(hydrateSavedPlans(null).reason).toBe('absent');
  });

  it('returns invalid for non-array JSON', () => {
    expect(hydrateSavedPlans('{"not":"array"}').reason).toBe('invalid');
  });

  it('returns ok for an array', () => {
    expect(hydrateSavedPlans('[]').reason).toBe('ok');
  });
});

describe('seedDemoPlan', () => {
  it('skips when dismissed', () => {
    expect(seedDemoPlan([], true)).toEqual([]);
  });

  it('skips when demo is already saved', () => {
    const existing = [
      {
        id: DEMO_SAVED_PLAN_ID,
        title: 'x',
        savedAt: 'y',
        model: 'm',
        tokenStats: null,
        plan: minimalPlanFixture,
      },
    ];
    expect(seedDemoPlan(existing, false)).toBe(existing);
  });

  it('seeds the demo when neither condition holds', () => {
    const seeded = seedDemoPlan([], false);
    expect(seeded).toHaveLength(1);
    expect(seeded[0].id).toBe(DEMO_SAVED_PLAN_ID);
  });
});

describe('refreshDemoPlanEntries', () => {
  it('returns the input unchanged when the demo entry is current', () => {
    const current = [
      {
        id: DEMO_SAVED_PLAN_ID,
        title: MICROBLOG_DEMO_PLAN.meta.title,
        savedAt: MICROBLOG_DEMO_PLAN.meta.generatedAt,
        model: MICROBLOG_DEMO_PLAN.meta.model,
        tokenStats: MICROBLOG_DEMO_TOKEN_STATS,
        plan: MICROBLOG_DEMO_PLAN,
      },
    ];
    expect(refreshDemoPlanEntries(current)).toBe(current);
  });

  it('returns the input unchanged when there is no demo entry', () => {
    expect(refreshDemoPlanEntries([])).toEqual([]);
  });
});
