/** Debounce window (ms) for localStorage writes shared by project + agents stores. */
export const PERSIST_DEBOUNCE_MS = 250;

/** Autosave key for the planner input draft text. */
export const PLANNER_INPUT_STORAGE_KEY = 'arc-planner:planner-input';

/**
 * Canonical localStorage key map. Single source of truth — project + agents
 * stores import from here. `demoSavedPlanId` is a value-constant, not a key.
 */
export const STORAGE_KEYS = {
  plan: 'arc-planner:plan',
  config: 'arc-planner:config',
  savedPlans: 'arc-planner:saved-plans',
  agents: 'arc-planner:agents',
  demoDismissed: 'arc-planner:demo:dismissed',
  demoSavedPlanId: 'demo:microblog',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];