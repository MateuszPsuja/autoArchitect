import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { RefineWithAiComponent } from './refine-with-ai.component';
import { ProjectStore } from '../../../core/project.store';
import { RefinementChatService } from '../../../core/refinement/refinement-chat.service';
import { MICROBLOG_DEMO_PLAN } from '../../../core/demo-plan/microblog.plan';
import type { Plan } from '../../../core/plan.schema';
import type { RefinementChatLlmResponse } from '../../../core/refinement/refinement-chat.schema';

if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === 'undefined') {
  (globalThis as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

function setupPlan(withPlan: boolean): void {
  if (!withPlan) return;
  const plan: Plan = JSON.parse(JSON.stringify(MICROBLOG_DEMO_PLAN));
  plan.refinementChats = [];
  const store = TestBed.inject(ProjectStore);
  store.setPlan(plan, null);
}

describe('RefineWithAiComponent', () => {
  it('shows the empty-plan message when no plan is loaded', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RefineWithAiComponent],
      providers: [
        {
          provide: RefinementChatService,
          useValue: { consult: vi.fn() },
        },
      ],
    });
    const fixture = TestBed.createComponent(RefineWithAiComponent);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Generate a plan');
  });

  it('shows the composer immediately when a plan exists', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RefineWithAiComponent],
      providers: [
        {
          provide: RefinementChatService,
          useValue: { consult: vi.fn() },
        },
      ],
    });
    setupPlan(true);
    const fixture = TestBed.createComponent(RefineWithAiComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const text = root.textContent ?? '';
    const composerTextarea = root.querySelector('textarea.composer__textarea');
    expect(composerTextarea).not.toBeNull();
    expect(composerTextarea?.getAttribute('placeholder') ?? '').toContain('Type your refinement request');
    expect(text).toContain('Enter to send');
    expect(text).not.toContain('Start chat');
    expect(text).not.toContain('Apply to plan');
  });

