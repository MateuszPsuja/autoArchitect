import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { MessageModule } from 'primeng/message';
import { ProgressBarModule } from 'primeng/progressbar';
import { CardModule } from 'primeng/card';
import { DividerModule } from 'primeng/divider';
import { SelectModule } from 'primeng/select';
import { TooltipModule } from 'primeng/tooltip';
import { ProjectStore } from '../../../core/project.store';
import { RefinementChatService } from '../../../core/refinement/refinement-chat.service';
import { MarkdownRendererService } from '../../../core/markdown-renderer.service';
import type {
  RefinementChatLlmResponse,
  RefinementChatSession,
  RefinementChatTurn,
} from '../../../core/refinement/refinement-chat.schema';

interface QaRoundEntry {
  questionId: string;
  question: string;
  value: string;
  skipped: boolean;
  index: number;
}

interface QaRoundSnapshot {
  entries: readonly QaRoundEntry[];
  total: number;
}

@Component({
  selector: 'app-refine-with-ai',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ButtonModule,
    TextareaModule,
    MessageModule,
    ProgressBarModule,
    CardModule,
    DividerModule,
    SelectModule,
    TooltipModule,
  ],
  templateUrl: './refine-with-ai.component.html',
  styleUrl: './refine-with-ai.component.scss',
})
export class RefineWithAiComponent {
  protected readonly store = inject(ProjectStore);
  private readonly chatService = inject(RefinementChatService);
  private readonly markdownRenderer = inject(MarkdownRendererService);

  protected readonly renderMarkdown = (text: string) =>
    this.markdownRenderer.toSafeHtml(text);

  protected readonly otherMode = signal(false);
  protected readonly freeTextDraft = signal('');
  private freeTextDraftQuestionId = '';

  protected readonly draft = signal('');

  protected readonly qaRounds = signal<ReadonlyMap<string, QaRoundSnapshot>>(
    new Map(),
  );

  protected readonly sessions = computed<RefinementChatSession[]>(
    () => this.store.plan()?.refinementChats ?? [],
  );

  protected readonly activeSession = computed<RefinementChatSession | null>(() => {
    const id = this.store.refinementChat.activeSessionId();
    if (!id) return null;
    return this.sessions().find((s) => s.id === id) ?? null;
  });

  protected readonly sessionOptions = computed(() =>
    this.sessions().map((s) => ({
      label: `${new Date(s.createdAt).toLocaleString()} — ${labelForStatus(s.status)}`,
      value: s.id,
      disabled: false,
    })),
  );

  protected readonly currentQuestion = computed(() => {
    const session = this.activeSession();
    if (!session || session.status !== 'awaiting_answers') return null;
    const questions = session.pendingQuestions ?? [];
    const answers = session.pendingAnswers ?? [];
    return questions.find((q) => !answers.some((a) => a.questionId === q.id)) ?? null;
  });

  protected readonly canSkipRemaining = computed(() => {
    const session = this.activeSession();
    if (!session || session.status !== 'awaiting_answers') return false;
    const questions = session.pendingQuestions ?? [];
    const answers = session.pendingAnswers ?? [];
    return questions.some((q) => !answers.some((a) => a.questionId === q.id));
  });

  protected readonly canSubmit = computed(() => {
    const session = this.activeSession();
    if (!session || session.status !== 'awaiting_answers') return false;
    if ((session.pendingAnswers ?? []).length > 0) return true;
    return this.freeTextDraft().trim().length > 0;
  });

  protected readonly answeredQuestions = computed<QaRoundEntry[]>(() => {
    const session = this.activeSession();
    if (!session) return [];
    const answers = session.pendingAnswers ?? [];
    const questions = session.pendingQuestions ?? [];
    return answers.map((answer, index) => {
      const question = questions.find((q) => q.id === answer.questionId);
      return {
        questionId: answer.questionId,
        question: question?.question ?? answer.questionId,
        value: answer.skipped ? '— skipped —' : answer.value,
        skipped: answer.skipped,
        index,
      };
    });
  });

