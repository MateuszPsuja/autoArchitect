import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { vi } from 'vitest';
import { PlannerGraphService } from '../../core/planner-graph.service';
import { PlannerConfigState, ProjectStore, defaultProviderConfigs } from '../../core/project.store';
import { GeneratePlanComponent } from './generate-plan.component';
import { LLM_FACTORY } from '../../core/llm-provider';
import { minimalPlanFixture } from '../../testing/fixtures';

describe('GeneratePlanComponent', () => {
  function buildConfig(
    provider: PlannerConfigState['provider'],
    slot: { selectedModel?: string; defaultTemperature?: number; defaultMaxTokens?: number; customBaseUrl?: string } = {},
  ): PlannerConfigState {
    const defaults = defaultProviderConfigs();
    const slotDefaults = defaults[provider];
    return {
      provider,
      providerConfigs: {
        ...defaults,
        [provider]: {
          selectedModel: slot.selectedModel ?? 'openrouter/test',
          customBaseUrl: slot.customBaseUrl ?? slotDefaults.customBaseUrl,
          defaultTemperature: slot.defaultTemperature ?? 0.2,
          defaultMaxTokens: slot.defaultMaxTokens ?? 16384,
        },
      },
      auditRepairMaxAttempts: 1,
      parallelSectionConcurrency: 6,
      plannerMaxAttempts: 30,
      requestTimeoutMs: 90_000,
    };
  }

  const baseConfig: PlannerConfigState = buildConfig('openrouter');

  const input = {
    title: 'Planner App',
    idea: 'Planner app',
    technicalConstraints: 'Angular',
    nfrs: 'Fast feedback',
    hints: 'Use standalone components',
  };

  function setup(overrides?: Partial<{ apiKey: string; config: PlannerConfigState }>) {
    const apiKeySig = signal(overrides?.apiKey ?? '');
    const configSig = signal<PlannerConfigState>(overrides?.config ?? baseConfig);
    const isGeneratingSig = signal(false);
    const isRegeneratingSig = signal(false);
    const streamBufferSig = signal('');
    const planSig = signal<any>(null);
    const errorSig = signal<unknown>(null);
    const tokenStatsSig = signal<any>(null);
    const pendingInputSig = signal<any>({ ...input });
    const pendingResumeSig = signal<any>(null);
    const activeActivitiesSig = signal<any[]>([]);
    const diagramAuditSig = signal<any>(null);

    const refinementSig = {
      status: signal('idle'),
      questions: signal<any[]>([]),
      currentIndex: signal(0),
      answers: signal<any[]>([]),
      draftValue: signal(''),
      error: signal<string | null>(null),
      originalInput: signal(null),
    };

    const store = {
      apiKey: apiKeySig,
      config: configSig,
      isGenerating: isGeneratingSig,
      isRegenerating: isRegeneratingSig,
      streamBuffer: streamBufferSig,
      plan: planSig,
      error: errorSig,
      tokenStats: tokenStatsSig,
      pendingInput: pendingInputSig,
      pendingResume: pendingResumeSig,
      activeActivities: activeActivitiesSig,
      diagramAudit: diagramAuditSig,
      refinement: refinementSig,
      setIsGenerating: vi.fn((v: boolean) => isGeneratingSig.set(v)),
      setError: vi.fn((v: unknown) => errorSig.set(v)),
      setStreamBuffer: vi.fn((v: string) => streamBufferSig.set(v)),
      appendStream: vi.fn((chunk: string) => streamBufferSig.update((b) => b + chunk)),
      setPlan: vi.fn((p: any, ts: any) => {
        planSig.set(p);
        if (ts !== undefined) tokenStatsSig.set(ts);
      }),
      setTokenStats: vi.fn((v: any) => tokenStatsSig.set(v)),
      setPendingInput: vi.fn((v: any) => pendingInputSig.set(v)),
      setPendingResume: vi.fn((v: any) => pendingResumeSig.set(v)),
      clearActivities: vi.fn(() => activeActivitiesSig.set([])),
      clearDiagramAudit: vi.fn(() => diagramAuditSig.set(null)),
      startActivity: vi.fn(() => `act-${Math.random().toString(36).slice(2, 10)}`),
      finishActivity: vi.fn(),
      clearRefinement: vi.fn(() => {
        refinementSig.status.set('idle');
        refinementSig.questions.set([]);
        refinementSig.answers.set([]);
        refinementSig.draftValue.set('');
        refinementSig.currentIndex.set(0);
      }),
    };

    const plannerGraph = {
      generate: vi.fn(),
    };

    const fakeChat = { stream: vi.fn(), invoke: vi.fn() };
    const llmFactory = vi.fn(() => fakeChat);

    TestBed.configureTestingModule({
      imports: [GeneratePlanComponent],
      providers: [
        { provide: ProjectStore, useValue: store },
        { provide: PlannerGraphService, useValue: plannerGraph },
        { provide: ActivatedRoute, useValue: {} },
        { provide: LLM_FACTORY, useValue: llmFactory },
      ],
    });

    const fixture = TestBed.createComponent(GeneratePlanComponent);
    fixture.detectChanges();

    return {
      fixture,
      component: fixture.componentInstance as any,
      store,
      plannerGraph,
      llmFactory,
      isRegeneratingSig,
    };
  }

  it('shows no stats and no open-editor button before generation', () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.stats-section')).toBeNull();
    expect(root.querySelector('.open-editor')).toBeNull();
  });

  it('returns model-specific error when selected model is missing', async () => {
    const { component, store, plannerGraph } = setup({
      apiKey: 'sk-live-1234567890',
      config: buildConfig('openrouter', { selectedModel: '' }),
    });

    await component.runWithPendingInput();

    expect(store.setError).toHaveBeenCalledWith({
      type: 'auth',
      message: 'Select a model in Config before generating.',
    });
    expect(plannerGraph.generate).not.toHaveBeenCalled();
  });

  it('returns API-key-specific error when provider key is missing', async () => {
    const { component, store, plannerGraph } = setup({
      apiKey: '',
      config: buildConfig('openrouter', { selectedModel: 'openai/gpt-4o-mini' }),
    });

    await component.runWithPendingInput();

    expect(store.setError).toHaveBeenCalledWith({
      type: 'auth',
      message: 'Set your OpenRouter API Key in Config before generating.',
    });
    expect(plannerGraph.generate).not.toHaveBeenCalled();
  });

  it('does nothing when pending input is missing', async () => {
    const { component, store, plannerGraph } = setup({
      apiKey: 'sk-live-1234567890',
      config: buildConfig('openrouter', { selectedModel: 'openai/gpt-4o-mini' }),
    });
    (store.pendingInput as any).set(null);
    await component.runWithPendingInput();
    expect(plannerGraph.generate).not.toHaveBeenCalled();
    expect(store.setIsGenerating).not.toHaveBeenCalledWith(true);
  });

  it('writes token stats on successful generation and surfaces Open Editor', async () => {
    const { component, store, plannerGraph, fixture } = setup({
      apiKey: 'sk-live-1234567890',
      config: buildConfig('openrouter', { selectedModel: 'openai/gpt-4o-mini' }),
    });

    const plan = {
      ...minimalPlanFixture,
      meta: {
        ...minimalPlanFixture.meta,
        title: 'Planner App',
        generatedAt: '2026-01-01T00:00:00.000Z',
        model: 'openai/gpt-4o-mini',
      },
    };

    plannerGraph.generate.mockResolvedValue({ plan, error: null });

    await component.runWithPendingInput();

    expect(plannerGraph.generate).toHaveBeenCalledTimes(1);
    expect(store.setPlan).toHaveBeenCalledTimes(1);
    const [calledPlan, calledStats] = (store.setPlan as any).mock.calls.at(-1);
    expect(calledPlan).toBe(plan);
    expect(calledStats).toMatchObject({
      model: 'openai/gpt-4o-mini',
      llmCalls: expect.any(Number),
      promptTokens: expect.any(Number),
      completionTokens: expect.any(Number),
      totalTokens: expect.any(Number),
      generatedAt: '2026-01-01T00:00:00.000Z',
    });





    expect(store.setPendingInput).not.toHaveBeenCalledWith(null);

    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.stats-section')).toBeTruthy();
    const openEditor = root.querySelector('.open-editor p-button');
    expect(openEditor).toBeTruthy();
  });

  describe('with new providers', () => {
    it.each([
      ['claude', 'claude-3-7-sonnet-latest', 'Anthropic API Key'],
      ['chatgpt', 'gpt-4o', 'OpenAI API Key'],
      ['grok', 'grok-2-latest', 'xAI API Key'],
      ['minimax', 'MiniMax-M3', 'MiniMax API Key'],
    ] as const)(
      'surfaces a provider-specific auth error when %s key is missing',
      async (provider, model, apiKeyLabel) => {
        const { component, store, plannerGraph } = setup({
          apiKey: '',
          config: buildConfig(provider, { selectedModel: model }),
        });

        await component.runWithPendingInput();

        expect(store.setError).toHaveBeenCalledWith({
          type: 'auth',
          message: `Set your ${apiKeyLabel} in Config before generating.`,
        });
        expect(plannerGraph.generate).not.toHaveBeenCalled();
      },
    );

    it('does not require an API key for LM Studio', async () => {
      const { component, store, plannerGraph, llmFactory } = setup({
        apiKey: '',
        config: buildConfig('lmstudio', { selectedModel: 'local-model' }),
      });

      const plan = {
        ...minimalPlanFixture,
        meta: {
          ...minimalPlanFixture.meta,
          title: 'Planner App',
          generatedAt: '2026-01-01T00:00:00.000Z',
          model: 'local-model',
        },
      };
      plannerGraph.generate.mockResolvedValue({ plan, error: null });

      await component.runWithPendingInput();

      expect(store.setError).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'auth' }));
      expect(plannerGraph.generate).toHaveBeenCalledTimes(1);
      expect(llmFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'lmstudio',
          providerConfigs: expect.objectContaining({
            lmstudio: expect.objectContaining({ selectedModel: 'local-model' }),
          }),
        }),
        'lm-studio',
        expect.objectContaining({ streaming: true }),
      );
    });

    it('passes Claude config through to the factory with the stored api key', async () => {
      const { component, plannerGraph, llmFactory } = setup({
        apiKey: 'sk-ant-live-1234567890',
        config: buildConfig('claude', { selectedModel: 'claude-3-7-sonnet-latest' }),
      });

      plannerGraph.generate.mockResolvedValue({
        plan: {
          ...minimalPlanFixture,
          meta: {
            ...minimalPlanFixture.meta,
            title: 'x',
            generatedAt: '2026-01-01T00:00:00.000Z',
            model: 'claude-3-7-sonnet-latest',
          },
        },
        error: null,
      });

      await component.runWithPendingInput();

      expect(llmFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'claude',
          providerConfigs: expect.objectContaining({
            claude: expect.objectContaining({ selectedModel: 'claude-3-7-sonnet-latest' }),
          }),
        }),
        'sk-ant-live-1234567890',
        expect.objectContaining({ streaming: true }),
      );
    });
  });

  describe('live agent activity panel', () => {
    it('renders one row per active agent with stage + skill label', () => {
      const { fixture } = setup();
      (fixture.componentInstance as any).store.activeActivities.set([
        {
          id: 'a-1',
          stage: 'scaffold',
          agentId: 'agent-1',
          skillId: 'skill-1',
          label: null,
          startedAt: Date.now() - 1500,
          kind: 'stage',
        },
        {
          id: 'a-2',
          stage: 'layers',
          agentId: 'agent-1',
          skillId: 'skill-1',
          label: 'frontend',
          startedAt: Date.now() - 800,
          kind: 'parallel-job',
        },
      ]);
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      const panel = root.querySelector('[data-testid="activity-panel"]');
      expect(panel).toBeTruthy();
      const rows = panel?.querySelectorAll('.activity-row') ?? [];
      expect(rows.length).toBe(2);
      expect(panel?.textContent).toMatch(/scaffold/);
      expect(panel?.textContent).toMatch(/layers:frontend/);
    });

    it('does not render the panel when there are no active activities', () => {
      const { fixture } = setup();
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('[data-testid="activity-panel"]')).toBeNull();
    });

    it('collapses the parallel-job flood into a single Architect row during regeneration', () => {
      const { fixture, isRegeneratingSig } = setup();
      (fixture.componentInstance as any).store.activeActivities.set([
        {
          id: 'a-1',
          stage: 'layers',
          agentId: 'agent-1',
          skillId: 'skill-1',
          label: 'regen:layer-frontend',
          startedAt: Date.now() - 2000,
          kind: 'parallel-job',
        },
        {
          id: 'a-2',
          stage: 'domains',
          agentId: 'agent-1',
          skillId: 'skill-1',
          label: 'regen:domain-editorial',
          startedAt: Date.now() - 1000,
          kind: 'parallel-job',
        },
      ]);
      isRegeneratingSig.set(true);
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      const panel = root.querySelector('[data-testid="activity-panel"]');
      expect(panel).toBeTruthy();
      const rows = panel?.querySelectorAll('.activity-row') ?? [];
      expect(rows.length).toBe(1);
      expect(panel?.textContent).toMatch(/Architect/);
      expect(panel?.querySelector('.activity-count')?.textContent).toBe('1');
    });

    it('shows all activities during the initial generation (not just the architect)', () => {
      const { fixture } = setup();
      (fixture.componentInstance as any).store.activeActivities.set([
        {
          id: 'a-1',
          stage: 'scaffold',
          agentId: 'agent-1',
          skillId: 'skill-1',
          label: null,
          startedAt: Date.now() - 1500,
          kind: 'stage',
        },
        {
          id: 'a-2',
          stage: 'layers',
          agentId: 'agent-1',
          skillId: 'skill-1',
          label: 'frontend',
          startedAt: Date.now() - 800,
          kind: 'parallel-job',
        },
      ]);
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      const panel = root.querySelector('[data-testid="activity-panel"]');
      expect(panel).toBeTruthy();
      const rows = panel?.querySelectorAll('.activity-row') ?? [];
      expect(rows.length).toBe(2);
    });
  });

  describe('wrappedInvoker — per-call text return (plan 1787600437867 amplifier 1)', () => {
    it('returns only THIS call streamed text to the planner, never the cumulative buffer', async () => {
      const { component, plannerGraph, llmFactory } = setup({
        apiKey: 'sk-live-1234567890',
      });

      let capturedInvoker: ((text: string) => Promise<{ text: string }>) | null = null;
      (plannerGraph.generate as any).mockImplementation(
        async (_input: unknown, config: { llmInvoker: (text: string) => Promise<{ text: string }> }) => {
          capturedInvoker = config.llmInvoker;
          return { plan: null, error: null, attempts: 0 };
        },
      );

      await component.runWithPendingInput();
      expect(capturedInvoker).toBeTruthy();
      const invoker = capturedInvoker!;

      const fakeChat = llmFactory.mock.results[0].value as { stream: any };
      const chunk1 = 'first call chunk a';
      const chunk2 = 'first call chunk b';
      fakeChat.stream = vi.fn(async () =>
        (async function* () {
          yield { content: chunk1, response_metadata: {} };
          yield { content: chunk2, response_metadata: { finish_reason: 'stop' } };
        })(),
      );

      const result = await invoker('prompt 1');
      expect(result.text).toBe(chunk1 + chunk2);
      expect(result.text).not.toContain('leftover-from-prior-call');



      const siblingLeftover = 'leftover-from-prior-call';
      const store: any = (component as any).store;
      store.appendStream(siblingLeftover);

      const chunk3 = 'second call chunk a';
      fakeChat.stream = vi.fn(async () =>
        (async function* () {
          yield { content: chunk3, response_metadata: { finish_reason: 'stop' } };
        })(),
      );

      const result2 = await invoker('prompt 2');
      expect(result2.text).toBe(chunk3);
      expect(result2.text).not.toContain(siblingLeftover);
    });

    it('trims the UI streamBuffer to the last N lines so the panel fits the window', async () => {
      const { component, plannerGraph, llmFactory } = setup({
        apiKey: 'sk-live-1234567890',
      });

      let capturedInvoker: ((text: string) => Promise<{ text: string }>) | null = null;
      (plannerGraph.generate as any).mockImplementation(
        async (_input: unknown, config: { llmInvoker: (text: string) => Promise<{ text: string }> }) => {
          capturedInvoker = config.llmInvoker;
          return { plan: null, error: null, attempts: 0 };
        },
      );

      await component.runWithPendingInput();
      const invoker = capturedInvoker!;
      const fakeChat = llmFactory.mock.results[0].value as { stream: any };



      const line = 'x'.repeat(80) + '\n';
      const payload = line.repeat(400); 

      const setBufferMock = (component as any).store.setStreamBuffer as any;
      (setBufferMock as any).mockClear();

      fakeChat.stream = vi.fn(async () =>
        (async function* () {
          yield { content: payload, response_metadata: { finish_reason: 'stop' } };
        })(),
      );

      const result = await invoker('prompt big');

      expect(result.text.length).toBe(payload.length);

      const lastSetCall = (setBufferMock as any).mock.calls.at(-1)?.[0] as string | undefined;
      expect(lastSetCall).toBeDefined();
      expect(lastSetCall).toContain('[trimmed');
      const trimmedLines = lastSetCall!.split('\n');

      expect(trimmedLines.length).toBeLessThanOrEqual(21);

      expect(lastSetCall).toMatch(/trimmed \d+ lines/);
    });
  });

  describe('Stop button (stopGeneration)', () => {
    it('updates isGenerating and clears activities immediately, before the async unwind returns', () => {
      const { component, store } = setup();

      const controller = new AbortController();
      (component as { abortController: AbortController | null }).abortController = controller;
      (store.setIsGenerating as any).mockClear();
      (store.clearActivities as any).mockClear();

      component.stopGeneration();

      expect(controller.signal.aborted).toBe(true);



      expect(store.setIsGenerating).toHaveBeenCalledWith(false);
      expect(store.clearActivities).toHaveBeenCalledTimes(1);
    });

    it('still updates the UI when no AbortController is attached (defensive)', () => {
      const { component, store } = setup();
      (component as { abortController: AbortController | null }).abortController = null;
      (store.setIsGenerating as any).mockClear();
      (store.clearActivities as any).mockClear();

      component.stopGeneration();

      expect(store.setIsGenerating).toHaveBeenCalledWith(false);
      expect(store.clearActivities).toHaveBeenCalledTimes(1);
    });

    it('does not call abort twice if Stop is clicked repeatedly', () => {
      const { component, store } = setup();
      const controller = new AbortController();
      const abortSpy = vi.spyOn(controller, 'abort');
      (component as { abortController: AbortController | null }).abortController = controller;
      (store.setIsGenerating as any).mockClear();
      (store.clearActivities as any).mockClear();

      component.stopGeneration();
      component.stopGeneration();
      component.stopGeneration();

      expect(abortSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('diagram audit rows', () => {
    function withStats(store: any, overrides: Partial<{ errors: number; repairs: number }> = {}) {
      store.tokenStats.set({
        model: 'openai/gpt-4o-mini',
        promptTokens: 100,
        completionTokens: 200,
        totalTokens: 300,
        generatedAt: '2026-08-25T22:00:00.000Z',
        startedAt: '2026-08-25T22:00:00.000Z',
        llmCalls: 1,
        errors: overrides.errors ?? 0,
        retries: 0,
        repairs: overrides.repairs ?? 0,
      });
    }

    it('does not render the dedicated Diagrams / Failed diagrams rows', () => {
      const { fixture, store } = setup();
      withStats(store);
      store.diagramAudit.set({
        generatedAt: '2026-08-25T22:00:00.000Z',
        total: 15,
        passed: 12,
        failed: 3,
        skipped: 0,
        entries: [],
        repaired: 2,
      });
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('[data-testid="diagram-audit-summary"]')).toBeNull();
      expect(root.querySelector('[data-testid="diagram-audit-failures"]')).toBeNull();
    });

    it('folds the audit failed count into the Errors row and applies the warning class', () => {
      const { fixture, store } = setup();
      withStats(store, { errors: 1 });
      store.diagramAudit.set({
        generatedAt: '2026-08-25T22:00:00.000Z',
        total: 15,
        passed: 12,
        failed: 3,
        skipped: 0,
        entries: [],
        repaired: 0,
      });
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      const errorsRow = Array.from(root.querySelectorAll('.stats-row')).find((row) =>
        row.querySelector('.stats-key')?.textContent?.trim() === 'Errors',
      ) as HTMLElement;
      expect(errorsRow).toBeTruthy();
      expect(errorsRow.querySelector('.stats-value')?.textContent?.trim()).toBe('4');
      expect(errorsRow.classList.contains('stats-row-warning')).toBe(true);
    });

    it('folds the audit repaired count into the Repairs row', () => {
      const { fixture, store } = setup();
      withStats(store, { repairs: 2 });
      store.diagramAudit.set({
        generatedAt: '2026-08-25T22:00:00.000Z',
        total: 15,
        passed: 13,
        failed: 2,
        skipped: 0,
        entries: [],
        repaired: 2,
      });
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      const repairsRow = Array.from(root.querySelectorAll('.stats-row')).find((row) =>
        row.querySelector('.stats-key')?.textContent?.trim() === 'Repairs',
      ) as HTMLElement;
      expect(repairsRow).toBeTruthy();
      expect(repairsRow.querySelector('.stats-value')?.textContent?.trim()).toBe('4');
    });

    it('resets stats on a new generation so the stale diagram audit does not leak into Errors/Repairs', async () => {
      const { fixture, store, component } = setup({ apiKey: 'sk-live-1234567890' });



      withStats(store, { errors: 2, repairs: 1 });
      store.diagramAudit.set({
        generatedAt: '2026-08-25T22:00:00.000Z',
        total: 15,
        passed: 12,
        failed: 3,
        skipped: 0,
        entries: [],
        repaired: 2,
      });



      fixture.detectChanges();
      let root = fixture.nativeElement as HTMLElement;
      const errorsRowBefore = Array.from(root.querySelectorAll('.stats-row')).find((row) =>
        row.querySelector('.stats-key')?.textContent?.trim() === 'Errors',
      ) as HTMLElement;
      const repairsRowBefore = Array.from(root.querySelectorAll('.stats-row')).find((row) =>
        row.querySelector('.stats-key')?.textContent?.trim() === 'Repairs',
      ) as HTMLElement;
      expect(errorsRowBefore.querySelector('.stats-value')?.textContent?.trim()).toBe('5');
      expect(repairsRowBefore.querySelector('.stats-value')?.textContent?.trim()).toBe('3');



      const generation = component.runWithPendingInput();



      await Promise.resolve();
      await Promise.resolve();

      expect(store.clearDiagramAudit).toHaveBeenCalled();
      expect(store.setTokenStats).toHaveBeenCalled();



      fixture.detectChanges();
      root = fixture.nativeElement as HTMLElement;
      const errorsRow = Array.from(root.querySelectorAll('.stats-row')).find((row) =>
        row.querySelector('.stats-key')?.textContent?.trim() === 'Errors',
      ) as HTMLElement;
      const repairsRow = Array.from(root.querySelectorAll('.stats-row')).find((row) =>
        row.querySelector('.stats-key')?.textContent?.trim() === 'Repairs',
      ) as HTMLElement;
      expect(errorsRow.querySelector('.stats-value')?.textContent?.trim()).toBe('0');
      expect(repairsRow.querySelector('.stats-value')?.textContent?.trim()).toBe('0');



      await generation.catch(() => undefined);
    });
  });
});