it('renders thinking dots below the last user turn in the transcript', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RefineWithAiComponent],
      providers: [
        {
          provide: RefinementChatService,
          useValue: { consult: vi.fn() },
        },
      ],
    });
    setupPlan(true);
    const fixture = TestBed.createComponent(RefineWithAiComponent);
    const projectStore = TestBed.inject(ProjectStore) as unknown as {
      startRefinementChat: () => { id: string };
      appendRefinementChatTurn: (
        sessionId: string,
        turn: { role: 'user'; text: string; at: string },
      ) => void;
      setRefinementChatStatus: (status: string) => void;
    };
    const session = projectStore.startRefinementChat();
    projectStore.appendRefinementChatTurn(session.id, {
      role: 'user',
      text: 'Add offline support',
      at: '2026-09-09T01:00:00.000Z',
    });
    projectStore.setRefinementChatStatus('thinking');
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const transcript = root.querySelector('.chat-transcript');
    expect(transcript).not.toBeNull();
    const children = Array.from(transcript!.children).map(
      (el) => (el as HTMLElement).dataset['role'] ?? '',
    );
    expect(children).toEqual(['user', 'thinking']);
    const userRect = (transcript!.children[0] as HTMLElement).getBoundingClientRect();
    const thinkingRect = (transcript!.children[1] as HTMLElement).getBoundingClientRect();
    expect(thinkingRect.top).toBeGreaterThan(userRect.bottom - 1);
  });

  it('auto-creates a chat session and sends a prompt through RefinementChatService.consult', async () => {
    TestBed.resetTestingModule();
    const consultMock = vi.fn(
      async (): Promise<RefinementChatLlmResponse> => ({
        decision: 'ask',
        questions: [
          {
            id: 'platform',
            question: 'Which mobile target?',
            type: 'single_choice',
            options: ['PWA', 'Native'],
          },
        ],
      }),
    );
    TestBed.configureTestingModule({
      imports: [RefineWithAiComponent],
      providers: [
        {
          provide: RefinementChatService,
          useValue: { consult: consultMock },
        },
      ],
    });
    setupPlan(true);
    const fixture = TestBed.createComponent(RefineWithAiComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      store: InstanceType<typeof ProjectStore>;
      draft: { set: (value: string) => void };
      sendPrompt: () => Promise<void>;
    };
    expect(component.store.plan()?.refinementChats.length ?? 0).toBeGreaterThanOrEqual(1);
    component.draft.set('Add mobile version');
    fixture.detectChanges();
    await component.sendPrompt();
    expect(consultMock).toHaveBeenCalledTimes(1);
    const session = component.store.plan()?.refinementChats[0];
    expect(session?.status).toBe('awaiting_answers');
    expect(session?.pendingQuestions?.[0]?.id).toBe('platform');
  });

  it('sends a prompt after a real keystroke event on the composer textarea', async () => {
    TestBed.resetTestingModule();
    const consultMock = vi.fn(
      async (): Promise<RefinementChatLlmResponse> => ({
        decision: 'finalize',
        summary: 'Got it.',
        instruction: 'Apply mobile support.',
      }),
    );
    TestBed.configureTestingModule({
      imports: [RefineWithAiComponent],
      providers: [
        {
          provide: RefinementChatService,
          useValue: { consult: consultMock },
        },
      ],
    });
    setupPlan(true);
    const fixture = TestBed.createComponent(RefineWithAiComponent);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const textarea = root.querySelector(
      'textarea.composer__textarea',
    ) as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();

    const typed = 'Add mobile version';
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )?.set;
    valueSetter?.call(textarea, typed);
    textarea!.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      draft: () => string;
      sendPrompt: () => Promise<void>;
    };
    expect(component.draft()).toBe(typed);

    const sendButton = Array.from(
      root.querySelectorAll('p-button'),
    )
      .map((el) => el as HTMLElement)
      .find((el) => (el.textContent ?? '').includes('Send'));
    expect(sendButton).toBeDefined();
    const innerButton = sendButton!.querySelector('button') as HTMLButtonElement | null;
    expect(innerButton).not.toBeNull();
    expect(innerButton!.disabled).toBe(false);

    innerButton!.click();
    await fixture.whenStable();
    expect(consultMock).toHaveBeenCalledTimes(1);
  });

  it('recovers and sends when activeSessionId is stale but sessions exist', async () => {
    TestBed.resetTestingModule();
    const consultMock = vi.fn(
      async (): Promise<RefinementChatLlmResponse> => ({
        decision: 'finalize',
        summary: 'Recovered.',
        instruction: 'Apply.',
      }),
    );
    TestBed.configureTestingModule({
      imports: [RefineWithAiComponent],
      providers: [
        {
          provide: RefinementChatService,
          useValue: { consult: consultMock },
        },
      ],
    });
    setupPlan(true);
    const fixture = TestBed.createComponent(RefineWithAiComponent);
    fixture.detectChanges();

    const projectStore = TestBed.inject(ProjectStore) as unknown as {
      startRefinementChat: () => { id: string };
      setActiveRefinementChat: (sessionId: string | null) => void;
      clearAllRefinementChats: () => void;
      plan: () => Plan | null;
    };
    const session = projectStore.startRefinementChat();
    projectStore.clearAllRefinementChats();
    projectStore.setActiveRefinementChat(session.id);

    const component = fixture.componentInstance as unknown as {
      draft: { set: (value: string) => void };
      sendPrompt: () => Promise<void>;
    };
    component.draft.set('Recover me');
    fixture.detectChanges();
    await component.sendPrompt();
    expect(consultMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the Submit answers button visible after the last question is answered so the round can be finalised', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RefineWithAiComponent],
      providers: [
        {
          provide: RefinementChatService,
          useValue: { consult: vi.fn() },
        },
      ],
    });
    setupPlan(true);
    const fixture = TestBed.createComponent(RefineWithAiComponent);
    fixture.detectChanges();
    const store = TestBed.inject(ProjectStore) as unknown as {
      startRefinementChat: () => { id: string };
      setRefinementChatQuestions: (
        sessionId: string,
        questions: { id: string; question: string; type: 'single_choice'; options: string[] }[],
      ) => void;
      setRefinementChatAnswer: (sessionId: string, questionId: string, value: string) => void;
      plan: () => Plan | null;
    };
    const session = store.startRefinementChat();
    store.setRefinementChatQuestions(session.id, [
      { id: 'q1', question: 'Q1', type: 'single_choice', options: ['A', 'B'] },
      { id: 'q2', question: 'Q2', type: 'single_choice', options: ['A', 'B'] },
    ]);
    fixture.detectChanges();

    store.setRefinementChatAnswer(session.id, 'q1', 'A');
    fixture.detectChanges();
    const rootAfterFirst = fixture.nativeElement as HTMLElement;
    expect(rootAfterFirst.querySelector('.question-panel')).not.toBeNull();

    store.setRefinementChatAnswer(session.id, 'q2', 'B');
    fixture.detectChanges();
    const rootAfterLast = fixture.nativeElement as HTMLElement;
    const panel = rootAfterLast.querySelector('.question-panel');
    expect(panel).not.toBeNull();
    const submitButton = Array.from(panel?.querySelectorAll('p-button') ?? []).find((el) =>
      (el.textContent ?? '').includes('Submit answers'),
    );
    expect(submitButton).toBeDefined();
    expect((submitButton!.querySelector('button') as HTMLButtonElement | null)?.disabled).toBe(
      false,
    );
    expect((rootAfterLast.textContent ?? '')).toContain('All 2 questions answered');
    expect(rootAfterLast.querySelector('.composer')).toBeNull();
  });

  it('hides the question panel while the assistant is thinking so the thinking card sits alone at the bottom of the transcript', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RefineWithAiComponent],
      providers: [
        {
          provide: RefinementChatService,
          useValue: { consult: vi.fn() },
        },
      ],
    });
    setupPlan(true);
    const fixture = TestBed.createComponent(RefineWithAiComponent);
    fixture.detectChanges();
    const store = TestBed.inject(ProjectStore) as unknown as {
      startRefinementChat: () => { id: string };
      setRefinementChatQuestions: (
        sessionId: string,
        questions: { id: string; question: string; type: 'single_choice'; options: string[] }[],
      ) => void;
      setRefinementChatAnswer: (sessionId: string, questionId: string, value: string) => void;
      appendRefinementChatTurn: (
        sessionId: string,
        turn: { role: 'user'; text: string; at: string },
      ) => void;
      setRefinementChatStatus: (status: string) => void;
    };
    const session = store.startRefinementChat();
    store.setRefinementChatQuestions(session.id, [
      { id: 'q1', question: 'Q1', type: 'single_choice', options: ['A', 'B'] },
    ]);
    store.setRefinementChatAnswer(session.id, 'q1', 'A');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.question-panel')).not.toBeNull();

    store.appendRefinementChatTurn(session.id, {
      role: 'user',
      text: 'My answers: - Q1: A',
      at: '2026-09-10T00:00:00.000Z',
    });
    store.setRefinementChatStatus('thinking');
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.turn--thinking')).not.toBeNull();
    expect(root.querySelector('.question-panel')).toBeNull();
    expect(root.querySelector('.composer')).toBeNull();
  });

  it('hides the composer and shows the question panel while awaiting answers (memory refine_with_questions.layout_bug)', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RefineWithAiComponent],
      providers: [
        {
          provide: RefinementChatService,
          useValue: { consult: vi.fn() },
        },
      ],
    });
    setupPlan(true);
    const fixture = TestBed.createComponent(RefineWithAiComponent);
    const store = TestBed.inject(ProjectStore) as unknown as {
      startRefinementChat: () => { id: string };
      setRefinementChatQuestions: (
        sessionId: string,
        questions: { id: string; question: string; type: 'single_choice'; options: string[] }[],
      ) => void;
    };
    const session = store.startRefinementChat();
    store.setRefinementChatQuestions(session.id, [
      { id: 'q1', question: 'Pick one', type: 'single_choice', options: ['Yes', 'No'] },
    ]);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.composer')).toBeNull();
    expect(root.querySelector('.question-panel')).not.toBeNull();
  });

  it('does not render "Why we ask" copy (memory refine_with_questions.no_why_we_ask)', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RefineWithAiComponent],
      providers: [
        {
          provide: RefinementChatService,
          useValue: { consult: vi.fn() },
        },
      ],
    });
    setupPlan(true);
    const fixture = TestBed.createComponent(RefineWithAiComponent);
    const store = TestBed.inject(ProjectStore) as unknown as {
      startRefinementChat: () => { id: string };
      setRefinementChatQuestions: (
        sessionId: string,
        questions: { id: string; question: string; type: 'single_choice'; options: string[] }[],
      ) => void;
    };
    const session = store.startRefinementChat();
    store.setRefinementChatQuestions(session.id, [
      { id: 'q1', question: 'Pick one', type: 'single_choice', options: ['Yes', 'No'] },
    ]);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text.toLowerCase()).not.toContain('why we ask');
    expect(text.toLowerCase()).not.toContain('why we’re asking');
  });

  it('exposes a Skip question action while a question is active', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RefineWithAiComponent],
      providers: [
        {
          provide: RefinementChatService,
          useValue: { consult: vi.fn() },
        },
      ],
    });
    setupPlan(true);
    const fixture = TestBed.createComponent(RefineWithAiComponent);
    const store = TestBed.inject(ProjectStore) as unknown as {
      startRefinementChat: () => { id: string };
      setRefinementChatQuestions: (
        sessionId: string,
        questions: { id: string; question: string; type: 'single_choice'; options: string[] }[],
      ) => void;
      skipRefinementChatAnswer: (sessionId: string, questionId: string) => void;
    };
    const session = store.startRefinementChat();
    store.setRefinementChatQuestions(session.id, [
      { id: 'q1', question: 'Pick one', type: 'single_choice', options: ['Yes', 'No'] },
    ]);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const skipButton = Array.from(root.querySelectorAll('p-button'))
      .map((el) => el as HTMLElement)
      .find((el) => (el.textContent ?? '').toLowerCase().includes('skip question'));
    expect(skipButton).toBeDefined();
  });

  it('renders a "Skip remaining" button while any question is unanswered', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RefineWithAiComponent],
      providers: [
        {
          provide: RefinementChatService,
          useValue: { consult: vi.fn() },
        },
      ],
    });
    setupPlan(true);
    const fixture = TestBed.createComponent(RefineWithAiComponent);
    fixture.detectChanges();
    const store = TestBed.inject(ProjectStore) as unknown as {
      startRefinementChat: () => { id: string };
      setRefinementChatQuestions: (
        sessionId: string,
        questions: { id: string; question: string; type: 'single_choice'; options: string[] }[],
      ) => void;
      setRefinementChatAnswer: (sessionId: string, questionId: string, value: string) => void;
    };
    const session = store.startRefinementChat();
    store.setRefinementChatQuestions(session.id, [
      { id: 'q1', question: 'Q1', type: 'single_choice', options: ['A', 'B'] },
      { id: 'q2', question: 'Q2', type: 'single_choice', options: ['A', 'B'] },
      { id: 'q3', question: 'Q3', type: 'single_choice', options: ['A', 'B'] },
    ]);
    store.setRefinementChatAnswer(session.id, 'q1', 'A');
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const skipRemainingButton = Array.from(root.querySelectorAll('p-button'))
      .map((el) => el as HTMLElement)
      .find((el) => (el.textContent ?? '').toLowerCase().includes('skip remaining'));
    expect(skipRemainingButton).toBeDefined();
    const innerButton = skipRemainingButton!.querySelector('button') as HTMLButtonElement | null;
    expect(innerButton).not.toBeNull();
    expect(innerButton!.disabled).toBe(false);
  });

  it('clicking Skip remaining marks every unanswered free_text question as skipped and calls RefinementChatService.consult', async () => {
    TestBed.resetTestingModule();
    const consultMock = vi.fn(
      async (): Promise<RefinementChatLlmResponse> => ({
        decision: 'finalize',
        summary: 'Skipped the rest.',
        instruction: 'Apply with skipped answers.',
      }),
    );
    TestBed.configureTestingModule({
      imports: [RefineWithAiComponent],
      providers: [
        {
          provide: RefinementChatService,
          useValue: { consult: consultMock },
        },
      ],
    });
    setupPlan(true);
    const fixture = TestBed.createComponent(RefineWithAiComponent);
    fixture.detectChanges();
    const store = TestBed.inject(ProjectStore) as unknown as {
      startRefinementChat: () => { id: string };
      setRefinementChatQuestions: (
        sessionId: string,
        questions: { id: string; question: string; type: 'free_text' }[],
      ) => void;
      plan: () => Plan | null;
    };
    const session = store.startRefinementChat();
    store.setRefinementChatQuestions(session.id, [
      { id: 'q1', question: 'Q1', type: 'free_text' },
      { id: 'q2', question: 'Q2', type: 'free_text' },
    ]);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const skipRemainingButton = Array.from(root.querySelectorAll('p-button'))
      .map((el) => el as HTMLElement)
      .find((el) => (el.textContent ?? '').toLowerCase().includes('skip remaining'));
    expect(skipRemainingButton).toBeDefined();
    const innerButton = skipRemainingButton!.querySelector('button') as HTMLButtonElement | null;
    expect(innerButton).not.toBeNull();

    const component = fixture.componentInstance as unknown as {
      skipRemaining: () => Promise<void>;
    };
    await component.skipRemaining();
    await fixture.whenStable();

    expect(consultMock).toHaveBeenCalledTimes(1);
    const updatedSession = store
      .plan()
      ?.refinementChats.find((s: { status: string }) => s.status === 'ready');
    expect(updatedSession).toBeDefined();
    const storedAnswers = updatedSession?.collectedAnswers ?? updatedSession?.pendingAnswers;
    expect(storedAnswers?.length).toBe(2);
    expect(storedAnswers?.every((a) => a.skipped)).toBe(true);
  });

  it('hides the Skip remaining button when every question is answered', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RefineWithAiComponent],
      providers: [
        {
          provide: RefinementChatService,
          useValue: { consult: vi.fn() },
        },
      ],
    });
    setupPlan(true);
    const fixture = TestBed.createComponent(RefineWithAiComponent);
    fixture.detectChanges();
    const store = TestBed.inject(ProjectStore) as unknown as {
      startRefinementChat: () => { id: string };
      setRefinementChatQuestions: (
        sessionId: string,
        questions: { id: string; question: string; type: 'single_choice'; options: string[] }[],
      ) => void;
      setRefinementChatAnswer: (sessionId: string, questionId: string, value: string) => void;
    };
    const session = store.startRefinementChat();
    store.setRefinementChatQuestions(session.id, [
      { id: 'q1', question: 'Q1', type: 'single_choice', options: ['A', 'B'] },
      { id: 'q2', question: 'Q2', type: 'single_choice', options: ['A', 'B'] },
    ]);
    store.setRefinementChatAnswer(session.id, 'q1', 'A');
    store.setRefinementChatAnswer(session.id, 'q2', 'B');
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const skipRemainingButton = Array.from(root.querySelectorAll('p-button'))
      .map((el) => el as HTMLElement)
      .find((el) => (el.textContent ?? '').toLowerCase().includes('skip remaining'));
    expect(skipRemainingButton).toBeUndefined();
  });

  it('discards the half-typed free-text draft when Skip remaining is clicked', async () => {
    TestBed.resetTestingModule();
    const consultMock = vi.fn(
      async (): Promise<RefinementChatLlmResponse> => ({
        decision: 'finalize',
        summary: 'Discarded draft.',
        instruction: 'Apply.',
      }),
    );
    TestBed.configureTestingModule({
      imports: [RefineWithAiComponent],
      providers: [
        {
          provide: RefinementChatService,
          useValue: { consult: consultMock },
        },
      ],
    });
    setupPlan(true);
    const fixture = TestBed.createComponent(RefineWithAiComponent);
    fixture.detectChanges();
    const store = TestBed.inject(ProjectStore) as unknown as {
      startRefinementChat: () => { id: string };
      setRefinementChatQuestions: (
        sessionId: string,
        questions: { id: string; question: string; type: 'free_text' }[],
      ) => void;
    };
    const session = store.startRefinementChat();
    store.setRefinementChatQuestions(session.id, [
      { id: 'q1', question: 'Explain', type: 'free_text' },
    ]);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      freeTextDraft: { set: (value: string) => void; (): string };
    };
    component.freeTextDraft.set('half-typed answer');
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const skipRemainingButton = Array.from(root.querySelectorAll('p-button'))
      .map((el) => el as HTMLElement)
      .find((el) => (el.textContent ?? '').toLowerCase().includes('skip remaining'));
    expect(skipRemainingButton).toBeDefined();
    const innerButton = skipRemainingButton!.querySelector('button') as HTMLButtonElement | null;
    expect(innerButton).not.toBeNull();

    innerButton!.click();
    await fixture.whenStable();

    expect(component.freeTextDraft()).toBe('');
  });

  it('advances to the next question after Skip question is clicked', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RefineWithAiComponent],
      providers: [
        {
          provide: RefinementChatService,
          useValue: { consult: vi.fn() },
        },
      ],
    });
    setupPlan(true);
    const fixture = TestBed.createComponent(RefineWithAiComponent);
    fixture.detectChanges();
    const store = TestBed.inject(ProjectStore) as unknown as {
      startRefinementChat: () => { id: string };
      setRefinementChatQuestions: (
        sessionId: string,
        questions: { id: string; question: string; type: 'single_choice'; options: string[] }[],
      ) => void;
      skipRefinementChatAnswer: (sessionId: string, questionId: string) => void;
    };
    const session = store.startRefinementChat();
    store.setRefinementChatQuestions(session.id, [
      { id: 'q1', question: 'First', type: 'single_choice', options: ['A', 'B'] },
      { id: 'q2', question: 'Second', type: 'single_choice', options: ['A', 'B'] },
    ]);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      currentQuestion: () => { id: string } | null;
    };
    expect(component.currentQuestion()?.id).toBe('q1');

    store.skipRefinementChatAnswer(session.id, 'q1');
    fixture.detectChanges();
    expect(component.currentQuestion()?.id).toBe('q2');
  });

  it('substitutes the LLM recommended option when Skip question is clicked on a single_choice', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RefineWithAiComponent],
      providers: [
        {
          provide: RefinementChatService,
          useValue: { consult: vi.fn() },
        },
      ],
    });
    setupPlan(true);
    const fixture = TestBed.createComponent(RefineWithAiComponent);
    fixture.detectChanges();
    const store = TestBed.inject(ProjectStore) as unknown as {
      startRefinementChat: () => { id: string };
      setRefinementChatQuestions: (
        sessionId: string,
        questions: {
          id: string;
          question: string;
          type: 'single_choice';
          options: string[];
          recommended?: string;
        }[],
      ) => void;
      skipRefinementChatAnswer: (sessionId: string, questionId: string) => void;
      plan: () => Plan | null;
    };
    const session = store.startRefinementChat();
    store.setRefinementChatQuestions(session.id, [
      {
        id: 'q1',
        question: 'Which platform?',
        type: 'single_choice',
        options: ['PWA', 'Native'],
        recommended: 'PWA',
      },
    ]);
    store.skipRefinementChatAnswer(session.id, 'q1');
    fixture.detectChanges();

    const stored = store
      .plan()
      ?.refinementChats.find((s) => s.id === session.id)
      ?.pendingAnswers?.[0];
    expect(stored).toEqual({ questionId: 'q1', value: 'PWA', skipped: false });
  });

  it('defaults to the first option when Skip question is clicked on a single_choice with no recommended value', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RefineWithAiComponent],
      providers: [
        {
          provide: RefinementChatService,
          useValue: { consult: vi.fn() },
        },
      ],
    });
    setupPlan(true);
    const fixture = TestBed.createComponent(RefineWithAiComponent);
    fixture.detectChanges();
    const store = TestBed.inject(ProjectStore) as unknown as {
      startRefinementChat: () => { id: string };
      setRefinementChatQuestions: (
        sessionId: string,
        questions: { id: string; question: string; type: 'single_choice'; options: string[] }[],
      ) => void;
      skipRefinementChatAnswer: (sessionId: string, questionId: string) => void;
      plan: () => Plan | null;
    };
    const session = store.startRefinementChat();
    store.setRefinementChatQuestions(session.id, [
      { id: 'q1', question: 'Which?', type: 'single_choice', options: ['A', 'B'] },
    ]);
    store.skipRefinementChatAnswer(session.id, 'q1');
    fixture.detectChanges();

    const stored = store
      .plan()
      ?.refinementChats.find((s) => s.id === session.id)
      ?.pendingAnswers?.[0];
    expect(stored).toEqual({ questionId: 'q1', value: 'A', skipped: false });
  });

  it('records skipped=true when Skip question is clicked on a free_text question with no recommended value', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RefineWithAiComponent],
      providers: [
        {
          provide: RefinementChatService,
          useValue: { consult: vi.fn() },
        },
      ],
    });
    setupPlan(true);
    const fixture = TestBed.createComponent(RefineWithAiComponent);
    fixture.detectChanges();
    const store = TestBed.inject(ProjectStore) as unknown as {
      startRefinementChat: () => { id: string };
      setRefinementChatQuestions: (
        sessionId: string,
        questions: { id: string; question: string; type: 'free_text' }[],
      ) => void;
      skipRefinementChatAnswer: (sessionId: string, questionId: string) => void;
      plan: () => Plan | null;
    };
    const session = store.startRefinementChat();
    store.setRefinementChatQuestions(session.id, [
      { id: 'q1', question: 'Explain', type: 'free_text' },
    ]);
    store.skipRefinementChatAnswer(session.id, 'q1');
    fixture.detectChanges();

    const stored = store
      .plan()
      ?.refinementChats.find((s) => s.id === session.id)
      ?.pendingAnswers?.[0];
    expect(stored).toEqual({ questionId: 'q1', value: '', skipped: true });
  });

  it('enables Submit answers immediately after Skip question on a single-question session', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RefineWithAiComponent],
      providers: [
        {
          provide: RefinementChatService,
          useValue: { consult: vi.fn() },
        },
      ],
    });
    setupPlan(true);
    const fixture = TestBed.createComponent(RefineWithAiComponent);
    fixture.detectChanges();
    const store = TestBed.inject(ProjectStore) as unknown as {
      startRefinementChat: () => { id: string };
      setRefinementChatQuestions: (
        sessionId: string,
        questions: { id: string; question: string; type: 'single_choice'; options: string[] }[],
      ) => void;
      skipRefinementChatAnswer: (sessionId: string, questionId: string) => void;
    };
    const session = store.startRefinementChat();
    store.setRefinementChatQuestions(session.id, [
      { id: 'q1', question: 'Pick one', type: 'single_choice', options: ['A', 'B'] },
    ]);
    fixture.detectChanges();

    store.skipRefinementChatAnswer(session.id, 'q1');
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const submitButton = Array.from(root.querySelectorAll('p-button'))
      .map((el) => el as HTMLElement)
      .find((el) => (el.textContent ?? '').includes('Submit answers'));
    expect(submitButton).toBeDefined();
    const inner = submitButton!.querySelector('button') as HTMLButtonElement | null;
    expect(inner).not.toBeNull();
    expect(inner!.disabled).toBe(false);
  });

  it('substitutes recommended per question when Skip remaining is clicked and a question has no recommended', async () => {
    TestBed.resetTestingModule();
    const consultMock = vi.fn(
      async (): Promise<RefinementChatLlmResponse> => ({
        decision: 'finalize',
        summary: 'Done.',
        instruction: 'Apply.',
      }),
    );
    TestBed.configureTestingModule({
      imports: [RefineWithAiComponent],
      providers: [
        {
          provide: RefinementChatService,
          useValue: { consult: consultMock },
        },
      ],
    });
    setupPlan(true);
    const fixture = TestBed.createComponent(RefineWithAiComponent);
    fixture.detectChanges();
    const store = TestBed.inject(ProjectStore) as unknown as {
      startRefinementChat: () => { id: string };
      setRefinementChatQuestions: (
        sessionId: string,
        questions: {
          id: string;
          question: string;
          type: 'single_choice';
          options: string[];
          recommended?: string;
        }[],
      ) => void;
      plan: () => Plan | null;
    };
    const session = store.startRefinementChat();
    store.setRefinementChatQuestions(session.id, [
      {
        id: 'q1',
        question: 'First',
        type: 'single_choice',
        options: ['X', 'Y'],
        recommended: 'X',
      },
      { id: 'q2', question: 'Second', type: 'single_choice', options: ['A', 'B'] },
    ]);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      skipRemaining: () => Promise<void>;
    };
    await component.skipRemaining();
    await fixture.whenStable();

    expect(consultMock).toHaveBeenCalledTimes(1);
    const updatedSession = store
      .plan()
      ?.refinementChats.find((s) => s.status === 'ready');
    expect(updatedSession).toBeDefined();
    const answers = updatedSession?.collectedAnswers ?? updatedSession?.pendingAnswers ?? [];
    expect(answers.length).toBe(2);
    const byId = new Map(answers.map((a) => [a.questionId, a]));
    expect(byId.get('q1')).toEqual({ questionId: 'q1', question: 'First', value: 'X', skipped: false });
    expect(byId.get('q2')).toEqual({ questionId: 'q2', question: 'Second', value: 'A', skipped: false });
  });

  it('does not mark any answer as skipped when every question carries a recommended value during Skip remaining', async () => {
    TestBed.resetTestingModule();
    const consultMock = vi.fn(
      async (): Promise<RefinementChatLlmResponse> => ({
        decision: 'finalize',
        summary: 'Done.',
        instruction: 'Apply.',
      }),
    );
    TestBed.configureTestingModule({
      imports: [RefineWithAiComponent],
      providers: [
        {
          provide: RefinementChatService,
          useValue: { consult: consultMock },
        },
      ],
    });
    setupPlan(true);
    const fixture = TestBed.createComponent(RefineWithAiComponent);
    fixture.detectChanges();
    const store = TestBed.inject(ProjectStore) as unknown as {
      startRefinementChat: () => { id: string };
      setRefinementChatQuestions: (
        sessionId: string,
        questions: {
          id: string;
          question: string;
          type: 'single_choice';
          options: string[];
          recommended?: string;
        }[],
      ) => void;
      plan: () => Plan | null;
    };
    const session = store.startRefinementChat();
    store.setRefinementChatQuestions(session.id, [
      {
        id: 'q1',
        question: 'First',
        type: 'single_choice',
        options: ['A', 'B'],
        recommended: 'A',
      },
      {
        id: 'q2',
        question: 'Second',
        type: 'single_choice',
        options: ['A', 'B'],
        recommended: 'B',
      },
    ]);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      skipRemaining: () => Promise<void>;
    };
    await component.skipRemaining();
    await fixture.whenStable();

    expect(consultMock).toHaveBeenCalledTimes(1);
    const updatedSession = store
      .plan()
      ?.refinementChats.find((s) => s.status === 'ready');
    const answers = updatedSession?.collectedAnswers ?? updatedSession?.pendingAnswers ?? [];
    expect(answers.length).toBe(2);
    expect(answers.every((a) => a.skipped === false)).toBe(true);
    expect(answers.map((a) => a.value).sort()).toEqual(['A', 'B']);
  });

  it('substitutes the recommended default on free_text questions during Skip remaining', async () => {
    TestBed.resetTestingModule();
    const consultMock = vi.fn(
      async (): Promise<RefinementChatLlmResponse> => ({
        decision: 'finalize',
        summary: 'Done.',
        instruction: 'Apply.',
      }),
    );
    TestBed.configureTestingModule({
      imports: [RefineWithAiComponent],
      providers: [
        {
          provide: RefinementChatService,
          useValue: { consult: consultMock },
        },
      ],
    });
    setupPlan(true);
    const fixture = TestBed.createComponent(RefineWithAiComponent);
    fixture.detectChanges();
    const store = TestBed.inject(ProjectStore) as unknown as {
      startRefinementChat: () => { id: string };
      setRefinementChatQuestions: (
        sessionId: string,
        questions: {
          id: string;
          question: string;
          type: 'free_text';
          recommended?: string;
        }[],
      ) => void;
      plan: () => Plan | null;
    };
    const session = store.startRefinementChat();
    store.setRefinementChatQuestions(session.id, [
      {
        id: 'q1',
        question: 'What sync strategy?',
        type: 'free_text',
        recommended: 'Use background sync',
      },
    ]);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      skipRemaining: () => Promise<void>;
    };
    await component.skipRemaining();
    await fixture.whenStable();

    expect(consultMock).toHaveBeenCalledTimes(1);
    const updatedSession = store
      .plan()
      ?.refinementChats.find((s) => s.status === 'ready');
    const answers = updatedSession?.collectedAnswers ?? updatedSession?.pendingAnswers ?? [];
    expect(answers[0]).toEqual({
      questionId: 'q1',
      question: 'What sync strategy?',
      value: 'Use background sync',
      skipped: false,
    });
  });

  it('force-finalizes the chat when Skip remaining is clicked and the LLM responds with another round of questions', async () => {
    TestBed.resetTestingModule();
    const consultMock = vi.fn(
      async (): Promise<RefinementChatLlmResponse> => ({
        decision: 'ask',
        questions: [
          { id: 'q2', question: 'Follow-up?', type: 'free_text' },
        ],
      }),
    );
    TestBed.configureTestingModule({
      imports: [RefineWithAiComponent],
      providers: [
        {
          provide: RefinementChatService,
          useValue: { consult: consultMock },
        },
      ],
    });
    setupPlan(true);
    const fixture = TestBed.createComponent(RefineWithAiComponent);
    fixture.detectChanges();
    const store = TestBed.inject(ProjectStore) as unknown as {
      startRefinementChat: () => { id: string };
      setRefinementChatQuestions: (
        sessionId: string,
        questions: { id: string; question: string; type: 'free_text' }[],
      ) => void;
      appendRefinementChatTurn: (
        sessionId: string,
        turn: { role: string; text: string; at: string },
      ) => void;
      plan: () => Plan | null;
    };
    const session = store.startRefinementChat();
    store.setRefinementChatQuestions(session.id, [
      { id: 'q1', question: 'Initial?', type: 'free_text' },
    ]);
    // Pre-seed the original user request as the first user turn
    store.appendRefinementChatTurn(session.id, {
      role: 'user',
      text: 'I want to add a payments domain',
      at: '2026-09-10T00:00:00.000Z',
    });
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      skipRemaining: () => Promise<void>;
    };
    await component.skipRemaining();
    await fixture.whenStable();

    // Session must reach 'ready' so the user can immediately hit Regenerate
    const updatedSession = store
      .plan()
      ?.refinementChats.find((s) => s.id === session.id);
    expect(updatedSession?.status).toBe('ready');
    expect(updatedSession?.finalInstruction).toBeTruthy();
    // finalInstruction must reference the original user request
    expect(updatedSession?.finalInstruction).toContain('payments');
  });
});