  protected readonly latestFinalizedInstruction = computed(() => {
    const session = this.activeSession();
    if (!session) return null;
    const stored = session.finalInstruction?.trim();
    if (stored) return stored;
    const lastFinal = [...session.turns].reverse().find(
      (turn) => turn.role === 'assistant' && turn.kind === 'finalized',
    );
    return lastFinal && lastFinal.kind === 'finalized'
      ? lastFinal.instruction.trim()
      : null;
  });

  protected readonly composerDisabled = computed(() => {
    const status = this.store.refinementChat.status();
    if (status === 'thinking' || status === 'applying') return true;
    if (!this.store.hasPlan()) return true;
    return false;
  });

  protected readonly questionsVisible = computed(
    () =>
      !!this.currentQuestion() ||
      this.thinking() ||
      this.activeSession()?.status === 'awaiting_answers',
  );

  protected readonly sendDisabled = computed(
    () => this.composerDisabled() || this.draft().trim().length === 0,
  );

  protected readonly hasPlan = this.store.hasPlan;

  protected readonly progress = computed(() => {
    const session = this.activeSession();
    if (!session || session.status !== 'awaiting_answers') return 0;
    const total = session.pendingQuestions?.length ?? 0;
    const answered = session.pendingAnswers?.length ?? 0;
    return total === 0 ? 0 : (answered / total) * 100;
  });

  protected readonly totalQuestions = computed(() => {
    const session = this.activeSession();
    return session?.pendingQuestions?.length ?? 0;
  });

  protected readonly thinking = computed(
    () => this.store.refinementChat.status() === 'thinking',
  );

  private readonly transcriptRef = viewChild<ElementRef<HTMLElement>>('transcript');
  private lastScrolledTurnCount = -1;
  private lastScrolledThinking = false;

  private scrollTranscriptToBottom(): void {
    const el = this.transcriptRef()?.nativeElement;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }

  constructor() {
    effect(() => {
      const plan = this.store.plan();
      const activeSessionId = this.store.refinementChat.activeSessionId();
      const status = this.store.refinementChat.status();
      untracked(() => {
        this.otherMode.set(false);
        if (plan && !activeSessionId && status !== 'thinking' && status !== 'applying') {
          const sessions = plan.refinementChats ?? [];
          if (sessions.length === 0) {
            this.store.startRefinementChat();
          } else {
            const last = sessions[sessions.length - 1];
            this.store.setActiveRefinementChat(last.id);
          }
        }
      });
    });

    effect(() => {
      const question = this.currentQuestion();
      const questionId = question?.id ?? '';
      if (questionId !== this.freeTextDraftQuestionId) {
        this.freeTextDraftQuestionId = questionId;
        this.freeTextDraft.set('');
      }
    });

    effect(() => {
      const turnCount = this.activeSession()?.turns.length ?? 0;
      const isThinking = this.thinking();
      if (turnCount !== this.lastScrolledTurnCount || isThinking !== this.lastScrolledThinking) {
        this.lastScrolledTurnCount = turnCount;
        this.lastScrolledThinking = isThinking;
        queueMicrotask(() => this.scrollTranscriptToBottom());
      }
    });
  }

  protected onDraftChange(value: string): void {
    this.draft.set(value);
    this.store.setRefinementChatDraft(value);
  }

  protected onSessionChange(value: string): void {
    this.store.setActiveRefinementChat(value);
  }

  protected selectOption(option: string): void {
    this.otherMode.set(false);
    const question = this.currentQuestion();
    const session = this.activeSession();
    if (!question || !session) return;
    this.freeTextDraft.set('');
    this.store.setRefinementChatAnswer(session.id, question.id, option);
  }

  protected onAnswerInput(event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value;
    this.freeTextDraft.set(value);
  }

