import { Plan } from './plan.schema';
import { PlanSchemaService } from './plan-schema.service';
import { branchName, defaultSlugFromTitle } from './feature-slug';
import { STORAGE_KEYS } from './persistence.constants';
import {
  LlmProvider,
  PlannerConfigState,
  ProviderConfigsMap,
  ProviderSlotConfig,
  defaultProviderConfigs,
} from './project.store';
import { SavedPlanEntry } from './saved-plan-entry.model';
import { TokenUsage } from './token-usage.model';
import {
  MICROBLOG_DEMO_PLAN,
  MICROBLOG_DEMO_TOKEN_STATS,
  isDemoPlan,
} from './demo-plan/microblog.plan';

export const PLAN_STORAGE_KEY = STORAGE_KEYS.plan;
export const CONFIG_STORAGE_KEY = STORAGE_KEYS.config;
export const SAVED_PLANS_STORAGE_KEY = STORAGE_KEYS.savedPlans;
export const AGENTS_STORAGE_KEY = STORAGE_KEYS.agents;
export const DEMO_DISMISSED_KEY = STORAGE_KEYS.demoDismissed;
export const DEMO_SAVED_PLAN_ID = STORAGE_KEYS.demoSavedPlanId;

export interface PlanHydrationResult {
  plan: Plan | null;
  tokenStats: TokenUsage | null;
  replaced: boolean;
  reason: 'ok' | 'invalid' | 'absent';
}

const LEGACY_LM_STUDIO_KEYS = new Set(['lmStudioBaseUrl']);

export function hydratePlan(raw: string | null): PlanHydrationResult {
  if (!raw) return { plan: null, tokenStats: null, replaced: false, reason: 'absent' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { plan: null, tokenStats: null, replaced: false, reason: 'invalid' };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { plan: null, tokenStats: null, replaced: false, reason: 'invalid' };
  }

  if (isPlanObject((parsed as { plan?: unknown }).plan)) {
    const migrated = migratePlan((parsed as { plan: Plan }).plan);
    const planToLoad = refreshStaleDemoPlan(migrated);
    return {
      plan: planToLoad,
      tokenStats: resolveStats((parsed as { tokenStats?: unknown }).tokenStats, planToLoad),
      replaced: planToLoad !== migrated || migrated !== (parsed as { plan: Plan }).plan,
      reason: 'ok',
    };
  }

  if (isPlanObject(parsed)) {
    const migrated = migratePlan(parsed);
    const planToLoad = refreshStaleDemoPlan(migrated);
    return {
      plan: planToLoad,
      tokenStats: resolveStats(null, planToLoad),
      replaced: planToLoad !== migrated || migrated !== parsed,
      reason: 'ok',
    };
  }
  return { plan: null, tokenStats: null, replaced: false, reason: 'invalid' };
}

export function migratePlan(plan: Plan): Plan {
  const meta = plan.meta;
  if (!meta) return plan;
  const next: Plan = {
    ...plan,
    refinementChats: Array.isArray(plan.refinementChats) ? plan.refinementChats : [],
    userStories: Array.isArray(plan.userStories) ? plan.userStories : [],
    functionalRequirements: Array.isArray(plan.functionalRequirements)
      ? plan.functionalRequirements
      : [],
    successCriteria: Array.isArray(plan.successCriteria) ? plan.successCriteria : [],
  };
  if (typeof meta.featureNumber !== 'number' || typeof meta.featureSlug !== 'string' || meta.featureSlug.length === 0) {
    const fallbackSlug = defaultSlugFromTitle(meta.title ?? 'feature') || 'feature';
    return {
      ...next,
      meta: {
        ...meta,
        featureNumber: 1,
        featureSlug: fallbackSlug,
        branchName: branchName({ meta: { featureNumber: 1, featureSlug: fallbackSlug } }),
      },
    };
  }
  if (!meta.branchName || meta.branchName.length === 0) {
    return {
      ...next,
      meta: {
        ...meta,
        branchName: branchName({ meta: { featureNumber: meta.featureNumber, featureSlug: meta.featureSlug } }),
      },
    };
  }
  return next;
}

export interface ConfigHydrationResult {
  providerApiKeys: Record<LlmProvider, string>;
  config: PlannerConfigState | null;
  reason: 'ok' | 'invalid' | 'absent';
}

const DEFAULT_PROVIDER_CONFIGS: ProviderConfigsMap = defaultProviderConfigs();

