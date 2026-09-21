import { STORAGE_KEYS } from './persistence.constants';

describe('STORAGE_KEYS — single source of truth', () => {
  it('has unique values', () => {
    const values = Object.values(STORAGE_KEYS);
    expect(new Set(values).size).toBe(values.length);
  });

  it('arc-planner-prefixed entries all start with arc-planner:', () => {
    for (const [name, value] of Object.entries(STORAGE_KEYS)) {
      if (name === 'demoSavedPlanId') continue;
      expect(value.startsWith('arc-planner:')).toBe(true);
    }
  });

  it('keeps the demo plan id in the documented "demo:" namespace', () => {
    expect(STORAGE_KEYS.demoSavedPlanId).toBe('demo:microblog');
  });

  it('hydration.ts re-exports match the canonical values', async () => {
    const hydration = await import('./hydration');
    expect(hydration.PLAN_STORAGE_KEY).toBe(STORAGE_KEYS.plan);
    expect(hydration.CONFIG_STORAGE_KEY).toBe(STORAGE_KEYS.config);
    expect(hydration.SAVED_PLANS_STORAGE_KEY).toBe(STORAGE_KEYS.savedPlans);
    expect(hydration.AGENTS_STORAGE_KEY).toBe(STORAGE_KEYS.agents);
    expect(hydration.DEMO_DISMISSED_KEY).toBe(STORAGE_KEYS.demoDismissed);
    expect(hydration.DEMO_SAVED_PLAN_ID).toBe(STORAGE_KEYS.demoSavedPlanId);
  });
});