  protected currentAnswerValue(): string {
    return this.freeTextDraft();
  }

  protected showOther(): void {
    this.otherMode.set(true);
  }

  protected skipCurrent(): void {
    const question = this.currentQuestion();
    const session = this.activeSession();
    if (!question || !session) return;
    this.store.skipRefinementChatAnswer(session.id, question.id);
  }

  protected async skipRemaining(): Promise<void> {
    const session = this.activeSession();
    if (!session || session.status !== 'awaiting_answers') return;
    if (this.store.refinementChat.status() === 'thinking') return;
    if (!this.canSkipRemaining()) return;

    this.store.skipAllRefinementChatAnswers(session.id);
    this.freeTextDraft.set('');
    await this.submitAnswersAndContinue();

    // If the LLM responded to the skipped answers with another round of
    // questions, the user has effectively expressed intent to move on without
    // answering. Force-finalize the session so the user can immediately hit
    // Regenerate without being trapped in a clarifying-question loop.
    const latest = this.sessions().find((s) => s.id === session.id);
    if (latest?.status === 'awaiting_answers') {
      this.forceFinalizeSkippedSession(session.id);
    }
  }

  private forceFinalizeSkippedSession(sessionId: string): void {
    const session = this.sessions().find((s) => s.id === sessionId);
    if (!session) return;
    const storedAnswers = session.pendingAnswers ?? [];
    const answers = storedAnswers.filter(
      (a) => a.value.trim().length > 0 || a.skipped,
    );
    const pendingQuestions = session.pendingQuestions ?? [];
    const turns = session.turns ?? [];
    const firstNonSummaryUserTurn = turns.find(
      (t) => t.role === 'user' && !t.text.trimStart().startsWith('My answers:'),
    );
    const originalUserPrompt =
      firstNonSummaryUserTurn && firstNonSummaryUserTurn.role === 'user'
        ? firstNonSummaryUserTurn.text
        : undefined;
    const fallback = buildFallbackSummaryAndInstruction({
      userPrompt: originalUserPrompt,
      answers,
      questions: pendingQuestions,
    });
    this.store.appendRefinementChatTurn(sessionId, {
      role: 'assistant',
      kind: 'message',
      text: fallback.summary,
      at: new Date().toISOString(),
    });
    this.store.submitRefinementChatAnswers(sessionId, fallback.instruction);
  }

  protected async sendPrompt(): Promise<void> {
    const plan = this.store.plan();
    const text = this.draft().trim();
    if (!plan) return;
    if (!text) {
      this.store.setError({
        type: 'stage_failed',
        stage: 'tail',
        message: 'Type a refinement request before sending.',
      });
      return;
    }
    if (this.store.refinementChat.status() === 'thinking') return;

    let session = this.activeSession();
    if (!session) {
      const sessions = this.sessions();
      if (sessions.length === 0) {
        this.store.startRefinementChat();
      } else {
        this.store.setActiveRefinementChat(sessions[sessions.length - 1].id);
      }
      session = this.activeSession();
      if (!session) return;
    }

    const userTurn: RefinementChatTurn = {
      role: 'user',
      text,
      at: new Date().toISOString(),
    };
    this.store.appendRefinementChatTurn(session.id, userTurn);
    this.store.setRefinementChatDraft('');
    this.draft.set('');
    this.store.setRefinementChatStatus('thinking');

    try {
      const response = await this.chatService.consult({
        plan,
        userPrompt: text,
        history: this.refreshedTurns(session.id),
      });
      await this.handleResponse(session.id, response, {
        userPrompt: text,
      });
    } catch (err) {
      this.completeWithFallback(session.id, {
        userPrompt: text,
      });
    }
  }