const DEFAULT_CONFIG: PlannerConfigState = {
  provider: 'openrouter',
  providerConfigs: DEFAULT_PROVIDER_CONFIGS,
  auditRepairMaxAttempts: 1,
  parallelSectionConcurrency: 6,
  plannerMaxAttempts: 75,
  requestTimeoutMs: 90_000,
};

export function hydrateConfig(raw: string | null): ConfigHydrationResult {
  if (!raw) return { providerApiKeys: emptyKeys(), config: null, reason: 'absent' };
  let parsedWrapper: unknown;
  try {
    parsedWrapper = JSON.parse(raw);
  } catch {
    return { providerApiKeys: emptyKeys(), config: null, reason: 'invalid' };
  }
  const parsed = (parsedWrapper as { config?: unknown })?.config ?? parsedWrapper;
  if (!parsed || typeof parsed !== 'object') {
    return { providerApiKeys: emptyKeys(), config: null, reason: 'invalid' };
  }
  const provider = ((parsed as { provider?: unknown }).provider ?? 'openrouter') as LlmProvider;

  const persistedKeys: Record<string, string> =
    (parsed as { providerApiKeys?: Record<string, unknown> }).providerApiKeys &&
    typeof (parsed as { providerApiKeys?: Record<string, unknown> }).providerApiKeys === 'object'
      ? { ...(parsed as { providerApiKeys: Record<string, string> }).providerApiKeys }
      : {};

  const legacyKey = (parsed as { apiKey?: string }).apiKey;
  if (typeof legacyKey === 'string' && legacyKey && !persistedKeys[provider]) {
    persistedKeys[provider] = legacyKey;
  }
  const sanitized = sanitiseKeys(persistedKeys);

  const rawProviderConfigs = (parsed as { providerConfigs?: unknown }).providerConfigs;
  const providerConfigs: ProviderConfigsMap = isPlainObject(rawProviderConfigs)
    ? sanitiseProviderConfigs(rawProviderConfigs as Record<string, unknown>)
    : defaultProviderConfigs(
        provider in DEFAULT_PROVIDER_CONFIGS
          ? {
              [provider]: legacySlotFromFlat(parsed as Record<string, unknown>),
            }
          : {},
      );

  const config: PlannerConfigState = {
    provider,
    providerConfigs,
    auditRepairMaxAttempts:
      (parsed as { auditRepairMaxAttempts?: number }).auditRepairMaxAttempts ?? 1,
    parallelSectionConcurrency:
      (parsed as { parallelSectionConcurrency?: number }).parallelSectionConcurrency ?? 6,
    plannerMaxAttempts: (parsed as { plannerMaxAttempts?: number }).plannerMaxAttempts ?? 75,
    requestTimeoutMs: (parsed as { requestTimeoutMs?: number }).requestTimeoutMs ?? 90_000,
  };
  return { providerApiKeys: sanitized, config, reason: 'ok' };
}

