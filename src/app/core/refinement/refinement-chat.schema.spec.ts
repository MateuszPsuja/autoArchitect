import { describe, expect, it } from 'vitest';
import {
  RefinementChatLlmResponseSchema,
  RefinementChatSessionSchema,
  RefinementChatTurnSchema,
} from './refinement-chat.schema';

describe('RefinementChatSessionSchema', () => {
  it('accepts a minimal open session', () => {
    const result = RefinementChatSessionSchema.safeParse({
      id: 'session-1',
      createdAt: '2026-09-08T00:00:00.000Z',
      status: 'open',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.turns).toEqual([]);
    }
  });

  it('rejects an empty session id', () => {
    const result = RefinementChatSessionSchema.safeParse({
      id: '',
      createdAt: '2026-09-08T00:00:00.000Z',
      status: 'open',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown status values', () => {
    const result = RefinementChatSessionSchema.safeParse({
      id: 'session-1',
      createdAt: '2026-09-08T00:00:00.000Z',
      status: 'pending',
    });
    expect(result.success).toBe(false);
  });
});

describe('RefinementChatTurnSchema', () => {
  it('accepts a user turn', () => {
    const result = RefinementChatTurnSchema.safeParse({
      role: 'user',
      text: 'Move auth to a separate domain',
      at: '2026-09-08T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a finalized assistant turn', () => {
    const result = RefinementChatTurnSchema.safeParse({
      role: 'assistant',
      kind: 'finalized',
      instruction: 'Split auth into its own domain',
      at: '2026-09-08T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty finalized instruction', () => {
    const result = RefinementChatTurnSchema.safeParse({
      role: 'assistant',
      kind: 'finalized',
      instruction: '',
      at: '2026-09-08T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });
});

describe('RefinementChatLlmResponseSchema', () => {
  it('accepts a finalize decision with instruction', () => {
    const result = RefinementChatLlmResponseSchema.safeParse({
      decision: 'finalize',
      instruction: 'Add WebAuthn to the auth domain',
      rationale: 'Upgrading security posture.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects finalize without instruction', () => {
    const result = RefinementChatLlmResponseSchema.safeParse({
      decision: 'finalize',
    });
    expect(result.success).toBe(false);
  });

  it('accepts ask with at least one valid question', () => {
    const result = RefinementChatLlmResponseSchema.safeParse({
      decision: 'ask',
      questions: [
        {
          id: 'auth',
          question: 'Which identity provider should be used?',
          type: 'free_text',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects ask with no questions', () => {
    const result = RefinementChatLlmResponseSchema.safeParse({
      decision: 'ask',
      questions: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects ask without questions array', () => {
    const result = RefinementChatLlmResponseSchema.safeParse({
      decision: 'ask',
    });
    expect(result.success).toBe(false);
  });

  it('rejects malformed single_choice questions missing options', () => {
    const result = RefinementChatLlmResponseSchema.safeParse({
      decision: 'ask',
      questions: [{ id: 'q1', question: 'Which?', type: 'single_choice' }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a single_choice question with a recommended option that matches options', () => {
    const result = RefinementChatLlmResponseSchema.safeParse({
      decision: 'ask',
      questions: [
        {
          id: 'q1',
          question: 'Which platform?',
          type: 'single_choice',
          options: ['PWA', 'Native'],
          recommended: 'PWA',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a single_choice question whose recommended does not match any option', () => {
    const result = RefinementChatLlmResponseSchema.safeParse({
      decision: 'ask',
      questions: [
        {
          id: 'q1',
          question: 'Which platform?',
          type: 'single_choice',
          options: ['PWA', 'Native'],
          recommended: 'Hybrid',
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a free_text question with an optional recommended default', () => {
    const result = RefinementChatLlmResponseSchema.safeParse({
      decision: 'ask',
      questions: [
        {
          id: 'q1',
          question: 'What sync strategy?',
          type: 'free_text',
          recommended: 'Use background sync',
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});