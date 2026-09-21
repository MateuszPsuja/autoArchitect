import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { LLM_FACTORY } from '../llm-provider';
import { ProjectStore, defaultProviderConfigs, type PlannerConfigState } from '../project.store';
import { RefinementService } from './refinement.service';

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

const input = {
  title: 'Team Planner',
  idea: 'A planning workspace for product and engineering teams.',
  technicalConstraints: '',
  nfrs: '',
  hints: '',
  contextAttachments: [],
};

function setup(structuredValue: unknown, plainValue: unknown = '') {
  const structuredInvoke = vi.fn().mockResolvedValue(structuredValue);
  const plainInvoke = vi.fn().mockResolvedValue(plainValue);
  const chat = {
    withStructuredOutput: vi.fn(() => ({ invoke: structuredInvoke })),
    invoke: plainInvoke,
  };
  const store = {
    config: signal(config),
    apiKey: signal('sk-test-key'),
  };
  const factory = vi.fn(() => chat);

  TestBed.configureTestingModule({
    providers: [
      RefinementService,
      { provide: ProjectStore, useValue: store },
      { provide: LLM_FACTORY, useValue: factory },
    ],
  });

  return {
    service: TestBed.inject(RefinementService),
    chat,
    structuredInvoke,
    plainInvoke,
    factory,
  };
}

function setupThrowing(structuredError: unknown, plainError: unknown = structuredError) {
  const structuredInvoke = vi.fn().mockRejectedValue(structuredError);
  const plainInvoke = vi.fn().mockRejectedValue(plainError);
  const chat = {
    withStructuredOutput: vi.fn(() => ({ invoke: structuredInvoke })),
    invoke: plainInvoke,
  };
  const store = {
    config: signal(config),
    apiKey: signal('sk-test-key'),
  };
  const factory = vi.fn(() => chat);

  TestBed.configureTestingModule({
    providers: [
      RefinementService,
      { provide: ProjectStore, useValue: store },
      { provide: LLM_FACTORY, useValue: factory },
    ],
  });

  return {
    service: TestBed.inject(RefinementService),
    chat,
    structuredInvoke,
    plainInvoke,
    factory,
  };
}

describe('RefinementService', () => {
  it('returns validated structured questions', async () => {
    const { service, structuredInvoke, plainInvoke } = setup({
      questions: [
        {
          id: 'deployment',
          question: 'Where will the application run?',
          rationale: 'Deployment changes the hosting architecture.',
          type: 'single_choice',
          options: ['Browser', 'Managed server'],
        },
      ],
    });

    const questions = await service.suggestQuestions(input);

    expect(questions).toHaveLength(1);
    expect(questions[0].id).toBe('deployment');
    expect(structuredInvoke).toHaveBeenCalledTimes(1);
    expect(plainInvoke).not.toHaveBeenCalled();
  });

  it('falls back to a plain JSON response after an invalid structured response', async () => {
    const { service, structuredInvoke, plainInvoke } = setup(
      { questions: [{ id: 'bad' }] },
      JSON.stringify({
        questions: [
          {
            id: 'auth',
            question: 'Which identity provider should be used?',
            type: 'free_text',
          },
        ],
      }),
    );

    const questions = await service.suggestQuestions(input);

    expect(questions[0].id).toBe('auth');
    expect(structuredInvoke).toHaveBeenCalledTimes(1);
    expect(plainInvoke).toHaveBeenCalledTimes(1);
  });

  it('returns an empty list when both attempts fail validation', async () => {
    const { service, plainInvoke } = setup({ invalid: true }, '{"questions":[]}');

    await expect(service.suggestQuestions(input)).resolves.toEqual([]);
    expect(plainInvoke).toHaveBeenCalledTimes(1);
  });

  it('does not invoke the model when the signal is already aborted', async () => {
    const { service, factory } = setup({ questions: [] });
    const controller = new AbortController();
    controller.abort();

    await expect(service.suggestQuestions(input, controller.signal)).resolves.toEqual([]);
    expect(factory).not.toHaveBeenCalled();
  });

  it('forwards priorAnswers into the prompt context', async () => {
    const { service, structuredInvoke } = setup({
      questions: [
        {
          id: 'scaling',
          question: 'What scale do you expect?',
          type: 'free_text',
        },
      ],
    });
    const priorAnswers = [
      { question: 'Where will it run?', value: 'Managed server', skipped: false },
      { question: 'Which identity provider?', value: '', skipped: true },
    ];

    await service.suggestQuestions(input, undefined, priorAnswers);

    const prompt = structuredInvoke.mock.calls[0][0] as string;
    expect(prompt).toContain('Prior round answers:');
    expect(prompt).toContain('Q: Where will it run?');
    expect(prompt).toContain('A: Managed server');
    expect(prompt).toContain('Q: Which identity provider?');
    expect(prompt).toContain('A: (skipped)');
  });

  it('still works with no priorAnswers (back-compat)', async () => {
    const { service, structuredInvoke } = setup({
      questions: [
        {
          id: 'deployment',
          question: 'Where will it run?',
          type: 'single_choice',
          options: ['Browser', 'Server'],
        },
      ],
    });

    await service.suggestQuestions(input);

    const prompt = structuredInvoke.mock.calls[0][0] as string;
    expect(prompt).not.toContain('Prior round answers:');
  });

  it('rejects when both attempts throw so the planner can surface the failure', async () => {
    const authError = new Error('401 Missing Authentication header');
    const { service, plainInvoke } = setupThrowing(authError);

    await expect(service.suggestQuestions(input)).rejects.toBe(authError);
    expect(plainInvoke).toHaveBeenCalledTimes(1);
  });

  it('rejects with the second attempt error when the first throws and the second also throws', async () => {
    const first = new Error('503 upstream unavailable');
    const second = new Error('401 Missing Authentication header');
    const { service, structuredInvoke, plainInvoke } = setupThrowing(first, second);

    await expect(service.suggestQuestions(input)).rejects.toBe(second);
    expect(structuredInvoke).toHaveBeenCalledTimes(1);
    expect(plainInvoke).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the first attempt throws but the second returns a valid response', async () => {
    const structuredInvoke = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient structured failure'));
    const plainInvoke = vi.fn().mockResolvedValue(
      JSON.stringify({
        questions: [
          {
            id: 'auth',
            question: 'Which identity provider should be used?',
            type: 'free_text',
          },
        ],
      }),
    );
    const chat = {
      withStructuredOutput: vi.fn(() => ({ invoke: structuredInvoke })),
      invoke: plainInvoke,
    };
    const store = {
      config: signal(config),
      apiKey: signal('sk-test-key'),
    };
    const factory = vi.fn(() => chat);

    TestBed.configureTestingModule({
      providers: [
        RefinementService,
        { provide: ProjectStore, useValue: store },
        { provide: LLM_FACTORY, useValue: factory },
      ],
    });

    const service = TestBed.inject(RefinementService);
    const questions = await service.suggestQuestions(input);

    expect(questions).toHaveLength(1);
    expect(questions[0].id).toBe('auth');
  });
});
