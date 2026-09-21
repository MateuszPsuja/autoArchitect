import { describe, expect, it } from 'vitest';
import { PlanSchema, type Plan } from './plan.schema';
import { minimalPlanFixture } from '../testing/fixtures';

const stats = {
  promptTokens: 10,
  completionTokens: 20,
  totalTokens: 30,
  model: 'openai/gpt-4o-mini',
  generatedAt: '2026-01-01T00:00:00.000Z',
  startedAt: '2026-01-01T00:00:00.000Z',
  llmCalls: 1,
};

describe('PlanSchema.meta.tokenStats', () => {
  it('parses a plan without tokenStats (backwards-compat)', () => {
    const parsed = PlanSchema.safeParse(minimalPlanFixture);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.meta.tokenStats).toBeUndefined();
    }
  });

  it('parses a plan with tokenStats and round-trips it', () => {
    const withStats: Plan = {
      ...minimalPlanFixture,
      meta: { ...minimalPlanFixture.meta, tokenStats: stats },
    };
    const json = JSON.stringify(withStats);
    const parsed = PlanSchema.safeParse(JSON.parse(json));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.meta.tokenStats).toEqual(stats);
    }
  });

  it('parses a plan with tokenStats: null', () => {
    const withNull: Plan = {
      ...minimalPlanFixture,
      meta: { ...minimalPlanFixture.meta, tokenStats: null },
    };
    const json = JSON.stringify(withNull);
    const parsed = PlanSchema.safeParse(JSON.parse(json));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.meta.tokenStats).toBeNull();
    }
  });

  it('rejects a plan with malformed tokenStats', () => {
    const broken = {
      ...minimalPlanFixture,
      meta: {
        ...minimalPlanFixture.meta,
        tokenStats: { promptTokens: -5, completionTokens: 1, totalTokens: 2, model: 'm', generatedAt: 'now' },
      },
    };
    const parsed = PlanSchema.safeParse(broken);
    expect(parsed.success).toBe(false);
  });
});