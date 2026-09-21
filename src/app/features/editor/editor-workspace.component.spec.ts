import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter, Router, NavigationEnd, NavigationStart } from '@angular/router';
import { vi } from 'vitest';
import { ProjectStore, defaultProviderConfigs } from '../../core/project.store';
import { Plan } from '../../core/plan.schema';
import { minimalPlanFixture } from '../../testing/fixtures';
import { EditorWorkspaceComponent } from './editor-workspace.component';
import { PlanReviewComponent } from '../planner/plan-review.component';
import { PlannerGraphService } from '../../core/planner-graph.service';
import { LLM_FACTORY } from '../../core/llm-provider';
import { RunStreamHost } from '../../core/streaming/run-stream-host.service';
import { GenerationAbortService } from '../../core/generation-abort.service';

@Component({
  selector: 'app-plan-review',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div data-testid="plan-review-stub"></div>`,
})
class PlanReviewStub {}

describe('EditorWorkspaceComponent', () => {
  function setup(
    plan: Plan | null = minimalPlanFixture,
    hasPendingInput = true,
    seed: { lastSavedPlanRef?: Plan | null; savedPlans?: Array<{ plan: Plan }> } = {},
    extraProviders: Array<unknown> = [],
  ) {
    const planSig = signal<Plan | null>(plan);
    const hasPlan = () => !!planSig();
    const overridesSig = signal<Record<string, string>>({});
    const providerConfigs = {
      ...defaultProviderConfigs(),
      openrouter: {
        ...defaultProviderConfigs().openrouter,
        selectedModel: 'openai/gpt-4o-mini',
      },
    };
    const configSig = signal({
      provider: 'openrouter' as const,
      providerConfigs,
    });
    const apiKeySig = signal('sk-test');
    const pendingInputSig = signal(
      hasPendingInput
        ? {
            title: 'Planner App',
            idea: 'Test idea',
            technicalConstraints: '',
            nfrs: '',
            hints: '',
          }
        : null,
    );
    const isGeneratingSig = signal(false);

    const savedPlansSig = signal<Array<{ plan: Plan }>>(seed.savedPlans ?? []);
    const lastSavedPlanRefSig = signal<Plan | null>(seed.lastSavedPlanRef ?? null);
    const isRegeneratingSig = signal(false);
    const regenerateErrorSig = signal<unknown>(null);
    const userEditSummarySig = signal<unknown>(null);
    const lastOriginalInputSig = signal<unknown>(null);

    const savePlan = vi.fn((entry: { plan: Plan }) => {



      lastSavedPlanRefSig.set(entry.plan);
      savedPlansSig.set([entry, ...savedPlansSig()]);
    });

    const isCurrentPlanSaved = () => {
      const current = planSig();
      if (!current) return false;
      if (current !== lastSavedPlanRefSig()) return false;
      return Object.keys(overridesSig()).length === 0;
    };

    const hasUserChanges = () => {
      const current = planSig();
      if (!current) return false;
      if (current !== lastSavedPlanRefSig()) return false;
      return Object.keys(overridesSig()).length > 0;
    };

    const store = {
      plan: planSig,
      hasPlan,
      isGenerating: isGeneratingSig,
      markdownOverrides: overridesSig,
      savePlan,
      pendingInput: pendingInputSig,
      tokenStats: signal(null),
      config: configSig,
      apiKey: apiKeySig,
      savedPlans: savedPlansSig,
      lastSavedPlanRef: lastSavedPlanRefSig,
      isCurrentPlanSaved,
      hasUserChanges,
      isRegenerating: isRegeneratingSig,
      regenerateError: regenerateErrorSig,
      userEditSummary: userEditSummarySig,
      lastOriginalInput: lastOriginalInputSig,
      captureUserEditSummary: vi.fn(() => null),
      setLastOriginalInput: vi.fn(),
      mergeTechnologyOverride: vi.fn(),
      clearRegenerateError: vi.fn(),
      startRegenerate: vi.fn(),
      completeRegenerate: vi.fn(),
      failRegenerate: vi.fn((err: unknown) => { regenerateErrorSig.set(err); }),
      setError: vi.fn(),
      setStreamBuffer: vi.fn(),
      appendStream: vi.fn(),
      setIsGenerating: vi.fn(),
      setTokenStats: vi.fn(),
      setPlan: vi.fn(),
      streamBuffer: signal(''),
      clearActivities: vi.fn(),
      clearDiagramAudit: vi.fn(),
      setLastAuditFindings: vi.fn(),
      snapshotGeneration: vi.fn(),
      clearAllRefinementChats: vi.fn(),
    };

    TestBed.configureTestingModule({
      imports: [EditorWorkspaceComponent],
      providers: [
        { provide: ProjectStore, useValue: store },



        provideRouter([
          { path: 'planner', children: [] },
          { path: 'editor', children: [] },
        ]),
        ...extraProviders,
      ],
    });

    TestBed.overrideComponent(EditorWorkspaceComponent, {
      remove: { imports: [PlanReviewComponent] },
      add: { imports: [PlanReviewStub] },
    });

    const fixture = TestBed.createComponent(EditorWorkspaceComponent);
    fixture.detectChanges();

    return {
      fixture,
      store,
      savePlan,
      overridesSig,
      savedPlansSig,
      lastSavedPlanRefSig,
    };
  }

  function buttonLabels(root: HTMLElement): string[] {
    return Array.from(root.querySelectorAll('p-button .p-button-label'))
      .map((el) => el.textContent?.trim() ?? '')
      .filter((label) => label.length > 0);
  }

  it('does not render the Export pane in the editor when a plan exists', () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('.export-pane')).toBeNull();

    const labels = buttonLabels(root);
    expect(labels).not.toContain('Download ZIP');
    expect(labels).not.toContain('Export JSON');
    expect(labels).not.toContain('Export PDF');

    const headerButtons = Array.from(
      root.querySelectorAll('.workspace-header p-button .p-button-label'),
    ).map((el) => el.textContent?.trim() ?? '');

    expect(headerButtons).not.toContain('Download ZIP');
    expect(headerButtons).not.toContain('Export JSON');
    expect(headerButtons).not.toContain('Export PDF');
    expect(headerButtons).toContain('Save Plan');
    expect(headerButtons).toContain('Regenerate');
  });

  it('renders the Save Plan button in unsaved state by default (secondary severity, "Save Plan" label)', () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;
    const saveButton = Array.from(
      root.querySelectorAll('.workspace-toolbar p-button'),
    ).find((el) => (el.textContent ?? '').includes('Save Plan'));
    expect(saveButton).toBeDefined();

    const saveInner = saveButton!.querySelector('button') as HTMLButtonElement | null;
    expect(saveInner).not.toBeNull();
    expect(saveInner!.className).toContain('p-button-secondary');
    expect(saveInner!.className).not.toContain('p-button-success');
  });

  it('switches the Save Plan button to saved state (success severity, "Saved" label) after the user clicks save', async () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;
    const buttonEl = Array.from(
      root.querySelectorAll('.workspace-toolbar p-button'),
    ).find((el) => (el.textContent ?? '').includes('Save Plan')) as HTMLElement | undefined;
    expect(buttonEl).toBeDefined();
    const inner = buttonEl!.querySelector('button') as HTMLButtonElement | null;
    inner!.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const savedButton = Array.from(
      root.querySelectorAll('.workspace-toolbar p-button'),
    ).find((el) => (el.textContent ?? '').includes('Saved'));
    expect(savedButton).toBeDefined();

    const savedInner = savedButton!.querySelector('button') as HTMLButtonElement | null;
    expect(savedInner).not.toBeNull();
    expect(savedInner!.className).toContain('p-button-success');
    expect(savedInner!.className).not.toContain('p-button-secondary');
  });

  it('flips the Save Plan button back to unsaved when the plan reference changes (post-edit)', async () => {
    const { fixture, store } = setup();
    const root = fixture.nativeElement as HTMLElement;

    const initialButton = Array.from(
      root.querySelectorAll('.workspace-toolbar p-button'),
    ).find((el) => (el.textContent ?? '').includes('Save Plan')) as HTMLElement | undefined;
    (initialButton!.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect((root.textContent ?? '')).toContain('Saved');

    store.plan.set({ ...store.plan()! });
    fixture.detectChanges();
    await fixture.whenStable();

    expect((root.textContent ?? '')).not.toContain('Saved');
    expect((root.textContent ?? '')).toContain('Save Plan');
  });

  it('renders the Save Plan button in saved state when a saved plan is loaded (no user interaction)', () => {





    const plan = minimalPlanFixture;
    const { fixture } = setup(plan, false, {
      lastSavedPlanRef: plan,
      savedPlans: [{ plan }],
    });
    const root = fixture.nativeElement as HTMLElement;
    const savedButton = Array.from(
      root.querySelectorAll('.workspace-toolbar p-button'),
    ).find((el) => (el.textContent ?? '').includes('Saved')) as HTMLElement | undefined;
    expect(savedButton).toBeDefined();
    const inner = savedButton!.querySelector('button') as HTMLButtonElement | null;
    expect(inner).not.toBeNull();
    expect(inner!.className).toContain('p-button-success');
    expect(inner!.className).not.toContain('p-button-secondary');
  });

  it('flips the Save Plan button to unsaved when a markdown override is added after a save', async () => {
    const { fixture, overridesSig, savePlan } = setup();
    const root = fixture.nativeElement as HTMLElement;

    const initialButton = Array.from(
      root.querySelectorAll('.workspace-toolbar p-button'),
    ).find((el) => (el.textContent ?? '').includes('Save Plan')) as HTMLElement | undefined;
    (initialButton!.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(savePlan).toHaveBeenCalledTimes(1);
    expect((root.textContent ?? '')).toContain('Saved');



    overridesSig.set({ 'docs/10-architecture/frontend-architecture.md': 'edited content' });
    fixture.detectChanges();
    await fixture.whenStable();

    expect((root.textContent ?? '')).not.toContain('Saved');
    expect((root.textContent ?? '')).toContain('Save Plan');
  });

  it('does not render the Export pane when no plan exists', () => {
    const { fixture } = setup(null);
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('.export-pane')).toBeNull();
    expect(root.querySelector('.editor-shell')).toBeNull();
    expect(root.querySelector('p-message')).not.toBeNull();

    const headerButtons = Array.from(
      root.querySelectorAll('.workspace-header p-button .p-button-label'),
    ).map((el) => el.textContent?.trim() ?? '');
    expect(headerButtons).not.toContain('Download ZIP');
    expect(headerButtons).not.toContain('Export JSON');
    expect(headerButtons).not.toContain('Export PDF');
  });

  it('startRegenerate merges plan.meta.technologyHints into lastOriginalInput.hints', async () => {
    const plan = minimalPlanFixture;
    const { fixture, store, overridesSig, lastSavedPlanRefSig } = setup(plan, true);
    overridesSig.set({ 'docs/10-architecture/backend-architecture.md': 'edited' });
    const planWithHints: Plan = {
      ...plan,
      meta: { ...plan.meta, technologyHints: 'team prefers TypeORM' },
    };
    store.plan.set(planWithHints);
    lastSavedPlanRefSig.set(planWithHints);
    store.lastOriginalInput.set(null);
    (store.captureUserEditSummary as ReturnType<typeof vi.fn>).mockReturnValue({
      capturedAt: new Date().toISOString(),
      preservedFilePaths: [],
      addedElements: [],
      removedElements: [],
      fieldChanges: [],
      naturalLanguageDigest: 'mock summary',
    });
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const regenButton = Array.from(root.querySelectorAll('.workspace-toolbar p-button'))
      .find((el) => (el.textContent ?? '').includes('Regenerate')) as HTMLElement | undefined;
    expect(regenButton).toBeDefined();
    const inner = regenButton!.querySelector('button') as HTMLButtonElement | null;
    expect(inner).not.toBeNull();
    expect(inner!.disabled).toBe(false);
    inner!.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(store.setLastOriginalInput).toHaveBeenCalled();
    const lastCall = (store.setLastOriginalInput as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(lastCall?.[0]?.hints).toBe('team prefers TypeORM');
  });

  it('navigates to /planner to surface live stats, then back to /editor after a successful regenerate', async () => {
    const plan = minimalPlanFixture;
    const { fixture, store, overridesSig, lastSavedPlanRefSig } = setup(plan, true, {}, [
      {
        provide: PlannerGraphService,
        useValue: {
          regenerateSectioned: vi.fn(async () => ({
            plan: { ...plan, meta: { ...plan.meta, summary: 'regenerated' } },
            structuralAdjustments: 0,
            partialFailures: 0,
          })),
        },
      },
      { provide: LLM_FACTORY, useValue: () => ({ invoke: async () => ({ text: '{}' }) }) },
      {
        provide: RunStreamHost,
        useValue: {
          startRun: vi.fn(),
          markRunFinished: vi.fn(),
          createWrappedInvoker: () => async () => ({ text: '{}' }),
        },
      },
      { provide: GenerationAbortService, useValue: { setActive: vi.fn() } },
    ]);
    overridesSig.set({ 'docs/10-architecture/backend-architecture.md': 'edited' });
    lastSavedPlanRefSig.set(plan);
    (store.captureUserEditSummary as ReturnType<typeof vi.fn>).mockReturnValue({
      capturedAt: new Date().toISOString(),
      preservedFilePaths: [],
      addedElements: [],
      removedElements: [],
      fieldChanges: [],
      naturalLanguageDigest: 'mock summary',
    });
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const regenButton = Array.from(root.querySelectorAll('.workspace-toolbar p-button'))
      .find((el) => (el.textContent ?? '').includes('Regenerate')) as HTMLElement | undefined;
    expect(regenButton).toBeDefined();
    const inner = regenButton!.querySelector('button') as HTMLButtonElement | null;
    expect(inner).not.toBeNull();

    const router = TestBed.inject(Router);
    const visitedUrls: string[] = [];
    const subscription = router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        visitedUrls.push(event.url);
      } else if (event instanceof NavigationEnd) {
        visitedUrls.push(event.urlAfterRedirects);
      }
    });

    inner!.click();
    fixture.detectChanges();
    await fixture.whenStable();

    subscription.unsubscribe();

    expect(visitedUrls).toContain('/planner');
    expect(router.url).toBe('/editor');
    expect(store.isGenerating()).toBe(false);
  });

  it('surfaces the regenerate error and preserves the refinement chat when regeneration produces no usable output', async () => {
    const plan = minimalPlanFixture;
    const chatPlan: Plan = {
      ...plan,
      refinementChats: [
        {
          id: 's1',
          createdAt: '2026-09-10T00:00:00.000Z',
          status: 'ready',
          turns: [{ role: 'user', text: 'Add LiveBlogStream', at: '2026-09-10T00:00:01.000Z' }],
          finalInstruction: 'Add a LiveBlogStream component to the core domain.',
        },
      ],
    };
    const { fixture, store } = setup(chatPlan, false, {}, [
      {
        provide: PlannerGraphService,
        useValue: {
          regenerateSectioned: vi.fn(async () => {
            throw {
              type: 'stage_failed',
              stage: 'merge',
              message: 'Regeneration did not produce any usable output for any of 5 sections; the chat transcript likely exceeded the model\'s context window. Try a shorter refinement instruction or clear the chat before regenerating.',
            };
          }),
        },
      },
      { provide: LLM_FACTORY, useValue: () => ({ invoke: async () => ({ text: 'not-json' }) }) },
      {
        provide: RunStreamHost,
        useValue: {
          startRun: vi.fn(),
          markRunFinished: vi.fn(),
          createWrappedInvoker: () => async () => ({ text: 'not-json' }),
        },
      },
      { provide: GenerationAbortService, useValue: { setActive: vi.fn() } },
    ]);
    store.plan.set(chatPlan);
    (store.captureUserEditSummary as ReturnType<typeof vi.fn>).mockReturnValue(null);
    fixture.detectChanges();
    await fixture.whenStable();

    const regenButton = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.workspace-toolbar p-button'),
    ).find((el) => (el.textContent ?? '').includes('Regenerate')) as HTMLElement | undefined;
    (regenButton!.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(store.setPlan).not.toHaveBeenCalled();
    expect(store.clearAllRefinementChats).not.toHaveBeenCalled();
    expect(store.failRegenerate).toHaveBeenCalled();
    const persistedChat = store.plan()?.refinementChats ?? [];
    expect(persistedChat.length).toBe(1);
    expect((fixture.nativeElement as HTMLElement).querySelector('.regenerate-error')).not.toBeNull();
  });

  it('clears the diagram audit on Regenerate so past failed/repaired counts do not leak into the live stats panel', async () => {
    const plan = minimalPlanFixture;
    const { fixture, store, overridesSig, lastSavedPlanRefSig } = setup(plan, true);
    overridesSig.set({ 'docs/10-architecture/backend-architecture.md': 'edited' });
    lastSavedPlanRefSig.set(plan);
    (store.captureUserEditSummary as ReturnType<typeof vi.fn>).mockReturnValue({
      capturedAt: new Date().toISOString(),
      preservedFilePaths: [],
      addedElements: [],
      removedElements: [],
      fieldChanges: [],
      naturalLanguageDigest: 'mock summary',
    });
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const regenButton = Array.from(root.querySelectorAll('.workspace-toolbar p-button'))
      .find((el) => (el.textContent ?? '').includes('Regenerate')) as HTMLElement | undefined;
    const inner = regenButton!.querySelector('button') as HTMLButtonElement | null;
    inner!.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(store.clearDiagramAudit).toHaveBeenCalled();
  });

  it('forwards the full refinement chat transcript into regenerateSectioned across multiple sessions', async () => {
    const basePlan = minimalPlanFixture;
    const chatPlan: Plan = {
      ...basePlan,
      refinementChats: [
        {
          id: 's1',
          createdAt: '2026-09-10T00:00:00.000Z',
          status: 'ready',
          turns: [
            { role: 'user', text: 'Add admin panel', at: '2026-09-10T00:00:01.000Z' },
            {
              role: 'assistant',
              kind: 'questions',
              questions: [
                { id: 'q1', question: 'Where?', type: 'single_choice', options: ['frontend', 'backend'] },
              ],
              at: '2026-09-10T00:00:02.000Z',
            },
            {
              role: 'assistant',
              kind: 'finalized',
              instruction: 'Add admin panel with role-based auth',
              at: '2026-09-10T00:00:03.000Z',
            },
          ],
          finalInstruction: 'Add admin panel with role-based auth',
          collectedAnswers: [
            { questionId: 'q1', question: 'Where?', value: 'frontend', skipped: false },
          ],
        },
        {
          id: 's2',
          createdAt: '2026-09-10T01:00:00.000Z',
          status: 'ready',
          turns: [
            { role: 'user', text: 'Also include audit log', at: '2026-09-10T01:00:01.000Z' },
            { role: 'assistant', kind: 'message', text: 'Got it', at: '2026-09-10T01:00:02.000Z' },
            {
              role: 'assistant',
              kind: 'finalized',
              instruction: 'Add audit log to admin panel',
              at: '2026-09-10T01:00:03.000Z',
            },
          ],
          finalInstruction: 'Add audit log to admin panel',
          collectedAnswers: [],
        },
      ],
    };

    const regenerateSectioned = vi.fn(async () => ({
      plan: chatPlan,
      structuralAdjustments: 0,
      partialFailures: 0,
    }));

    const { fixture, store } = setup(chatPlan, false, {}, [
      { provide: PlannerGraphService, useValue: { regenerateSectioned } },
      { provide: LLM_FACTORY, useValue: () => ({ invoke: async () => ({ text: '{}' }) }) },
      {
        provide: RunStreamHost,
        useValue: {
          startRun: vi.fn(),
          markRunFinished: vi.fn(),
          createWrappedInvoker: () => async () => ({ text: '{}' }),
        },
      },
      { provide: GenerationAbortService, useValue: { setActive: vi.fn() } },
    ]);

    store.plan.set(chatPlan);
    (store.captureUserEditSummary as ReturnType<typeof vi.fn>).mockReturnValue(null);
    fixture.detectChanges();
    await fixture.whenStable();

    const regenButton = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.workspace-toolbar p-button'),
    ).find((el) => (el.textContent ?? '').includes('Regenerate')) as HTMLElement | undefined;
    expect(regenButton).toBeDefined();
    (regenButton!.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(regenerateSectioned).toHaveBeenCalledTimes(1);
    const arg = (regenerateSectioned.mock.calls[0] as unknown as [{ refinementInstruction: { instruction: string; chatTranscript: { role: string; text: string }[]; userPrompt?: string; answers: { questionId: string; value: string }[] } }])[0];
    expect(arg.refinementInstruction).toBeDefined();
    expect(arg.refinementInstruction.chatTranscript).toBeDefined();
    expect(arg.refinementInstruction.chatTranscript.length).toBe(4);
    expect(arg.refinementInstruction.instruction).toContain('admin panel');
    expect(arg.refinementInstruction.instruction).toContain('audit log');
    expect(arg.refinementInstruction.userPrompt).toBe('Also include audit log');
    expect(arg.refinementInstruction.answers.find((a: { questionId: string }) => a.questionId === 'q1')).toBeDefined();
  });

  it('forwards the finalInstruction of an awaiting_answers refinement session to regenerateSectioned', async () => {
    const basePlan = minimalPlanFixture;
    const chatPlan: Plan = {
      ...basePlan,
      refinementChats: [
        {
          id: 's-awaiting',
          createdAt: '2026-09-10T00:00:00.000Z',
          status: 'awaiting_answers',
          turns: [
            { role: 'user', text: 'Add notifications', at: '2026-09-10T00:00:01.000Z' },
            {
              role: 'assistant',
              kind: 'questions',
              questions: [
                { id: 'q1', question: 'Channel?', type: 'single_choice', options: ['email', 'sms'] },
              ],
              at: '2026-09-10T00:00:02.000Z',
            },
          ],
          finalInstruction: 'Add email + sms notifications to core domain',
          collectedAnswers: [
            { questionId: 'q1', question: 'Channel?', value: 'email', skipped: false },
          ],
        },
      ],
    };

    const regenerateSectioned = vi.fn(async () => ({
      plan: chatPlan,
      structuralAdjustments: 0,
      partialFailures: 0,
    }));

    const { fixture, store } = setup(chatPlan, false, {}, [
      { provide: PlannerGraphService, useValue: { regenerateSectioned } },
      { provide: LLM_FACTORY, useValue: () => ({ invoke: async () => ({ text: '{}' }) }) },
      {
        provide: RunStreamHost,
        useValue: {
          startRun: vi.fn(),
          markRunFinished: vi.fn(),
          createWrappedInvoker: () => async () => ({ text: '{}' }),
        },
      },
      { provide: GenerationAbortService, useValue: { setActive: vi.fn() } },
    ]);

    store.plan.set(chatPlan);
    (store.captureUserEditSummary as ReturnType<typeof vi.fn>).mockReturnValue(null);
    fixture.detectChanges();
    await fixture.whenStable();

    const regenButton = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.workspace-toolbar p-button'),
    ).find((el) => (el.textContent ?? '').includes('Regenerate')) as HTMLElement | undefined;
    expect(regenButton).toBeDefined();
    (regenButton!.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(regenerateSectioned).toHaveBeenCalledTimes(1);
    const arg = (regenerateSectioned.mock.calls[0] as unknown as [{ refinementInstruction: { instruction: string; answers: { questionId: string; value: string }[] } }])[0];
    expect(arg.refinementInstruction).toBeDefined();
    expect(arg.refinementInstruction.instruction).toContain('email + sms notifications');
    const answer = arg.refinementInstruction.answers.find((a) => a.questionId === 'q1');
    expect(answer).toBeDefined();
    expect(answer?.value).toBe('email');
  });

  it('clears refinement chats after a successful Regenerate and leaves plan.refinementChats empty', async () => {
    const basePlan = minimalPlanFixture;
    const chatPlan: Plan = {
      ...basePlan,
      refinementChats: [
        {
          id: 's1',
          createdAt: '2026-09-10T00:00:00.000Z',
          status: 'ready',
          turns: [{ role: 'user', text: 'Add admin', at: '2026-09-10T00:00:01.000Z' }],
          finalInstruction: 'Add admin',
        },
      ],
    };

    const regenerateSectioned = vi.fn(async () => ({
      plan: { ...chatPlan, meta: { ...chatPlan.meta, summary: 'regenerated' } },
      structuralAdjustments: 0,
      partialFailures: 0,
    }));

    const { fixture, store } = setup(chatPlan, false, {}, [
      { provide: PlannerGraphService, useValue: { regenerateSectioned } },
      { provide: LLM_FACTORY, useValue: () => ({ invoke: async () => ({ text: '{}' }) }) },
      {
        provide: RunStreamHost,
        useValue: {
          startRun: vi.fn(),
          markRunFinished: vi.fn(),
          createWrappedInvoker: () => async () => ({ text: '{}' }),
        },
      },
      { provide: GenerationAbortService, useValue: { setActive: vi.fn() } },
    ]);

    store.plan.set(chatPlan);
    (store.captureUserEditSummary as ReturnType<typeof vi.fn>).mockReturnValue(null);
    fixture.detectChanges();
    await fixture.whenStable();

    const regenButton = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.workspace-toolbar p-button'),
    ).find((el) => (el.textContent ?? '').includes('Regenerate')) as HTMLElement | undefined;
    (regenButton!.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(regenerateSectioned).toHaveBeenCalledTimes(1);
    expect(store.setPlan).toHaveBeenCalled();
    expect(store.clearAllRefinementChats).toHaveBeenCalledTimes(1);
    const router = TestBed.inject(Router);
    expect(router.url).toBe('/editor');
  });

  it('forwards "add a banking domain" refinement and propagates the resulting plan with the new domain', async () => {
    const basePlan = minimalPlanFixture;
    const chatPlan: Plan = {
      ...basePlan,
      refinementChats: [
        {
          id: 's-banking',
          createdAt: '2026-09-10T00:00:00.000Z',
          status: 'ready',
          turns: [
            {
              role: 'user',
              text: 'Please add a banking domain so we can model payments.',
              at: '2026-09-10T00:00:01.000Z',
            },
            {
              role: 'assistant',
              kind: 'finalized',
              instruction: 'Add a banking domain',
              at: '2026-09-10T00:00:02.000Z',
            },
          ],
          finalInstruction: 'Add a banking domain',
          collectedAnswers: [],
        },
      ],
    };
    const bankingDomain = {
      id: 'banking',
      name: 'Banking',
      description: 'Banking domain for payments and accounts.',
      layer: minimalPlanFixture.domains[0]!.layer,
      responsibilities: ['Process payments'],
      aggregates: [],
      domainEvents: [],
      directoryPath: 'src/app/banking',
      components: minimalPlanFixture.domains[0]!.components,
    };
    const regeneratedPlan: Plan = {
      ...chatPlan,
      domains: [...minimalPlanFixture.domains, bankingDomain],
    };
    const regenerateSectioned = vi.fn(async () => ({
      plan: regeneratedPlan,
      structuralAdjustments: 1,
      partialFailures: 0,
    }));

    const { fixture, store } = setup(chatPlan, false, {}, [
      { provide: PlannerGraphService, useValue: { regenerateSectioned } },
      { provide: LLM_FACTORY, useValue: () => ({ invoke: async () => ({ text: '{}' }) }) },
      {
        provide: RunStreamHost,
        useValue: {
          startRun: vi.fn(),
          markRunFinished: vi.fn(),
          createWrappedInvoker: () => async () => ({ text: '{}' }),
        },
      },
      { provide: GenerationAbortService, useValue: { setActive: vi.fn() } },
    ]);

    store.plan.set(chatPlan);
    (store.captureUserEditSummary as ReturnType<typeof vi.fn>).mockReturnValue(null);
    fixture.detectChanges();
    await fixture.whenStable();

    const regenButton = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.workspace-toolbar p-button'),
    ).find((el) => (el.textContent ?? '').includes('Regenerate')) as HTMLElement | undefined;
    expect(regenButton).toBeDefined();
    (regenButton!.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(regenerateSectioned).toHaveBeenCalledTimes(1);
    const arg = (regenerateSectioned.mock.calls[0] as unknown as [{ refinementInstruction: { instruction: string; chatTranscript?: unknown[] } }])[0];
    expect(arg.refinementInstruction).toBeDefined();
    expect(arg.refinementInstruction.instruction).toContain('Add a banking domain');

    const setPlanCalls = (store.setPlan as ReturnType<typeof vi.fn>).mock.calls;
    expect(setPlanCalls.length).toBeGreaterThan(0);
    const lastSetPlan = setPlanCalls.at(-1)?.[0] as Plan | undefined;
    expect(lastSetPlan).toBeDefined();
    const domainIds = (lastSetPlan?.domains ?? []).map((d) => d.id);
    expect(domainIds).toContain('banking');
    expect(domainIds).toContain('core-planning');
  });

  it('forwards the original user prompt (not the synthetic "My answers:" summary turn) as userPrompt when the user skipped all clarifying questions', async () => {
    const basePlan = minimalPlanFixture;
    const chatPlan: Plan = {
      ...basePlan,
      refinementChats: [
        {
          id: 's-skipped',
          createdAt: '2026-09-10T00:00:00.000Z',
          status: 'ready',
          turns: [
            {
              role: 'user',
              text: 'I want to add a payments domain',
              at: '2026-09-10T00:00:01.000Z',
            },
            {
              role: 'assistant',
              kind: 'questions',
              questions: [
                { id: 'q1', question: 'Which processor?', type: 'single_choice', options: ['Stripe', 'Adyen'] },
              ],
              at: '2026-09-10T00:00:02.000Z',
            },
            {
              role: 'user',
              text: 'My answers:\n- Which processor?: (skipped)',
              at: '2026-09-10T00:00:03.000Z',
            },
            {
              role: 'assistant',
              kind: 'message',
              text: "I'll prepare a payments domain update for you.",
              at: '2026-09-10T00:00:04.000Z',
            },
            {
              role: 'assistant',
              kind: 'finalized',
              instruction: 'Apply this refinement to the plan: I want to add a payments domain.',
              at: '2026-09-10T00:00:05.000Z',
            },
          ],
          finalInstruction: 'Apply this refinement to the plan: I want to add a payments domain.',
          collectedAnswers: [
            { questionId: 'q1', question: 'Which processor?', value: '', skipped: true },
          ],
        },
      ],
    };

    const regenerateSectioned = vi.fn(async () => ({
      plan: chatPlan,
      structuralAdjustments: 0,
      partialFailures: 0,
    }));

    const { fixture, store } = setup(chatPlan, false, {}, [
      { provide: PlannerGraphService, useValue: { regenerateSectioned } },
      { provide: LLM_FACTORY, useValue: () => ({ invoke: async () => ({ text: '{}' }) }) },
      {
        provide: RunStreamHost,
        useValue: {
          startRun: vi.fn(),
          markRunFinished: vi.fn(),
          createWrappedInvoker: () => async () => ({ text: '{}' }),
        },
      },
      { provide: GenerationAbortService, useValue: { setActive: vi.fn() } },
    ]);

    store.plan.set(chatPlan);
    (store.captureUserEditSummary as ReturnType<typeof vi.fn>).mockReturnValue(null);
    fixture.detectChanges();
    await fixture.whenStable();

    const regenButton = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.workspace-toolbar p-button'),
    ).find((el) => (el.textContent ?? '').includes('Regenerate')) as HTMLElement | undefined;
    expect(regenButton).toBeDefined();
    (regenButton!.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(regenerateSectioned).toHaveBeenCalledTimes(1);
    const arg = (regenerateSectioned.mock.calls[0] as unknown as [{
      refinementInstruction: {
        userPrompt?: string;
        chatTranscript: { role: string; text: string }[];
      };
    }])[0];
    expect(arg.refinementInstruction.userPrompt).toBe('I want to add a payments domain');
    // The synthetic summary must still appear in the transcript for context
    const transcriptTexts = (arg.refinementInstruction.chatTranscript ?? []).map((t) => t.text);
    expect(transcriptTexts).toContain('My answers:\n- Which processor?: (skipped)');
  });

});