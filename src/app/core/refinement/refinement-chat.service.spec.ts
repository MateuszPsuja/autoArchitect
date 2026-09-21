import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { LLM_FACTORY } from '../llm-provider';
import {
  ProjectStore,
  defaultProviderConfigs,
  type PlannerConfigState,
} from '../project.store';
import { minimalPlanFixture } from '../../testing/fixtures';
import { MarkdownRendererService } from '../markdown-renderer.service';
import { RefinementChatService } from './refinement-chat.service';
import type { RefinementChatLlmResponse } from './refinement-chat.schema';

const config: PlannerConfigState = {
  provider: 'openrouter',
  providerConfigs: defaultProviderConfigs({
    openrouter: { selectedModel: 'openai/gpt-4o-mini' },
  }),
  auditRepairMaxAttempts: 1,
  parallelSectionConcurrency: 1,
  plannerMaxAttempts: 10,
  requestTimeoutMs: 90_000,
};

function setup(structuredValue: unknown, plainValue: unknown = '') {
  const structuredInvoke = vi.fn().mockResolvedValue(structuredValue);
  const plainInvoke = vi.fn().mockResolvedValue(plainValue);
  const chat = {
    withStructuredOutput: vi.fn(() => ({ invoke: structuredInvoke })),
    invoke: plainInvoke,
  };
  const markdownRenderer = {
    toMarkdownFiles: vi.fn(() => []),
  };
  const store = {
    config: signal(config),
    apiKey: signal('sk-test-key'),
    plan: signal(minimalPlanFixture),
    markdownOverrides: signal({}),
  };
  const factory = vi.fn(() => chat);

  TestBed.configureTestingModule({
    providers: [
      RefinementChatService,
      { provide: ProjectStore, useValue: store },
      { provide: MarkdownRendererService, useValue: markdownRenderer },
      { provide: LLM_FACTORY, useValue: factory },
    ],
  });

  return {
    service: TestBed.inject(RefinementChatService),
    chat,
    structuredInvoke,
    plainInvoke,
    factory,
    markdownRenderer,
    store,
  };
}

describe('RefinementChatService', () => {
  it('returns a finalize decision when structured output is valid', async () => {
    const structured: RefinementChatLlmResponse = {
      decision: 'finalize',
      instruction: 'Add caching layer',
      rationale: 'Reduces latency.',
    };
    const { service, structuredInvoke, plainInvoke } = setup(structured);
    const result = await service.consult({
      plan: minimalPlanFixture,
      userPrompt: 'Reduce latency',
      history: [],
    });
    expect(result).toEqual(structured);
    expect(structuredInvoke).toHaveBeenCalledTimes(1);
    expect(plainInvoke).not.toHaveBeenCalled();
  });

  it('returns ask decision with questions when model requests clarifications', async () => {
    const structured: RefinementChatLlmResponse = {
      decision: 'ask',
      questions: [
        {
          id: 'cache',
          question: 'Which cache backend?',
          type: 'single_choice',
          options: ['Redis', 'Memcached'],
        },
      ],
    };
    const { service } = setup(structured);
    const result = await service.consult({
      plan: minimalPlanFixture,
      userPrompt: 'Reduce latency',
      history: [],
    });
    expect(result.decision).toBe('ask');
    expect(result.questions).toHaveLength(1);
  });

  it('falls back to plain JSON after an invalid structured response', async () => {
    const fallback: RefinementChatLlmResponse = {
      decision: 'finalize',
      instruction: 'Move auth to its own bounded context',
    };
    const { service, structuredInvoke, plainInvoke } = setup(
      { decision: 'ask', questions: [] },
      JSON.stringify(fallback),
    );
    const result = await service.consult({
      plan: minimalPlanFixture,
      userPrompt: 'Decouple auth',
      history: [],
    });
    expect(result.decision).toBe('finalize');
    expect(result.instruction).toBe('Move auth to its own bounded context');
    expect(structuredInvoke).toHaveBeenCalledTimes(1);
    expect(plainInvoke).toHaveBeenCalledTimes(1);
  });

  it('returns empty finalize when both attempts produce invalid JSON', async () => {
    const { service, structuredInvoke, plainInvoke } = setup(
      { decision: 'unknown' },
      'still not json',
    );
    const result = await service.consult({
      plan: minimalPlanFixture,
      userPrompt: 'Refine please',
      history: [],
    });
    expect(result).toEqual({ decision: 'finalize', instruction: '' });
    expect(structuredInvoke).toHaveBeenCalledTimes(1);
    expect(plainInvoke).toHaveBeenCalledTimes(1);
  });

  it('treats an ask decision with no questions as finalize', async () => {
    const { service } = setup({ decision: 'ask', questions: [] });
    const result = await service.consult({
      plan: minimalPlanFixture,
      userPrompt: 'Refine',
      history: [],
    });
    expect(result).toEqual({ decision: 'finalize', instruction: '' });
  });

  it('returns empty finalize when the API key is missing', async () => {
    const structured = { decision: 'finalize', instruction: 'noop' };
    const structuredInvoke = vi.fn().mockResolvedValue(structured);
    const plainInvoke = vi.fn().mockResolvedValue('');
    const chat = {
      withStructuredOutput: vi.fn(() => ({ invoke: structuredInvoke })),
      invoke: plainInvoke,
    };
    const store = {
      config: signal(config),
      apiKey: signal(''),
      plan: signal(minimalPlanFixture),
      markdownOverrides: signal({}),
    };
    const markdownRenderer = { toMarkdownFiles: vi.fn(() => []) };
    const factory = vi.fn(() => chat);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        RefinementChatService,
        { provide: ProjectStore, useValue: store },
        { provide: MarkdownRendererService, useValue: markdownRenderer },
        { provide: LLM_FACTORY, useValue: factory },
      ],
    });
    const service = TestBed.inject(RefinementChatService);
    const result = await service.consult({
      plan: minimalPlanFixture,
      userPrompt: 'Refine',
      history: [],
    });
    expect(result).toEqual({ decision: 'finalize', instruction: '' });
    expect(structuredInvoke).not.toHaveBeenCalled();
  });

  it('forwards user-edited markdown overrides to the prompt context', async () => {
    const structuredInvoke = vi.fn().mockResolvedValue({
      decision: 'finalize',
      instruction: 'Apply change',
    });
    const chat = {
      withStructuredOutput: vi.fn(() => ({ invoke: structuredInvoke })),
      invoke: vi.fn().mockResolvedValue(''),
    };
    const markdownRenderer = {
      toMarkdownFiles: vi.fn(() => [
        { path: 'docs/architecture/overview.md', content: '# Original' },
      ]),
    };
    const store = {
      config: signal(config),
      apiKey: signal('sk-test-key'),
      plan: signal(minimalPlanFixture),
      markdownOverrides: signal({
        'docs/architecture/overview.md': '# Edited by user',
      }),
    };
    const factory = vi.fn(() => chat);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        RefinementChatService,
        { provide: ProjectStore, useValue: store },
        { provide: MarkdownRendererService, useValue: markdownRenderer },
        { provide: LLM_FACTORY, useValue: factory },
      ],
    });
    const service = TestBed.inject(RefinementChatService);
    await service.consult({
      plan: minimalPlanFixture,
      userPrompt: 'Refine',
      history: [],
    });
    expect(structuredInvoke).toHaveBeenCalledTimes(1);
    const promptText = structuredInvoke.mock.calls[0][0] as string;
    expect(promptText).toContain('# Edited by user');
    expect(promptText).toContain('docs/architecture/overview.md');
  });
});