function legacySlotFromFlat(parsed: Record<string, unknown>): ProviderSlotConfig {
  const customBaseUrl =
    (typeof parsed['customBaseUrl'] === 'string' && parsed['customBaseUrl']) ||
    (typeof parsed['lmStudioBaseUrl'] === 'string' && parsed['lmStudioBaseUrl']) ||
    '';
  return {
    selectedModel: typeof parsed['selectedModel'] === 'string' ? parsed['selectedModel'] : '',
    customBaseUrl,
    defaultTemperature:
      typeof parsed['defaultTemperature'] === 'number' ? parsed['defaultTemperature'] : 0.2,





    defaultMaxTokens: Math.max(
      typeof parsed['defaultMaxTokens'] === 'number' ? parsed['defaultMaxTokens'] : 16_384,
      16_384,
    ),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sanitiseProviderConfigs(raw: Record<string, unknown>): ProviderConfigsMap {
  const out = defaultProviderConfigs();
  for (const [id, slot] of Object.entries(raw)) {
    if (!(id in out) || !isPlainObject(slot)) continue;
    const provider = id as LlmProvider;
    const defaults = out[provider];
    out[provider] = {
      selectedModel:
        typeof slot['selectedModel'] === 'string' ? slot['selectedModel'] : defaults.selectedModel,
      customBaseUrl:
        typeof slot['customBaseUrl'] === 'string' ? slot['customBaseUrl'] : defaults.customBaseUrl,
      defaultTemperature:
        typeof slot['defaultTemperature'] === 'number'
          ? clampTemperature(slot['defaultTemperature'])
          : defaults.defaultTemperature,
      defaultMaxTokens:
        typeof slot['defaultMaxTokens'] === 'number'
          ? clampMaxTokens(slot['defaultMaxTokens'])
          : defaults.defaultMaxTokens,
    };
  }
  return out;
}

function clampTemperature(value: number): number {
  if (!Number.isFinite(value)) return 0.2;
  return Math.min(2, Math.max(0, value));
}

function clampMaxTokens(value: number): number {
  if (!Number.isFinite(value)) return 16_384;
  return Math.min(65_536, Math.max(4_096, Math.round(value)));
}

export interface SavedPlansHydrationResult {
  savedPlans: SavedPlanEntry[];
  reason: 'ok' | 'invalid' | 'absent';
}

export function hydrateSavedPlans(raw: string | null): SavedPlansHydrationResult {
  if (!raw) return { savedPlans: [], reason: 'absent' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { savedPlans: [], reason: 'invalid' };
  }
  if (!Array.isArray(parsed)) return { savedPlans: [], reason: 'invalid' };
  const entries = parsed as SavedPlanEntry[];
  const migrated = entries.map((entry) => ({
    ...entry,
    plan: entry && typeof entry === 'object' && entry.plan ? migratePlan(entry.plan) : entry.plan,
  }));
  return { savedPlans: migrated, reason: 'ok' };
}

export function seedDemoPlan(savedPlans: SavedPlanEntry[], dismissed: boolean): SavedPlanEntry[] {
  if (dismissed) return savedPlans;
  if (savedPlans.some((s) => s.id === DEMO_SAVED_PLAN_ID)) return savedPlans;
  return [
    {
      id: DEMO_SAVED_PLAN_ID,
      title: MICROBLOG_DEMO_PLAN.meta.title,
      savedAt: MICROBLOG_DEMO_PLAN.meta.generatedAt,
      model: MICROBLOG_DEMO_PLAN.meta.model,
      tokenStats: MICROBLOG_DEMO_TOKEN_STATS,
      plan: MICROBLOG_DEMO_PLAN,
    },
    ...savedPlans,
  ];
}

export function refreshDemoPlanEntries(savedPlans: SavedPlanEntry[]): SavedPlanEntry[] {
  let mutated = false;
  const next = savedPlans.map((entry) => {
    if (entry.id !== DEMO_SAVED_PLAN_ID) return entry;
    if (isDemoPlan(entry.plan) && entry.tokenStats) return entry;
    mutated = true;
    return {
      ...entry,
      plan: MICROBLOG_DEMO_PLAN,
      title: MICROBLOG_DEMO_PLAN.meta.title,
      savedAt: MICROBLOG_DEMO_PLAN.meta.generatedAt,
      tokenStats: entry.tokenStats ?? MICROBLOG_DEMO_TOKEN_STATS,
    };
  });
  return mutated ? next : savedPlans;
}

export function refreshStaleDemoPlan(plan: Plan): Plan {
  if (plan.meta?.title !== MICROBLOG_DEMO_PLAN.meta.title) return plan;
  return MICROBLOG_DEMO_PLAN;
}

function resolveStats(raw: unknown, plan: Plan): TokenUsage | null {
  if (isTokenUsage(raw)) return raw;
  return isDemoPlan(plan) ? MICROBLOG_DEMO_TOKEN_STATS : null;
}

function isPlanObject(value: unknown): value is Plan {
  return PlanSchemaService.isPlan(value);
}

function isTokenUsage(value: unknown): value is TokenUsage {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['model'] === 'string' &&
    typeof v['generatedAt'] === 'string' &&
    typeof v['promptTokens'] === 'number' &&
    typeof v['completionTokens'] === 'number' &&
    typeof v['totalTokens'] === 'number'
  );
}

function emptyKeys(): Record<LlmProvider, string> {
  return {
    openrouter: '',
    lmstudio: '',
    claude: '',
    chatgpt: '',
    grok: '',
    minimax: '',
  };
}

function sanitiseKeys(input: Record<string, unknown>): Record<LlmProvider, string> {
  const out = emptyKeys();
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string' && key in out) {
      out[key as LlmProvider] = value;
    }
  }
  return out;
}