  protected async submitAnswersAndContinue(): Promise<void> {
    const session = this.activeSession();
    const plan = this.store.plan();
    if (!session || !plan) return;
    if (session.status !== 'awaiting_answers') return;
    if (this.store.refinementChat.status() === 'thinking') return;

    const draft = this.freeTextDraft().trim();
    const currentQuestion = this.currentQuestion();
    if (currentQuestion && draft) {
      this.store.setRefinementChatAnswer(session.id, currentQuestion.id, draft);
      this.freeTextDraft.set('');
    }

    const latestSession = this.sessions().find((s) => s.id === session.id);
    const storedAnswers = latestSession?.pendingAnswers ?? [];
    const answers = storedAnswers.filter(
      (a) => a.value.trim().length > 0 || a.skipped,
    );
    if (answers.length === 0) return;

    const pendingQuestions =
      latestSession?.pendingQuestions ?? session.pendingQuestions ?? [];

    const roundSnapshot: QaRoundSnapshot = {
      entries: answers.map((answer, index) => {
        const question = pendingQuestions.find((q) => q.id === answer.questionId);
        return {
          questionId: answer.questionId,
          question: question?.question ?? answer.questionId,
          value: answer.skipped ? '— skipped —' : answer.value,
          skipped: answer.skipped,
          index,
        };
      }),
      total: pendingQuestions.length,
    };

    const latestUserTurn = [...(latestSession?.turns ?? session.turns)]
      .reverse()
      .find((t) => t.role === 'user');
    const summaryTurnAt = new Date().toISOString();
    const summaryTurn: RefinementChatTurn = {
      role: 'user',
      text: formatAnswersSummary(answers, pendingQuestions),
      at: summaryTurnAt,
    };
    this.store.appendRefinementChatTurn(session.id, summaryTurn);
    this.qaRounds.update((prev) => {
      const next = new Map(prev);
      next.set(summaryTurnAt, roundSnapshot);
      return next;
    });
    this.store.setRefinementChatStatus('thinking');

    try {
      const response = await this.chatService.consult({
        plan,
        userPrompt: latestUserTurn?.text ?? '',
        history: this.refreshedTurns(session.id),
        pendingAnswers: answers,
      });
      await this.handleResponse(session.id, response, {
        userPrompt: latestUserTurn?.text,
        answers,
        questions: pendingQuestions,
      });
    } catch (err) {
      this.completeWithFallback(session.id, {
        userPrompt: latestUserTurn?.text,
        answers,
        questions: pendingQuestions,
      });
    }
  }

  protected clearAll(): void {
    const sessions = this.sessions();
    if (sessions.length === 0) return;
    this.qaRounds.set(new Map());
    this.draft.set('');
    this.store.clearAllRefinementChats();
  }

  protected qaRoundFor(turnAt: string): QaRoundSnapshot | null {
    return this.qaRounds().get(turnAt) ?? null;
  }

  protected async copyInstruction(instruction: string): Promise<void> {
    if (!instruction) return;
    try {
      await navigator.clipboard.writeText(instruction);
    } catch {
      // Clipboard may be unavailable (e.g. insecure context); swallow silently.
    }
  }

