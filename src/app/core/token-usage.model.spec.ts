import { describe, expect, it } from 'vitest';
import { TokenUsageSchema, type TokenUsage } from './token-usage.model';

const validUsage: TokenUsage = {
  promptTokens: 100,
  completionTokens: 200,
  totalTokens: 300,
  model: 'openai/gpt-4o-mini',
  generatedAt: '2026-01-01T00:00:00.000Z',
  startedAt: '2026-01-01T00:00:00.000Z',
  llmCalls: 3,
  errors: 0,
  retries: 1,
  repairs: 0,
};

describe('TokenUsageSchema', () => {
  it('accepts a canonical TokenUsage object', () => {
    const parsed = TokenUsageSchema.safeParse(validUsage);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual(validUsage);
    }
  });

  it('accepts minimal TokenUsage with only required fields', () => {
    const minimal = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      model: 'm',
      generatedAt: 'now',
    };
    const parsed = TokenUsageSchema.safeParse(minimal);
    expect(parsed.success).toBe(true);
  });

  it('rejects negative token counts', () => {
    const parsed = TokenUsageSchema.safeParse({
      ...validUsage,
      promptTokens: -1,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects non-integer token counts', () => {
    const parsed = TokenUsageSchema.safeParse({
      ...validUsage,
      completionTokens: 1.5,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects an empty model string', () => {
    const parsed = TokenUsageSchema.safeParse({ ...validUsage, model: '' });
    expect(parsed.success).toBe(false);
  });

  it('rejects an empty generatedAt string', () => {
    const parsed = TokenUsageSchema.safeParse({
      ...validUsage,
      generatedAt: '',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects missing required fields', () => {
    const parsed = TokenUsageSchema.safeParse({
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
    });
    expect(parsed.success).toBe(false);
  });
});