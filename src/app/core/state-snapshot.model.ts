import { Plan } from './plan.schema';
import type { PlannerConfigState, LlmProvider } from './project.store';
import { SavedPlanEntry } from './saved-plan-entry.model';
import { TokenUsage } from './token-usage.model';

export interface StateSnapshot {
  version: 1;
  exportedAt: string;
  config: PlannerConfigState;
  providerApiKeys: Record<LlmProvider, string>;
  plan: Plan | null;
  tokenStats: TokenUsage | null;
  markdownOverrides: Record<string, string>;
  savedPlans: SavedPlanEntry[];
}

export const STATE_SNAPSHOT_ROW_IDS = [
  'meta:version',
  'meta:exportedAt',
  'config:provider',
  'config:selectedModel',
  'config:defaultTemperature',
  'config:defaultMaxTokens',
  'config:customBaseUrl',
  'config:lmStudioBaseUrl', 

  'config:providerConfigs',
  'config:auditRepairMaxAttempts',
  'config:parallelSectionConcurrency',
  'config:plannerMaxAttempts',
  'config:requestTimeoutMs',
  'config:providerApiKeys',
  'plan:plan',
  'plan:tokenStats',
  'plan:markdownOverrides',
  'plans:savedPlans',
] as const;

export type StateSnapshotRowId = (typeof STATE_SNAPSHOT_ROW_IDS)[number];