  protected onTextareaKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void this.sendPrompt();
    }
  }

  protected trackByTurn(_: number, item: RefinementChatTurn): string {
    if (item.role === 'user') return `u:${item.at}`;
    if (item.kind === 'message') return `m:${item.at}`;
    if (item.kind === 'questions') return `q:${item.at}`;
    return `f:${item.at}`;
  }

  private async handleResponse(
    sessionId: string,
    response: RefinementChatLlmResponse,
    context: {
      userPrompt?: string;
      answers?: { questionId: string; value: string; skipped: boolean }[];
      questions?: { id: string; question: string }[];
    } = {},
  ): Promise<void> {
    if (response.decision === 'ask') {
      const questions = response.questions ?? [];
      if (questions.length === 0) {
        this.completeWithFallback(sessionId, context);
        return;
      }
      this.store.setRefinementChatQuestions(sessionId, questions);
      this.store.setRefinementChatStatus('asking');
      return;
    }

    const session = this.sessions().find((s) => s.id === sessionId);
    if (!session) return;

    const llmSummary = (response.summary ?? response.rationale ?? '').trim();
    const llmInstruction = (response.instruction ?? '').trim();
    const fallback = buildFallbackSummaryAndInstruction(context);
    const summary = llmSummary || fallback.summary;
    const instruction = llmInstruction || fallback.instruction;

    this.store.appendRefinementChatTurn(sessionId, {
      role: 'assistant',
      kind: 'message',
      text: summary,
      at: new Date().toISOString(),
    });
    this.store.submitRefinementChatAnswers(sessionId, instruction);
  }

  private completeWithFallback(
    sessionId: string,
    context: {
      userPrompt?: string;
      answers?: { questionId: string; value: string; skipped: boolean }[];
      questions?: { id: string; question: string }[];
    },
  ): void {
    const fallback = buildFallbackSummaryAndInstruction(context);
    this.store.appendRefinementChatTurn(sessionId, {
      role: 'assistant',
      kind: 'message',
      text: fallback.summary,
      at: new Date().toISOString(),
    });
    this.store.submitRefinementChatAnswers(sessionId, fallback.instruction);
  }

  private refreshedTurns(sessionId: string): RefinementChatTurn[] {
    const session = this.sessions().find((s) => s.id === sessionId);
    return session?.turns ? [...session.turns] : [];
  }
}

function formatAnswersSummary(
  answers: { questionId: string; value: string; skipped: boolean }[],
  questions: { id: string; question: string }[],
): string {
  const lines: string[] = [];
  for (const answer of answers) {
    const question = questions.find((q) => q.id === answer.questionId);
    const label = question?.question ?? answer.questionId;
    const value = answer.skipped ? '(skipped)' : answer.value.trim();
    lines.push(`- ${label}: ${value}`);
  }
  return `My answers:\n${lines.join('\n')}`;
}

function buildFallbackSummaryAndInstruction(context: {
  userPrompt?: string;
  answers?: { questionId: string; value: string; skipped: boolean }[];
  questions?: { id: string; question: string }[];
}): { summary: string; instruction: string } {
  const trimmedAnswers = (context.answers ?? []).filter(
    (a) => !a.skipped && a.value.trim().length > 0,
  );
  const questions = context.questions ?? [];
  const questionById = new Map(questions.map((q) => [q.id, q.question]));

  const answerFragments: string[] = [];
  for (const answer of context.answers ?? []) {
    if (answer.skipped) continue;
    const value = answer.value.trim();
    if (!value) continue;
    const label = questionById.get(answer.questionId) ?? answer.questionId;
    answerFragments.push(`${truncate(label, 40)} → ${value}`);
  }

  const prompt = (context.userPrompt ?? '').trim();
  const promptSubject = prompt
    ? truncate(prompt, 60)
    : trimmedAnswers.length > 0
      ? 'your refinement answers'
      : 'your refinement request';

  const instructionBase =
    answerFragments.length > 0
      ? `Apply based on user preferences: ${answerFragments.join('; ')}.`
      : prompt
        ? `Apply this refinement to the plan: ${prompt}.`
        : 'Apply the latest refinement to the plan.';

  const summary =
    answerFragments.length > 0
      ? `Based on your answers, I'll prepare an update that addresses: ${promptSubject}. Click Regenerate above to apply these changes to the plan.`
      : `I have what I need to act on: ${promptSubject}. Click Regenerate above to apply the change.`;

  return { summary, instruction: instructionBase.slice(0, 280) };
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1)}…`;
}

function labelForStatus(status: RefinementChatSession['status']): string {
  switch (status) {
    case 'open':
      return 'Open';
    case 'awaiting_answers':
      return 'Awaiting answers';
    case 'ready':
      return 'Ready to apply';
    case 'applied':
      return 'Applied';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status;
  }
}