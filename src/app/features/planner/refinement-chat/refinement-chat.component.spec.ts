import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { ProjectStore } from '../../../core/project.store';
import { RefinementChatComponent } from './refinement-chat.component';

function setup(status: 'idle' | 'loading_questions' | 'asking' | 'completed' = 'idle') {
  const state = {
    status: signal(status),
    originalInput: signal(null),
    questions: signal<any[]>([]),
    currentIndex: signal(0),
    answers: signal<any[]>([]),
    draftValue: signal(''),
    error: signal<string | null>(null),
  };
  const store = {
    refinement: state,
    setRefinementDraft: vi.fn((value: string) => state.draftValue.set(value)),
    submitRefinementAnswer: vi.fn(),
    skipRefinementQuestion: vi.fn(),
    skipRefinement: vi.fn(),
  };

  TestBed.configureTestingModule({
    imports: [RefinementChatComponent],
    providers: [{ provide: ProjectStore, useValue: store }],
  });
  const fixture = TestBed.createComponent(RefinementChatComponent);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance as any, store, state };
}

describe('RefinementChatComponent', () => {
  it('renders no panel while refinement is idle', () => {
    const { fixture } = setup();
    expect(fixture.nativeElement.querySelector('.refinement-panel')).toBeNull();
  });

  it('renders the loading state', () => {
    const { fixture } = setup('loading_questions');
    expect(fixture.nativeElement.textContent).toContain('Thinking through the important decisions');
    expect(fixture.nativeElement.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('renders a question, selects an option, and submits it', () => {
    const { fixture, component, store, state } = setup('asking');
    state.questions.set([
      {
        id: 'deployment',
        question: 'Where will it run?',
        rationale: 'Hosting changes the architecture.',
        type: 'single_choice',
        options: ['Browser', 'Server'],
      },
    ]);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Question 1 of 1');
    expect(fixture.nativeElement.textContent).toContain('Where will it run?');
    expect(fixture.nativeElement.textContent).not.toContain('Why we ask');

    component.selectOption('Browser');
    component.submitAnswer();

    expect(store.submitRefinementAnswer).toHaveBeenCalledWith({
      questionId: 'deployment',
      value: 'Browser',
      skipped: false,
    });
  });

  it('offers a Skip question action next to Submit', () => {
    const { fixture, component, store, state } = setup('asking');
    state.questions.set([
      {
        id: 'deployment',
        question: 'Where will it run?',
        type: 'single_choice',
        options: ['Browser', 'Server'],
      },
    ]);
    fixture.detectChanges();

    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ) as HTMLButtonElement[];
    const skipButton = buttons.find((b) => b.textContent?.trim() === 'Skip question');
    const submitButton = buttons.find((b) => b.textContent?.trim().startsWith('Submit'));
    expect(skipButton).toBeDefined();
    expect(submitButton).toBeDefined();

    skipButton?.click();
    expect(store.skipRefinementQuestion).toHaveBeenCalledTimes(1);
  });

  it('renders the answered history above the active question', () => {
    const { fixture, state } = setup('asking');
    state.questions.set([
      {
        id: 'deployment',
        question: 'Where will it run?',
        type: 'single_choice',
        options: ['Browser', 'Server'],
      },
      {
        id: 'auth',
        question: 'Which identity provider?',
        type: 'free_text',
      },
    ]);
    state.answers.set([
      { questionId: 'deployment', value: 'Browser', skipped: false },
    ]);
    state.currentIndex.set(1);
    fixture.detectChanges();

    const history = fixture.nativeElement.querySelector('.history-list');
    expect(history).not.toBeNull();
    expect(history?.textContent).toContain('Where will it run?');
    expect(history?.textContent).toContain('Browser');
  });

  it('renders the "Final check" eyebrow when the current question is the terminator', () => {
    const { fixture, state } = setup('asking');
    state.questions.set([
      {
        id: 'deployment',
        question: 'Where will it run?',
        type: 'single_choice',
        options: ['Browser', 'Server'],
      },
      {
        id: '__refine_more__',
        question: 'Do you want more questions to refine it further?',
        type: 'single_choice',
        options: [
          'Yes, ask more questions',
          'No, generate the plan with these answers',
        ],
      },
    ]);
    state.currentIndex.set(1);
    fixture.detectChanges();

    const eyebrow = fixture.nativeElement.querySelector('.eyebrow');
    expect(eyebrow?.textContent?.trim()).toBe('Final check');
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ) as HTMLButtonElement[];
    const optionTexts = buttons
      .map((b) => b.textContent?.trim() ?? '')
      .filter((t) => t === 'Yes, ask more questions' || t === 'No, generate the plan with these answers');
    expect(optionTexts).toEqual([
      'Yes, ask more questions',
      'No, generate the plan with these answers',
    ]);
    expect(fixture.nativeElement.textContent).toContain('Question 2 of 2');
  });
});
