import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectStore } from './project.store';
import { MICROBLOG_DEMO_PLAN } from './demo-plan/microblog.plan';
import { Plan } from './plan.schema';
import { DiagramAuditService } from './diagram-audit.service';

describe('ProjectStore', () => {
  let storage: Record<string, string>;

  beforeEach(() => {
    vi.useFakeTimers();
    storage = {};
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete storage[key];
      }),
      clear: vi.fn(() => {
        storage = {};
      }),
    });
    TestBed.resetTestingModule();
  });

  afterEach(() => {
    vi.advanceTimersByTime(10_000);
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('persists and hydrates the per-provider development API keys through config storage', () => {
    const store = TestBed.inject(ProjectStore);

    store.setApiKey('sk-openai-persisted-development-key', 'openrouter');
    vi.advanceTimersByTime(250);

    const rawConfig = localStorage.getItem('arc-planner:config');
    expect(rawConfig).not.toBeNull();
    const parsed = JSON.parse(rawConfig ?? '{}');
    expect(parsed.v).toBe(3);
    expect(parsed.config.providerApiKeys.openrouter).toBe('sk-openai-persisted-development-key');

    TestBed.resetTestingModule();
    const hydratedStore = TestBed.inject(ProjectStore);

    expect(hydratedStore.apiKey()).toBe('sk-openai-persisted-development-key');
    expect(hydratedStore.providerApiKeyFor('openrouter')).toBe('sk-openai-persisted-development-key');
    expect(hydratedStore.providerApiKeyFor('claude')).toBe('');
  });

  it('preserves keys across providers when switching', () => {
    const store = TestBed.inject(ProjectStore);

    store.setConfig({ ...store.config(), provider: 'openrouter' });
    store.setApiKey('sk-openai-1234567890', 'openrouter');
    store.setConfig({ ...store.config(), provider: 'claude' });
    store.setApiKey('sk-ant-1234567890', 'claude');
    vi.advanceTimersByTime(250);

    expect(store.providerApiKeyFor('openrouter')).toBe('sk-openai-1234567890');
    expect(store.providerApiKeyFor('claude')).toBe('sk-ant-1234567890');
    expect(store.apiKey()).toBe('sk-ant-1234567890');
  });

  it('clears only the active provider when clearApiKey is called', () => {
    const store = TestBed.inject(ProjectStore);

    store.setConfig({ ...store.config(), provider: 'openrouter' });
    store.setApiKey('sk-openai-1234567890', 'openrouter');
    store.setConfig({ ...store.config(), provider: 'claude' });
    store.setApiKey('sk-ant-1234567890', 'claude');

    store.clearApiKey('claude');
    expect(store.providerApiKeyFor('claude')).toBe('');
    expect(store.providerApiKeyFor('openrouter')).toBe('sk-openai-1234567890');
  });

  it('setApiKey writes to the passed provider slot, not the active one', () => {
    const store = TestBed.inject(ProjectStore);

    store.setConfig({ ...store.config(), provider: 'openrouter' });
    store.setApiKey('sk-openai-1234567890', 'openrouter');

    store.setConfig({ ...store.config(), provider: 'claude' });
    store.setApiKey('sk-still-openai-1234567890', 'openrouter');

    expect(store.providerApiKeyFor('openrouter')).toBe('sk-still-openai-1234567890');
    expect(store.providerApiKeyFor('claude')).toBe('');
    expect(store.apiKey()).toBe('');
  });

  it('clearAllApiKeys wipes every per-provider slot and persists the empty map', () => {
    const store = TestBed.inject(ProjectStore);

    store.setApiKey('sk-openai-1234567890', 'openrouter');
    store.setApiKey('sk-ant-1234567890', 'claude');
    store.setApiKey('sk-minimax-1234567890', 'minimax');
    vi.advanceTimersByTime(250);

    store.clearAllApiKeys();
    vi.advanceTimersByTime(250);

    expect(store.providerApiKeyFor('openrouter')).toBe('');
    expect(store.providerApiKeyFor('claude')).toBe('');
    expect(store.providerApiKeyFor('minimax')).toBe('');
    expect(store.providerApiKeyFor('lmstudio')).toBe('');

    const rawConfig = localStorage.getItem('arc-planner:config');
    const parsed = JSON.parse(rawConfig ?? '{}');
    expect(parsed.config.providerApiKeys.openrouter).toBe('');
    expect(parsed.config.providerApiKeys.claude).toBe('');
    expect(parsed.config.providerApiKeys.minimax).toBe('');
  });

  it('migrates the legacy v1 single-apiKey config into the per-provider map', () => {
    storage['arc-planner:config'] = JSON.stringify({
      v: 1,
      config: {
        apiKey: 'sk-openai-legacy-1234567890',
        provider: 'openrouter',
        selectedModel: '',
        defaultTemperature: 0.2,
        defaultMaxTokens: 16384,
        customBaseUrl: 'http://localhost:1234/v1',
      },
    });

    TestBed.resetTestingModule();
    const store = TestBed.inject(ProjectStore);

    expect(store.apiKey()).toBe('sk-openai-legacy-1234567890');
    expect(store.providerApiKeyFor('openrouter')).toBe('sk-openai-legacy-1234567890');
    expect(store.providerApiKeyFor('claude')).toBe('');
  });

  it('removes the persisted key for the active provider when clearing it', () => {
    const store = TestBed.inject(ProjectStore);

    store.setApiKey('sk-live-persisted-development-key', 'openrouter');
    vi.advanceTimersByTime(250);

    store.clearApiKey('openrouter');
    vi.advanceTimersByTime(250);

    const rawConfig = localStorage.getItem('arc-planner:config');
    expect(JSON.parse(rawConfig ?? '{}').config.providerApiKeys.openrouter).toBe('');
  });

  it('hydrates the custom-base-URL field from the legacy lmStudioBaseUrl key', () => {
    storage['arc-planner:config'] = JSON.stringify({
      v: 2,
      config: {
        providerApiKeys: {},
        provider: 'minimax',
        selectedModel: 'MiniMax-M3',
        defaultTemperature: 0.2,
        defaultMaxTokens: 16384,
        lmStudioBaseUrl: 'https://api.minimaxi.com/v1',
      },
    });

    TestBed.resetTestingModule();
    const store = TestBed.inject(ProjectStore);

    expect(store.activeConfig().customBaseUrl).toBe('https://api.minimaxi.com/v1');
    expect(store.activeConfig().selectedModel).toBe('MiniMax-M3');
  });

  it('registers the News Portal demo plan as a saved plan on first run when storage is empty', () => {
    TestBed.resetTestingModule();
    const store = TestBed.inject(ProjectStore);

    expect(store.plan()).toBeNull();
    expect(store.savedPlans().length).toBe(1);
    const demo = store.savedPlans()[0];
    expect(demo.id).toBe('demo:microblog');
    expect(demo.title).toBe('Microblog Platform (Demo)');
    expect(demo.model).toBe('demo-seed');
    expect(demo.plan.meta.title).toBe('Microblog Platform (Demo)');
    expect(localStorage.getItem('arc-planner:demo:dismissed')).toBeNull();
  });

  it('does not seed the demo plan when an existing plan is persisted', () => {
    const customPlan = {
      meta: {
        title: 'My Custom Plan',
        summary: 'x',
        generatedAt: '2026-01-01T00:00:00.000Z',
        model: 'test',
        featureNumber: 1,
        featureSlug: 'my-custom-plan',
      },
      systemOverview: {
        purpose: 'x',
        context: 'x',
        keyActors: ['a'],
        constraints: ['b'],
        nfrs: ['c'],
        c4: {
          contextDiagram: 'flowchart LR\n  A-->B',
          containerDiagram: 'flowchart LR\n  A-->B',
        },
      },
      boundedContexts: [
        {
          id: 'bc',
          name: 'BC',
          description: 'd',
          layer: 'backend',
          ubiquitousLanguage: { Foo: 'bar' },
        },
      ],
      architectureLayers: [
        {
          id: 'backend',
          name: 'Backend',
          description: 'd',
          techStack: ['x'],
          patterns: ['y'],
          mermaidDiagram: 'flowchart LR\n  A-->B',
          directoryStructure: [
            { path: 'backend/src/x', description: 'd', agentInstructions: ['a', 'b', 'c'] },
          ],
        },
      ],
      domains: [
        {
          id: 'd1',
          name: 'D1',
          description: 'd',
          layer: 'backend',
          responsibilities: ['r'],
          aggregates: [],
          domainEvents: [],
          directoryPath: 'backend/src/d1',
          components: [
            {
              id: 'c1',
              name: 'C1',
              description: 'd',
              type: 'service',
              layer: 'domain',
              responsibilities: ['r'],
              inputs: ['i'],
              outputs: ['o'],
              dependencies: [],
              publicApi: ['p'],
              errorHandling: 'e',
              acceptanceCriteria: ['a'],
              tddSpec: {
                unitTests: [
                  { description: 't', given: ['g'], when: 'w', then: ['th'] },
                  { description: 't', given: ['g'], when: 'w', then: ['th'] },
                ],
                integrationTests: [
                  { description: 't', given: ['g'], when: 'w', then: ['th'] },
                ],
              },
              targetFile: 'backend/src/d1/c1.py',
              outOfScope: ['x'],
            },
          ],
        },
      ],
    };

    storage['arc-planner:plan'] = JSON.stringify({
      plan: { ...customPlan, architecture: {} },
      tokenStats: null,
    });

    TestBed.resetTestingModule();
    const store = TestBed.inject(ProjectStore);

    expect(store.plan()?.meta.title).toBe('My Custom Plan');
    expect(store.savedPlans().some((s) => s.id === 'demo:microblog')).toBe(true);
  });

  it('does not seed the demo plan when the dismissal marker is set', () => {
    storage['arc-planner:demo:dismissed'] = '1';

    TestBed.resetTestingModule();
    const store = TestBed.inject(ProjectStore);

    expect(store.plan()).toBeNull();
  });

  it('removes the demo entry from saved plans and prevents re-seeding on close', () => {
    TestBed.resetTestingModule();
    const store = TestBed.inject(ProjectStore);

    expect(store.savedPlans().some((s) => s.id === 'demo:microblog')).toBe(true);

    store.dismissDemoPlan();
    vi.advanceTimersByTime(250);

    expect(store.savedPlans().some((s) => s.id === 'demo:microblog')).toBe(false);
    expect(localStorage.getItem('arc-planner:demo:dismissed')).toBe('1');

    TestBed.resetTestingModule();
    const rehydrated = TestBed.inject(ProjectStore);
    expect(rehydrated.savedPlans().some((s) => s.id === 'demo:microblog')).toBe(false);
  });

  it('does not set the dismissal marker when closing a non-demo plan', () => {
    TestBed.resetTestingModule();
    const store = TestBed.inject(ProjectStore);

    store.setPlan(
      {
        ...store.savedPlans()[0].plan,
        meta: {
          ...store.savedPlans()[0].plan.meta,
          title: 'User Plan',
          generatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
      null,
    );
    localStorage.removeItem('arc-planner:demo:dismissed');

    store.closePlan();
    vi.advanceTimersByTime(250);

    expect(localStorage.getItem('arc-planner:demo:dismissed')).toBeNull();
  });

  it('dismissDemoPlan sets the marker and removes the demo entry', () => {
    TestBed.resetTestingModule();
    const store = TestBed.inject(ProjectStore);

    expect(store.savedPlans().some((s) => s.id === 'demo:microblog')).toBe(true);

    store.dismissDemoPlan();
    vi.advanceTimersByTime(250);

    expect(store.savedPlans().some((s) => s.id === 'demo:microblog')).toBe(false);
    expect(localStorage.getItem('arc-planner:demo:dismissed')).toBe('1');
  });

  it('deleteSavedPlan on the demo is a no-op and does not set the dismissal marker', () => {
    TestBed.resetTestingModule();
    const store = TestBed.inject(ProjectStore);

    const before = store.savedPlans().length;
    expect(store.savedPlans().some((s) => s.id === 'demo:microblog')).toBe(true);

    store.deleteSavedPlan('demo:microblog');
    vi.advanceTimersByTime(250);

    expect(store.savedPlans().some((s) => s.id === 'demo:microblog')).toBe(true);
    expect(store.savedPlans().length).toBe(before);
    expect(localStorage.getItem('arc-planner:demo:dismissed')).toBeNull();
  });

  it('refreshes the active demo plan when persisted in localStorage without spec-kit fields', () => {
    const staleDemo: Plan = {
      ...MICROBLOG_DEMO_PLAN,
      meta: { ...MICROBLOG_DEMO_PLAN.meta, generatedAt: '2026-07-21T00:00:00.000Z' },
    };

    const layers = staleDemo.architectureLayers.map((l) => ({
      ...l,
      summary: undefined,
      technicalContext: undefined,
      constitutionCheck: undefined,
      projectStructureTree: undefined,
      complexityTracking: undefined,
      componentTreeDiagram: undefined,
      dataFlowDiagram: undefined,
      moduleDependenciesDiagram: undefined,
      stateManagementDiagram: undefined,
      apiContractDiagram: undefined,
    }));
    const planToPersist = {
      ...staleDemo,
      architectureLayers: layers as Plan['architectureLayers'],
    };
    storage['arc-planner:plan'] = JSON.stringify({ plan: planToPersist, tokenStats: null });

    TestBed.resetTestingModule();
    const rehydrated = TestBed.inject(ProjectStore);

    const loaded = rehydrated.plan()!;
    expect(loaded.meta.generatedAt).toBe(MICROBLOG_DEMO_PLAN.meta.generatedAt);
    expect(loaded.architectureLayers.some((l) => !!l.componentTreeDiagram)).toBe(true);
  });

  it('hydrates a freshly-built plan without an `architecture` placeholder', () => {



    const generatedAt = '2026-08-20T12:00:00.000Z';
    const generated: Plan = {
      ...MICROBLOG_DEMO_PLAN,
      meta: { ...MICROBLOG_DEMO_PLAN.meta, title: 'User-Generated Plan', generatedAt },
    };
    storage['arc-planner:plan'] = JSON.stringify({ plan: generated, tokenStats: null });

    TestBed.resetTestingModule();
    const rehydrated = TestBed.inject(ProjectStore);

    const loaded = rehydrated.plan();
    expect(loaded, 'plan is not cleared from localStorage').not.toBeNull();
    expect(loaded!.meta.title).toBe('User-Generated Plan');
    expect(loaded!.meta.generatedAt).toBe(generatedAt);
    expect(localStorage.getItem('arc-planner:plan')).not.toBeNull();
  });

  it('refreshes the demo saved-plan entry from the current demo source', () => {
    const staleDemo: Plan = {
      ...MICROBLOG_DEMO_PLAN,
      meta: { ...MICROBLOG_DEMO_PLAN.meta, generatedAt: '2026-07-21T00:00:00.000Z' },
    };
    storage['arc-planner:saved-plans'] = JSON.stringify([
      {
        id: 'demo:microblog',
        title: staleDemo.meta.title,
        savedAt: staleDemo.meta.generatedAt,
        model: staleDemo.meta.model,
        tokenStats: null,
        plan: staleDemo,
      },
    ]);

    TestBed.resetTestingModule();
    const rehydrated = TestBed.inject(ProjectStore);

    const demoEntry = rehydrated.savedPlans().find((s) => s.id === 'demo:microblog')!;
    expect(demoEntry).toBeDefined();
    expect(demoEntry.plan.meta.generatedAt).toBe(MICROBLOG_DEMO_PLAN.meta.generatedAt);
    expect(demoEntry.plan.architectureLayers.some((l) => !!l.componentTreeDiagram)).toBe(true);
  });

  it('loadSavedPlan refreshes the demo entry in-place and loads the fresh plan', () => {



    const staleEntryTimestamp = '2026-07-21T00:00:00.000Z';
    const staleDemo: Plan = {
      ...MICROBLOG_DEMO_PLAN,
      meta: { ...MICROBLOG_DEMO_PLAN.meta, generatedAt: staleEntryTimestamp },
      architectureLayers: MICROBLOG_DEMO_PLAN.architectureLayers.map((l) => ({
        ...l,



        summary: 'forced-stale',
      })) as Plan['architectureLayers'],
    };
    storage['arc-planner:saved-plans'] = JSON.stringify([
      {
        id: 'demo:microblog',
        title: 'Microblog Platform (Demo)',
        savedAt: staleEntryTimestamp,
        model: 'demo-seed',
        tokenStats: null,
        plan: staleDemo,
      },
    ]);

    TestBed.resetTestingModule();
    const store = TestBed.inject(ProjectStore);
    vi.advanceTimersByTime(250);



    store.loadSavedPlan('demo:microblog');
    vi.advanceTimersByTime(250);

    const active = store.plan();
    expect(active, 'active plan is set').toBeTruthy();
    expect(active!.meta.generatedAt).toBe(MICROBLOG_DEMO_PLAN.meta.generatedAt);
    expect(
      active!.architectureLayers.some((l) => !!l.componentTreeDiagram),
      'active plan has spec-kit field',
    ).toBe(true);
    expect(
      active!.architectureLayers.some((l) => l.summary === 'forced-stale'),
      'stale summary is gone',
    ).toBe(false);

    const savedEntry = store.savedPlans().find((s) => s.id === 'demo:microblog');
    expect(savedEntry!.plan.meta.generatedAt).toBe(MICROBLOG_DEMO_PLAN.meta.generatedAt);
  });

  it('setPlan refreshes the demo plan even when a stale copy is passed', () => {
    const staleDemo: Plan = {
      ...MICROBLOG_DEMO_PLAN,
      meta: { ...MICROBLOG_DEMO_PLAN.meta, generatedAt: '2026-07-21T00:00:00.000Z' },
    };
    TestBed.resetTestingModule();
    const store = TestBed.inject(ProjectStore);

    store.setPlan(staleDemo, null);
    vi.advanceTimersByTime(250);

    const active = store.plan()!;
    expect(active.meta.generatedAt).toBe(MICROBLOG_DEMO_PLAN.meta.generatedAt);
  });

  it('setPdfTokenStats updates the signal and hasPdfTokenStats flips, but is not persisted', () => {
    TestBed.resetTestingModule();
    const store = TestBed.inject(ProjectStore);

    expect(store.hasPdfTokenStats()).toBe(false);

    store.setPdfTokenStats({
      promptTokens: 100,
      completionTokens: 200,
      totalTokens: 300,
      model: 'openai/gpt-4o-mini',
      generatedAt: '2026-08-21T00:00:00.000Z',
      startedAt: '2026-08-21T00:00:00.000Z',
      llmCalls: 4,
    });
    vi.advanceTimersByTime(500);

    expect(store.hasPdfTokenStats()).toBe(true);
    expect(store.pdfTokenStats()?.completionTokens).toBe(200);

    const planRaw = localStorage.getItem('arc-planner:plan');
    expect(planRaw).toBeNull();
    const configRaw = localStorage.getItem('arc-planner:config');
    expect(configRaw).not.toBeNull();
    const parsedConfig = JSON.parse(configRaw ?? '{}');
    expect(parsedConfig.config).toBeDefined();
    expect(Object.keys(parsedConfig.config)).not.toContain('pdfTokenStats');

    TestBed.resetTestingModule();
    const rehydrated = TestBed.inject(ProjectStore);
    expect(rehydrated.hasPdfTokenStats()).toBe(false);
    expect(rehydrated.pdfTokenStats()).toBeNull();
  });

  it('replaceState clears pdfTokenStats', () => {
    TestBed.resetTestingModule();
    const store = TestBed.inject(ProjectStore);

    store.setPdfTokenStats({
      promptTokens: 1,
      completionTokens: 2,
      totalTokens: 3,
      model: 'm',
      generatedAt: '2026-08-21T00:00:00.000Z',
    });
    expect(store.hasPdfTokenStats()).toBe(true);

    store.replaceState({
      version: 1,
      exportedAt: '2026-08-21T00:00:00.000Z',
      config: store.config(),
      providerApiKeys: store.providerApiKeys(),
      plan: null,
      tokenStats: null,
      markdownOverrides: {},
      savedPlans: [],
    });

    expect(store.hasPdfTokenStats()).toBe(false);
    expect(store.pdfTokenStats()).toBeNull();
  });

  it('persists the planner input draft to localStorage on setPendingInput', () => {
    const store = TestBed.inject(ProjectStore);

    const draft = {
      title: 'Acme Planner',
      idea: 'A tool that helps engineers scaffold projects faster.',
      technicalConstraints: 'Angular 17+',
      nfrs: '<200ms p95',
      hints: 'Use standalone components',
      contextAttachments: [],
    };
    store.setPendingInput(draft);

    const raw = localStorage.getItem('arc-planner:planner-input');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw ?? '{}')).toEqual(draft);
  });

  it('hydrates pendingInput from localStorage on next instantiation', () => {
    storage['arc-planner:planner-input'] = JSON.stringify({
      title: 'Restored Plan',
      idea: 'Idea restored from localStorage so the user does not lose it on refresh.',
      technicalConstraints: 'Vue 3',
      nfrs: 'Low LOC',
      hints: '',
      contextAttachments: [],
    });

    TestBed.resetTestingModule();
    const rehydrated = TestBed.inject(ProjectStore);

    expect(rehydrated.pendingInput()).toEqual({
      title: 'Restored Plan',
      idea: 'Idea restored from localStorage so the user does not lose it on refresh.',
      technicalConstraints: 'Vue 3',
      nfrs: 'Low LOC',
      hints: '',
      contextAttachments: [],
    });
  });

  it('discards a malformed planner-input blob instead of crashing hydration', () => {
    storage['arc-planner:planner-input'] = '{ this is not json';

    TestBed.resetTestingModule();
    const store = TestBed.inject(ProjectStore);

    expect(store.pendingInput()).toBeNull();
    expect(localStorage.getItem('arc-planner:planner-input')).toBeNull();
  });

  it('discards a planner-input blob missing required keys', () => {
    storage['arc-planner:planner-input'] = JSON.stringify({ idea: 'only an idea' });

    TestBed.resetTestingModule();
    const store = TestBed.inject(ProjectStore);

    expect(store.pendingInput()).toBeNull();
    expect(localStorage.getItem('arc-planner:planner-input')).toBeNull();
  });

  it('clears the planner-input draft from storage when loadSavedPlan is called', () => {
    storage['arc-planner:planner-input'] = JSON.stringify({
      title: 'In progress',
      idea: 'This draft should be cleared when the user loads a saved plan.',
      technicalConstraints: '',
      nfrs: '',
      hints: '',
      contextAttachments: [],
    });

    TestBed.resetTestingModule();
    const store = TestBed.inject(ProjectStore);
    expect(store.pendingInput()).not.toBeNull();



    const targetId = store.savedPlans()[0].id;
    store.loadSavedPlan(targetId);

    expect(store.pendingInput()).toBeNull();
    expect(localStorage.getItem('arc-planner:planner-input')).toBeNull();
  });

  it('clears the planner-input draft from storage when closePlan is called', () => {
    TestBed.resetTestingModule();
    const store = TestBed.inject(ProjectStore);

    store.setPendingInput({
      title: 'Should be wiped',
      idea: 'Close-plan clears the draft so the next session starts fresh.',
      technicalConstraints: '',
      nfrs: '',
      hints: '',
      contextAttachments: [],
    });
    expect(localStorage.getItem('arc-planner:planner-input')).not.toBeNull();

    store.setPlan(store.savedPlans()[0].plan, null);
    store.closePlan();

    expect(store.pendingInput()).toBeNull();
    expect(localStorage.getItem('arc-planner:planner-input')).toBeNull();
  });

  describe('plannerResetTick', () => {
    it('increments plannerResetTick when closePlan is called', () => {
      TestBed.resetTestingModule();
      const store = TestBed.inject(ProjectStore);
      const before = store.plannerResetTick();
      store.closePlan();
      expect(store.plannerResetTick()).toBe(before + 1);
    });

    it('increments plannerResetTick when loadSavedPlan is called', () => {
      TestBed.resetTestingModule();
      const store = TestBed.inject(ProjectStore);
      store.savePlan({
        id: 'reset-tick-load',
        title: 'Reset Tick Load',
        savedAt: '2026-08-28T00:00:00.000Z',
        model: 'openai/gpt-4o-mini',
        tokenStats: null,
        plan: MICROBLOG_DEMO_PLAN,
      });
      const before = store.plannerResetTick();
      store.loadSavedPlan(store.savedPlans()[0].id);
      expect(store.plannerResetTick()).toBe(before + 1);
    });

  });

  it('clears the planner-input draft when setPendingInput(null) is called', () => {
    TestBed.resetTestingModule();
    const store = TestBed.inject(ProjectStore);

    store.setPendingInput({
      title: 'Will be cleared',
      idea: 'Setting to null wipes both the signal and the localStorage entry.',
      technicalConstraints: '',
      nfrs: '',
      hints: '',
      contextAttachments: [],
    });
    expect(localStorage.getItem('arc-planner:planner-input')).not.toBeNull();

    store.setPendingInput(null);

    expect(store.pendingInput()).toBeNull();
    expect(localStorage.getItem('arc-planner:planner-input')).toBeNull();
  });

  describe('localStorage quota handling', () => {
    it('surfaces a persistence error when the plan write exceeds quota', () => {
      const store = TestBed.inject(ProjectStore);

      vi.spyOn(localStorage as unknown as { setItem: (k: string, v: string) => void }, 'setItem')
        .mockImplementation((key: string, _value: string) => {
          if (key === 'arc-planner:plan') {
            const err = new Error('quota');
            (err as unknown as { name: string }).name = 'QuotaExceededError';
            throw err;
          }
          storage[key] = _value;
        });

      store.setPlan(MICROBLOG_DEMO_PLAN, null);
      vi.advanceTimersByTime(250);

      const err = store.error();
      expect(err?.type).toBe('persistence');
      if (err?.type === 'persistence') {
        expect(err.message).toContain('Plan too large');
        expect(err.message).toContain('MB');
        expect(err.bytes).toBeGreaterThan(0);
      }
    });

    it('does not surface a persistence error for non-quota failures', () => {
      const store = TestBed.inject(ProjectStore);

      vi.spyOn(localStorage as unknown as { setItem: (k: string, v: string) => void }, 'setItem')
        .mockImplementation(() => {
          throw new TypeError('security policy blocked write');
        });

      store.setPlan(MICROBLOG_DEMO_PLAN, null);
      vi.advanceTimersByTime(250);

      const err = store.error();
      expect(err?.type).not.toBe('persistence');
    });
  });

  describe('lastSavedPlanRef restoration on hydration', () => {
    it('marks the active plan as saved when a matching SavedPlanEntry exists', () => {
      const generatedAt = '2026-08-22T10:00:00.000Z';
      const userPlan: Plan = {
        ...MICROBLOG_DEMO_PLAN,
        meta: { ...MICROBLOG_DEMO_PLAN.meta, title: 'User Saved Plan', generatedAt },
      };
      storage['arc-planner:plan'] = JSON.stringify({ plan: userPlan, tokenStats: null });
      storage['arc-planner:saved-plans'] = JSON.stringify([
        {
          id: 'user-1',
          title: 'User Saved Plan',
          savedAt: generatedAt,
          model: 'test-model',
          tokenStats: null,
          plan: userPlan,
        },
      ]);

      TestBed.resetTestingModule();
      const store = TestBed.inject(ProjectStore);

      expect(store.plan()).not.toBeNull();
      expect(store.isCurrentPlanSaved()).toBe(true);
      expect(store.lastSavedPlanRef()).toBe(store.plan());
    });

    it('leaves lastSavedPlanRef null when the rehydrated plan is not in savedPlans', () => {
      const generatedAt = '2026-08-22T11:00:00.000Z';
      const unsavedPlan: Plan = {
        ...MICROBLOG_DEMO_PLAN,
        meta: { ...MICROBLOG_DEMO_PLAN.meta, title: 'Unsaved Plan', generatedAt },
      };
      storage['arc-planner:plan'] = JSON.stringify({ plan: unsavedPlan, tokenStats: null });
      storage['arc-planner:saved-plans'] = JSON.stringify([]);

      TestBed.resetTestingModule();
      const store = TestBed.inject(ProjectStore);

      expect(store.plan()).not.toBeNull();
      expect(store.lastSavedPlanRef()).toBeNull();
      expect(store.isCurrentPlanSaved()).toBe(false);
    });

    it('restores the green-state for the demo plan after reload', () => {
      const staleDemo: Plan = {
        ...MICROBLOG_DEMO_PLAN,
        meta: { ...MICROBLOG_DEMO_PLAN.meta, generatedAt: '2026-07-21T00:00:00.000Z' },
      };
      storage['arc-planner:plan'] = JSON.stringify({ plan: staleDemo, tokenStats: null });
      storage['arc-planner:saved-plans'] = JSON.stringify([
        {
          id: 'demo:microblog',
          title: staleDemo.meta.title,
          savedAt: staleDemo.meta.generatedAt,
          model: staleDemo.meta.model,
          tokenStats: null,
          plan: staleDemo,
        },
      ]);

      TestBed.resetTestingModule();
      const store = TestBed.inject(ProjectStore);

      expect(store.plan()).not.toBeNull();
      expect(store.plan()!.meta.generatedAt).toBe(MICROBLOG_DEMO_PLAN.meta.generatedAt);
      expect(store.isCurrentPlanSaved()).toBe(true);
      expect(store.lastSavedPlanRef()).toBe(store.plan());
    });
  });

  describe('diagram audit', () => {
    it('runs the audit and populates diagramAudit after setIsGenerating(false) with a plan in state', async () => {

      const auditSpy = vi.fn().mockResolvedValue({
        generatedAt: '2026-08-25T22:00:00.000Z',
        total: 1,
        passed: 1,
        failed: 0,
        skipped: 0,
        entries: [],
        repaired: 0,
      });
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          {
            provide: DiagramAuditService,
            useValue: { auditPlan: auditSpy },
          },
        ],
      });

      const store = TestBed.inject(ProjectStore);
      store.setPlan(MICROBLOG_DEMO_PLAN, null);

      await Promise.resolve();
      await Promise.resolve();

      const beforeStop = auditSpy.mock.calls.length;
      store.setIsGenerating(false);
      await Promise.resolve();
      await Promise.resolve();

      expect(auditSpy.mock.calls.length).toBeGreaterThan(beforeStop);
      expect(store.diagramAudit()).not.toBeNull();
      expect(store.diagramAudit()?.passed).toBe(1);
    });

    it('runs the audit after hydrateFromLocalStorage on a valid stored plan', async () => {
      const auditSpy = vi.fn().mockResolvedValue({
        generatedAt: '2026-08-25T22:00:00.000Z',
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        entries: [],
        repaired: 0,
      });
      const generatedAt = '2026-08-25T22:00:00.000Z';



      const userPlan: Plan = {
        ...MICROBLOG_DEMO_PLAN,
        meta: { ...MICROBLOG_DEMO_PLAN.meta, title: 'User Plan', generatedAt },
      };
      storage['arc-planner:plan'] = JSON.stringify({ plan: userPlan, tokenStats: null });

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          {
            provide: DiagramAuditService,
            useValue: { auditPlan: auditSpy },
          },
        ],
      });
      const rehydrated = TestBed.inject(ProjectStore);
      await Promise.resolve();
      await Promise.resolve();

      expect(auditSpy).toHaveBeenCalled();
      expect(rehydrated.plan()?.meta.generatedAt).toBe(generatedAt);
      expect(rehydrated.diagramAudit()).not.toBeNull();
    });

    it('does not persist diagramAudit to localStorage', () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          {
            provide: DiagramAuditService,
            useValue: {
              auditPlan: vi.fn().mockResolvedValue({
                generatedAt: '2026-08-25T22:00:00.000Z',
                total: 1,
                passed: 1,
                failed: 0,
                skipped: 0,
                entries: [],
                repaired: 0,
              }),
            },
          },
        ],
      });
      const store = TestBed.inject(ProjectStore);
      store.setPlan(MICROBLOG_DEMO_PLAN, null);
      vi.advanceTimersByTime(300);

      const raw = localStorage.getItem('arc-planner:plan');
      expect(raw).not.toBeNull();
      expect(raw).not.toMatch(/diagramAudit/);
    });

    it('updates only the repaired count when setDiagramAuditRepaired is called', () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          {
            provide: DiagramAuditService,
            useValue: {
              auditPlan: vi.fn().mockResolvedValue({
                generatedAt: '2026-08-25T22:00:00.000Z',
                total: 5,
                passed: 3,
                failed: 2,
                skipped: 0,
                entries: [],
                repaired: 0,
              }),
            },
          },
        ],
      });
      const store = TestBed.inject(ProjectStore);
      store.setPlan(MICROBLOG_DEMO_PLAN, null);

      return Promise.resolve()
        .then(() => Promise.resolve())
        .then(() => {
          expect(store.diagramAudit()?.repaired).toBe(0);
          store.setDiagramAuditRepaired(2);
          expect(store.diagramAudit()?.repaired).toBe(2);
          expect(store.diagramAudit()?.failed).toBe(2);
          expect(store.diagramAudit()?.total).toBe(5);



          store.setDiagramAuditRepaired(-5);
          expect(store.diagramAudit()?.repaired).toBe(0);
        });
    });

    it('setDiagramAuditRepaired is a no-op when no audit report has landed yet', () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          {
            provide: DiagramAuditService,
            useValue: {
              auditPlan: vi.fn().mockResolvedValue({
                generatedAt: '2026-08-25T22:00:00.000Z',
                total: 0,
                passed: 0,
                failed: 0,
                skipped: 0,
                entries: [],
                repaired: 0,
              }),
            },
          },
        ],
      });
      const store = TestBed.inject(ProjectStore);

      store.setDiagramAuditRepaired(7);
      expect(store.diagramAudit()).toBeNull();
    });

    it('clearDiagramAudit resets a seeded report to null and is idempotent', () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          {
            provide: DiagramAuditService,
            useValue: {
              auditPlan: vi.fn().mockResolvedValue({
                generatedAt: '2026-08-25T22:00:00.000Z',
                total: 5,
                passed: 3,
                failed: 2,
                skipped: 0,
                entries: [],
                repaired: 0,
              }),
            },
          },
        ],
      });
      const store = TestBed.inject(ProjectStore);



      store.setPlan(MICROBLOG_DEMO_PLAN, null);
      return Promise.resolve()
        .then(() => Promise.resolve())
        .then(() => {
          expect(store.diagramAudit()).not.toBeNull();

          store.clearDiagramAudit();
          expect(store.diagramAudit()).toBeNull();

          store.clearDiagramAudit();
          expect(store.diagramAudit()).toBeNull();
        });
    });
  });

  describe('edit-aware regenerate state', () => {
    it('starts with hasUserChanges false after setPlan', () => {
      const store = TestBed.inject(ProjectStore);
      store.setPlan(MICROBLOG_DEMO_PLAN, null);
      expect(store.hasUserChanges()).toBe(false);
      expect(store.lastGeneratedPlanRef()).toBe(store.plan());
    });

    it('flips hasUserChanges to true after a markdown override', () => {
      const store = TestBed.inject(ProjectStore);
      store.setPlan(MICROBLOG_DEMO_PLAN, null);
      store.upsertMarkdownOverride('docs/foo.md', '# edited');
      expect(store.hasUserChanges()).toBe(true);
    });

    it('resets regenerate state after completeRegenerate (but markdown overrides remain)', () => {
      const store = TestBed.inject(ProjectStore);
      store.setPlan(MICROBLOG_DEMO_PLAN, null);
      store.upsertMarkdownOverride('docs/foo.md', '# edited');
      expect(store.hasUserChanges()).toBe(true);
      store.completeRegenerate(MICROBLOG_DEMO_PLAN);
      expect(store.lastGeneratedPlanRef()).toBe(store.plan());
      expect(store.regenerateError()).toBeNull();
      expect(store.isRegenerating()).toBe(false);
      expect(store.isGenerating()).toBe(false);

      store.clearMarkdownOverrides();
      expect(store.hasUserChanges()).toBe(false);
    });

    it('sets regenerateError on failRegenerate and clears isRegenerating', () => {
      const store = TestBed.inject(ProjectStore);
      store.startRegenerate();
      expect(store.isRegenerating()).toBe(true);
      expect(store.isGenerating()).toBe(true);
      store.failRegenerate({ type: 'stage_failed', message: 'nope', stage: 'merge' });
      expect(store.regenerateError()?.message).toBe('nope');
      expect(store.isRegenerating()).toBe(false);
      expect(store.isGenerating()).toBe(false);
    });

    it('captureUserEditSummary returns a summary for markdown overrides', () => {
      const store = TestBed.inject(ProjectStore);
      store.setPlan(MICROBLOG_DEMO_PLAN, null);
      store.upsertMarkdownOverride('docs/foo.md', '# edited');
      const summary = store.captureUserEditSummary();
      expect(summary).not.toBeNull();
      expect(summary!.preservedFilePaths).toEqual(['docs/foo.md']);
    });

    it('captureUserEditSummary returns null when current equals baseline', () => {
      const store = TestBed.inject(ProjectStore);
      store.setPlan(MICROBLOG_DEMO_PLAN, null);
      expect(store.captureUserEditSummary()).toBeNull();
    });

    it('snapshotGeneration resets userEditSummary and regenerateError', () => {
      const store = TestBed.inject(ProjectStore);
      store.setPlan(MICROBLOG_DEMO_PLAN, null);
      store.upsertMarkdownOverride('docs/foo.md', '# edited');
      store.failRegenerate({ type: 'stage_failed', message: 'nope', stage: 'merge' });
      store.snapshotGeneration(MICROBLOG_DEMO_PLAN);
      expect(store.userEditSummary()).toBeNull();
      expect(store.regenerateError()).toBeNull();
      expect(store.lastGeneratedPlanRef()).toBe(MICROBLOG_DEMO_PLAN);
    });

    it('setPlan always calls snapshotGeneration (baseline updates on every load)', () => {
      const store = TestBed.inject(ProjectStore);
      const edited: Plan = JSON.parse(JSON.stringify(MICROBLOG_DEMO_PLAN));
      edited.meta = { ...edited.meta, title: 'Edited plan' };
      store.setPlan(edited, null);
      expect(store.lastGeneratedPlanRef()).toBe(edited);
      store.upsertMarkdownOverride('docs/foo.md', '# edited');
      expect(store.hasUserChanges()).toBe(true);
      const reloaded: Plan = JSON.parse(JSON.stringify(MICROBLOG_DEMO_PLAN));
      store.setPlan(reloaded, null);
      expect(store.lastGeneratedPlanRef()).toBe(store.plan());
      store.clearMarkdownOverrides();
      expect(store.hasUserChanges()).toBe(false);
    });

    it('loadSavedPlan restores lastGeneratedPlanRef and lastOriginalInput from entry', () => {
      const store = TestBed.inject(ProjectStore);
      const originalInput = {
        title: 'My App',
        idea: 'An app that does things',
        technicalConstraints: '',
        nfrs: '',
        hints: '',
        contextAttachments: [],
      };
      store.savePlan({
        id: 'restore-input',
        title: 'Restore Input',
        savedAt: '2026-09-01T00:00:00.000Z',
        model: 'test-model',
        tokenStats: null,
        plan: MICROBLOG_DEMO_PLAN,
        lastOriginalInput: originalInput,
      });
      store.loadSavedPlan('restore-input');
      expect(store.lastOriginalInput()).toEqual(originalInput);
      expect(store.lastGeneratedPlanRef()).toBe(store.plan());
    });

    it('clearRegenerateError clears the error', () => {
      const store = TestBed.inject(ProjectStore);
      store.failRegenerate({ type: 'stage_failed', message: 'nope', stage: 'merge' });
      expect(store.regenerateError()).not.toBeNull();
      store.clearRegenerateError();
      expect(store.regenerateError()).toBeNull();
    });
  });

  describe('refinement state', () => {
    const input = {
      title: 'Planner',
      idea: 'A planning workspace for product and engineering teams.',
      technicalConstraints: '',
      nfrs: '',
      hints: '',
      contextAttachments: [],
    };
    const questions = [
      {
        id: 'deployment',
        question: 'Where will it run?',
        type: 'single_choice' as const,
        options: ['Browser', 'Server'],
      },
      {
        id: 'auth',
        question: 'Which identity provider?',
        type: 'free_text' as const,
      },
    ];

    it('auto-advances through each question and completes after the last', () => {
      const store = TestBed.inject(ProjectStore);
      store.startRefinement(input);
      expect(store.refinement.status()).toBe('loading_questions');
      store.setRefinementQuestions(questions);
      expect(store.refinement.status()).toBe('asking');

      store.setRefinementDraft('Browser');
      store.submitRefinementAnswer({ questionId: 'deployment', value: 'Browser', skipped: false });
      expect(store.refinement.status()).toBe('asking');
      expect(store.refinement.currentIndex()).toBe(1);
      expect(store.refinement.answers()).toEqual([
        { questionId: 'deployment', value: 'Browser', skipped: false },
      ]);

      store.submitRefinementAnswer({ questionId: 'auth', value: 'OIDC', skipped: false });
      const terminatorId = store.refinement.questions()[2].id;
      store.submitRefinementAnswer({
        questionId: terminatorId,
        value: 'No, generate the plan with these answers',
        skipped: false,
      });
      expect(store.refinement.status()).toBe('completed');
      expect(store.refinement.draftValue()).toBe('');
    });

    it('records skipped questions and advances to the next question', () => {
      const store = TestBed.inject(ProjectStore);
      store.startRefinement(input);
      store.setRefinementQuestions(questions);
      store.skipRefinementQuestion();
      expect(store.refinement.status()).toBe('asking');
      expect(store.refinement.currentIndex()).toBe(1);
      expect(store.refinement.answers()[0]).toEqual({
        questionId: 'deployment',
        value: '',
        skipped: true,
      });
      store.skipRefinementQuestion();
      expect(store.refinement.status()).toBe('asking');
      store.skipRefinementQuestion();
      expect(store.refinement.status()).toBe('completed');
    });

    it('skips the refinement flow without retaining the draft', () => {
      const store = TestBed.inject(ProjectStore);
      store.startRefinement(input);
      store.setRefinementQuestions(questions);
      store.setRefinementDraft('temporary');
      store.skipRefinement();
      expect(store.refinement.status()).toBe('completed');
      expect(store.refinement.draftValue()).toBe('');
      store.clearRefinement();
      expect(store.refinement.status()).toBe('idle');
      expect(store.refinement.questions()).toEqual([]);
    });

    it('appends the terminating question when LLM returns at least one question', () => {
      const store = TestBed.inject(ProjectStore);
      store.startRefinement(input);
      store.setRefinementQuestions(questions);
      const all = store.refinement.questions();
      expect(all).toHaveLength(questions.length + 1);
      expect(all[all.length - 1].id).toBe('__refine_more__');
      expect(store.refinement.status()).toBe('asking');
    });

    it('does not append the terminating question when LLM returns zero questions', () => {
      const store = TestBed.inject(ProjectStore);
      store.startRefinement(input);
      store.setRefinementQuestions([]);
      expect(store.refinement.questions()).toEqual([]);
      expect(store.refinement.status()).toBe('completed');
    });

    it('submitting the terminating question with "No, generate the plan" completes the flow', () => {
      const store = TestBed.inject(ProjectStore);
      store.startRefinement(input);
      store.setRefinementQuestions(questions);
      store.setRefinementDraft('Browser');
      store.submitRefinementAnswer({ questionId: 'deployment', value: 'Browser', skipped: false });
      store.submitRefinementAnswer({ questionId: 'auth', value: 'OIDC', skipped: false });
      expect(store.refinement.currentIndex()).toBe(2);
      const terminatorId = store.refinement.questions()[2].id;
      expect(terminatorId).toBe('__refine_more__');
      store.submitRefinementAnswer({
        questionId: terminatorId,
        value: 'No, generate the plan with these answers',
        skipped: false,
      });
      expect(store.refinement.status()).toBe('completed');
      expect(store.refinement.roundCount()).toBe(1);
    });

    it('submitting the terminating question with "Yes, ask more" re-enters loading_questions and triggers another set', () => {
      const store = TestBed.inject(ProjectStore);
      store.startRefinement(input);
      store.setRefinementQuestions(questions);
      store.setRefinementDraft('Browser');
      store.submitRefinementAnswer({ questionId: 'deployment', value: 'Browser', skipped: false });
      store.submitRefinementAnswer({ questionId: 'auth', value: 'OIDC', skipped: false });
      const terminatorId = store.refinement.questions()[2].id;
      store.submitRefinementAnswer({
        questionId: terminatorId,
        value: 'Yes, ask more questions',
        skipped: false,
      });
      expect(store.refinement.status()).toBe('loading_questions');
      expect(store.refinement.pendingRefineMore()).toBe(true);
      expect(store.refinement.roundCount()).toBe(1);

      store.setRefinementQuestions([
        {
          id: 'scaling',
          question: 'What scale do you expect?',
          type: 'free_text',
        },
      ]);
      expect(store.refinement.status()).toBe('asking');
      expect(store.refinement.pendingRefineMore()).toBe(false);
      expect(store.refinement.questions()).toHaveLength(2);
      expect(store.refinement.questions()[1].id).toBe('__refine_more__');
    });

    it('skipping the terminating question completes the flow', () => {
      const store = TestBed.inject(ProjectStore);
      store.startRefinement(input);
      store.setRefinementQuestions(questions);
      store.setRefinementDraft('Browser');
      store.submitRefinementAnswer({ questionId: 'deployment', value: 'Browser', skipped: false });
      store.skipRefinementQuestion();
      store.skipRefinementQuestion();
      expect(store.refinement.status()).toBe('completed');
      expect(store.refinement.roundCount()).toBe(1);
    });

    it('respects REFINE_MORE_MAX_ROUNDS: stops appending the terminator after the cap', () => {
      const store = TestBed.inject(ProjectStore);
      store.startRefinement(input);
      const single = [questions[0]];
      for (let i = 0; i < 3; i++) {
        store.setRefinementQuestions(single);
        expect(store.refinement.questions()).toHaveLength(2);
        const terminatorId = store.refinement.questions()[1].id;
        store.submitRefinementAnswer({ questionId: 'deployment', value: 'Browser', skipped: false });
        store.submitRefinementAnswer({
          questionId: terminatorId,
          value: 'Yes, ask more questions',
          skipped: false,
        });
      }
      expect(store.refinement.roundCount()).toBe(3);

      store.setRefinementQuestions(single);
      expect(store.refinement.questions()).toHaveLength(1);
      expect(store.refinement.questions()[0].id).toBe('deployment');
    });

    it('surfaces question-generation failures via setRefinementError without completing the refinement', () => {
      const store = TestBed.inject(ProjectStore);
      store.startRefinement(input);
      store.setRefinementQuestions(questions);
      store.setRefinementDraft('Browser');
      store.submitRefinementAnswer({ questionId: 'deployment', value: 'Browser', skipped: false });

      store.setRefinementError('401 Missing Authentication header');

      expect(store.refinement.status()).toBe('error');
      expect(store.refinement.error()).toBe('401 Missing Authentication header');
      expect(store.refinement.questions()).toEqual([]);
      expect(store.refinement.answers()).toEqual([]);
      expect(store.refinement.originalInput()).toEqual(input);
    });

    it('clearRefinement resets an error status back to idle', () => {
      const store = TestBed.inject(ProjectStore);
      store.startRefinement(input);
      store.setRefinementError('boom');
      expect(store.refinement.status()).toBe('error');

      store.clearRefinement();

      expect(store.refinement.status()).toBe('idle');
      expect(store.refinement.error()).toBeNull();
    });
  });

  describe('setPlan persist flag', () => {
    it('does not write to localStorage when called with persist: false', () => {
      const store = TestBed.inject(ProjectStore);
      const edited: Plan = JSON.parse(JSON.stringify(MICROBLOG_DEMO_PLAN));
      edited.meta = { ...edited.meta, title: 'Persisted test' };
      store.setPlan(edited, null, false);
      expect(store.plan()?.meta.title).toBe('Persisted test');
      expect(localStorage.getItem('arc-planner:plan')).toBeNull();
    });

    it('still writes to localStorage by default', () => {
      const store = TestBed.inject(ProjectStore);
      const edited: Plan = JSON.parse(JSON.stringify(MICROBLOG_DEMO_PLAN));
      edited.meta = { ...edited.meta, title: 'Default persists' };
      store.setPlan(edited, null);
      vi.advanceTimersByTime(250);
      expect(localStorage.getItem('arc-planner:plan')).not.toBeNull();
    });
  });

  describe('refinement chat', () => {
    beforeEach(() => {
      const store = TestBed.inject(ProjectStore);
      const baseline: Plan = JSON.parse(JSON.stringify(MICROBLOG_DEMO_PLAN));
      baseline.refinementChats = [];
      store.setPlan(baseline, null);
      vi.advanceTimersByTime(250);
    });

    it('creates a session, appends turns, finalizes with questions, and applies', () => {
      const store = TestBed.inject(ProjectStore);
      const session = store.startRefinementChat();
      expect(session.turns).toEqual([]);
      expect(store.refinementChat().activeSessionId).toBe(session.id);

      store.setRefinementChatDraft('Refactor auth');
      store.appendRefinementChatTurn(session.id, {
        role: 'user',
        text: 'Refactor auth',
        at: '2026-09-08T00:00:00.000Z',
      });
      store.setRefinementChatDraft('');

      const question = {
        id: 'auth',
        question: 'Which identity provider?',
        type: 'single_choice' as const,
        options: ['Auth0', 'Keycloak'],
      };
      store.setRefinementChatQuestions(session.id, [question]);
      expect(store.plan()?.refinementChats[0]?.pendingQuestions?.[0]?.id).toBe('auth');

      store.setRefinementChatAnswer(session.id, question.id, 'Keycloak');
      store.submitRefinementChatAnswers(session.id, 'Use Keycloak');
      const updated = store.plan()?.refinementChats[0];
      expect(updated?.status).toBe('ready');
       expect(updated?.finalInstruction).toBe('Use Keycloak');
       expect(updated?.collectedAnswers).toEqual([
         {
           questionId: 'auth',
           question: 'Which identity provider?',
           value: 'Keycloak',
           skipped: false,
         },
       ]);
       expect(updated?.pendingQuestions).toBeUndefined();
    });

    it('persists refinement chats through the plan storage key', () => {
      const store = TestBed.inject(ProjectStore);
      store.startRefinementChat();
      vi.advanceTimersByTime(250);
      const raw = localStorage.getItem('arc-planner:plan');
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw ?? '{}');
      expect(parsed.plan.refinementChats).toHaveLength(1);
    });

    it('hydrates plans without a refinementChats field as empty', () => {
      const baseline: Plan = JSON.parse(JSON.stringify(MICROBLOG_DEMO_PLAN));
      delete (baseline as { refinementChats?: unknown }).refinementChats;
      localStorage.setItem(
        'arc-planner:plan',
        JSON.stringify({ plan: baseline, tokenStats: null }),
      );
      TestBed.resetTestingModule();
      const store = TestBed.inject(ProjectStore);
      expect(store.plan()?.refinementChats).toEqual([]);
    });

    it('cancels an empty session without leaving behind a ghost session', () => {
      const store = TestBed.inject(ProjectStore);
      const session = store.startRefinementChat();
      store.cancelRefinementChat(session.id);
      expect(store.plan()?.refinementChats ?? []).toHaveLength(0);
      expect(store.refinementChat().activeSessionId).toBeNull();
    });

    it('marks a finalized session as applied with the new plan timestamp', () => {
      const store = TestBed.inject(ProjectStore);
      const session = store.startRefinementChat();
      store.appendRefinementChatTurn(session.id, {
        role: 'user',
        text: 'Refactor',
        at: '2026-09-08T00:00:00.000Z',
      });
      store.submitRefinementChatAnswers(session.id, 'Apply X');
      store.markRefinementChatApplied(session.id, '2026-09-08T01:00:00.000Z');
      const updated = store.plan()?.refinementChats[0];
      expect(updated?.status).toBe('applied');
      expect(updated?.appliedPlanGeneratedAt).toBe('2026-09-08T01:00:00.000Z');
    });
  });
});
