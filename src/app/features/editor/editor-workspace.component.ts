import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { Router } from '@angular/router';
import { TooltipModule } from 'primeng/tooltip';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ProjectStore } from '../../core/project.store';
import { GenerationAbortService } from '../../core/generation-abort.service';
import { LLM_FACTORY, LLM_PROVIDERS } from '../../core/llm-provider';
import { estimateTokensForText } from '../../core/token-estimator';
import { RunStreamHost } from '../../core/streaming/run-stream-host.service';
import { PlannerGraphService } from '../../core/planner-graph.service';
import { GeneratePromptInput } from '../../core/prompt-builder.service';
import type { RefinementInstructionBlock } from '../../core/prompt-builder.service';
import type { UserEditSummary } from '../../core/diff/user-edit-summary';
import { Plan } from '../../core/plan.schema';
import { PlannerError } from '../../core/planner-error.model';
import { PlanReviewComponent } from '../planner/plan-review.component';

function deriveInputFromPlan(plan: Plan): GeneratePromptInput {
  return {
    title: plan.meta.title,
    idea: plan.meta.userIdea?.trim() || plan.meta.summary,
    technicalConstraints: '',
    nfrs: '',
    hints: '',
    contextAttachments: [],
  };
}

@Component({
  selector: 'app-editor-workspace',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonModule, MessageModule, TooltipModule, PlanReviewComponent],
  template: `
    <section class="workspace-stack">
      <section class="card workspace-header">
        <div class="workspace-header-info">
          <h2>Editor</h2>
          <p class="subtitle">
            Review, edit, visualize, and save your generated architecture plan.
          </p>
        </div>

        @if (store.plan()) {
          <div class="workspace-toolbar" role="toolbar" aria-label="Editor actions">
            <p-button
              label="Regenerate"
              icon="pi pi-refresh"
              [severity]="canRegenerate() ? 'success' : 'secondary'"
              [disabled]="!canRegenerate()"
              [pTooltip]="regenerateTooltip()"
              tooltipPosition="bottom"
              data-testid="regenerate-plan-button"
              (onClick)="startRegenerate()"
            />
            <p-button
              [label]="isCurrentPlanSaved() ? 'Saved' : 'Save Plan'"
              [icon]="isCurrentPlanSaved() ? 'pi pi-check' : 'pi pi-bookmark'"
              [severity]="isCurrentPlanSaved() ? 'success' : 'secondary'"
              (onClick)="saveCurrentPlan()"
            />
          </div>
        }
      </section>

      @if (store.hasPlan()) {
        @if (store.isGenerating()) {
          <div class="regenerating-sticky" role="status" aria-live="assertive" data-testid="regenerating-indicator">
            <span class="regenerating-sticky-spinner" aria-hidden="true"></span>
            <span class="regenerating-sticky-text">
              Regenerating with your edits — please wait.
            </span>
          </div>
        }
        <section class="card editor-shell">
          @if (store.isGenerating()) {
            <div class="regenerating-banner" role="status" aria-live="polite">
              <span class="regenerating-spinner" aria-hidden="true"></span>
              <span class="regenerating-text">
                Regenerating plan in the background — the previous plan is still editable below.
              </span>
            </div>
          }
          @if (regenerateError(); as err) {
            <div class="regenerate-error" role="alert" aria-live="assertive">
              <strong>Regeneration did not change the plan.</strong>
              <span>{{ err.message }}</span>
              <p-button
                label="Dismiss"
                icon="pi pi-times"
                severity="secondary"
                size="small"
                [text]="true"
                (onClick)="dismissRegenerateError()"
              />
            </div>
          }
          <app-plan-review />
        </section>
      } @else {
        <p-message severity="info" styleClass="w-full">
          Generate a plan in Planner first, then return here to review and edit it.
        </p-message>
      }
    </section>
  `,
  styleUrl: './editor-workspace.component.scss',
})
export class EditorWorkspaceComponent {
  protected readonly store = inject(ProjectStore);
  private readonly streamHost = inject(RunStreamHost);
  private readonly plannerGraph = inject(PlannerGraphService);
  private readonly llmFactory = inject(LLM_FACTORY);
  private readonly router = inject(Router);
  private readonly generationAbort = inject(GenerationAbortService);

  protected readonly isCurrentPlanSaved = this.store.isCurrentPlanSaved;

  protected readonly hasChatInstruction = computed(() => {
    const plan = this.store.plan();
    if (!plan) return false;
    return (plan.refinementChats ?? []).some(
      (session) => (session.finalInstruction ?? '').trim().length > 0,
    );
  });

  protected readonly canRegenerate = computed(
    () =>
      !this.store.isGenerating() &&
      this.store.hasPlan() &&
      (this.store.hasUserChanges() || this.hasChatInstruction()),
  );

  protected readonly regenerateError = this.store.regenerateError;

  protected dismissRegenerateError(): void {
    this.store.clearRegenerateError();
  }

  protected readonly regenerateTooltip = computed(() => {
    if (this.store.isGenerating()) return 'Generation in progress…';
    if (!this.store.hasPlan()) return 'Generate a plan first.';
    if (!this.store.hasUserChanges() && !this.hasChatInstruction()) {
      return 'Edit the plan or refine with AI to enable regeneration.';
    }
    return 'Regenerate plan from existing edits or chat instruction';
  });

  protected saveCurrentPlan(): void {
    const plan = this.store.plan();
    if (!plan) return;
    this.store.savePlan({
      id: crypto.randomUUID(),
      title: plan.meta.title,
      savedAt: new Date().toISOString(),
      model: plan.meta.model,
      tokenStats: this.store.tokenStats(),
      plan,
      lastOriginalInput: this.store.lastOriginalInput(),
    });
  }

  protected async startRegenerate(): Promise<void> {
    // Flush any focused form field before evaluating canRegenerate so a typed-
    // but-not-blurred edit on Plan Fields (which only commits on blur) counts
    // as a user change. Otherwise the button stays gray and the click looks
    // like nothing happened (memory regenerate.idea_change_not_picked_up).
    const active = (typeof document !== 'undefined'
      ? document.activeElement
      : null) as (HTMLElement & { blur?: () => void }) | null;
    if (active && typeof active.blur === 'function' && active !== document.body) {
      active.blur();
    }
    if (!this.canRegenerate()) return;
    const plan = this.store.plan();
    if (!plan) return;
    const capturedSummary = this.store.captureUserEditSummary();
    const chatInstruction = this.collectFullRefinementHistory(plan);
    if (!capturedSummary && !chatInstruction) {
      this.store.failRegenerate({
        type: 'auth',
        message: 'Nothing to regenerate — edit the plan or refine with AI first.',
      });
      return;
    }
    const summary = capturedSummary ?? emptyUserEditSummary();

    const cfg = this.store.config();
    const descriptor = LLM_PROVIDERS[cfg.provider];
    const slot = cfg.providerConfigs[cfg.provider];
    const model = slot.selectedModel.trim();
    if (!model) {
      this.store.failRegenerate({
        type: 'auth',
        message: 'Select a model in Config before regenerating.',
      });
      return;
    }
    const apiKey = this.store.apiKey().trim();
    if (descriptor.requiresApiKey && !apiKey) {
      this.store.failRegenerate({
        type: 'auth',
        message: `Set your ${descriptor.apiKeyLabel} in Config before regenerating.`,
      });
      return;
    }
    const key = descriptor.requiresApiKey ? apiKey : 'lm-studio';
    const baseInput = this.store.lastOriginalInput() ?? deriveInputFromPlan(plan);
    const techHints = plan.meta.technologyHints?.trim() ?? '';
    const originalInput = techHints
      ? { ...baseInput, hints: techHints }
      : baseInput;
    this.store.setLastOriginalInput(originalInput);

    const startedAtIso = new Date().toISOString();
    const generatedAtIso = startedAtIso;
    const abortController = new AbortController();
    this.generationAbort.setActive(abortController);

    // Reset all live state BEFORE navigating so the planner renders with zeros
    // on first paint instead of flashing the previous run's token counts.
    this.store.startRegenerate();
    this.store.setError(null);
    this.store.setStreamBuffer('');
    this.store.clearActivities();
    this.store.clearDiagramAudit();
    this.store.setTokenStats({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      model,
      generatedAt: generatedAtIso,
      startedAt: startedAtIso,
      llmCalls: 0,
      errors: 0,
      retries: 0,
      repairs: 0,
    });

    this.streamHost.startRun({
      onFinished: () => {
        // No-op: cleanup is owned by the explicit `finally` block below.
        // The closure was previously dropped when the editor destroyed the
        // RunStreamHost lifecycle mid-navigation, leaving isGenerating stuck
        // on true. Reset is now unconditional and component-local.
      },
    });

    // Navigate to /planner so the user sees the regenerating view (matching
    // the initial-generate UX). Streaming tokens, activity panel, and the
    // live stats card all live on /planner. On success/error the flow
    // navigates back to /editor below. (memory regenerate.navigate_to_planner)
    void this.router.navigate(['/planner']);

    try {
      const chat = this.llmFactory(cfg, key, { streaming: true });

      let llmCalls = 0;
      let promptTokens = 0;
      let completionTokens = 0;
      let errorCount = 0;
      let retryCount = 0;
      let repairCount = 0;

      const updateLive = (): void => {
        this.store.setTokenStats({
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          model,
          generatedAt: generatedAtIso,
          startedAt: startedAtIso,
          llmCalls,
          errors: errorCount,
          retries: retryCount,
          repairs: repairCount,
        });
      };

      const wrappedInvoker = this.streamHost.createWrappedInvoker({
        chat,
        signal: abortController.signal,
        appendStream: (chunk) => this.store.appendStream(chunk),
        setStreamBuffer: (buffer) => this.store.setStreamBuffer(buffer),
        getStreamBuffer: () => this.store.streamBuffer(),
        estimatePromptTokens: (prompt) => estimateTokensForText(prompt),
        onChunk: (stats) => {
          llmCalls = stats.llmCalls;
          promptTokens = stats.promptTokens;
          completionTokens = stats.completionTokens;
          updateLive();
        },
      });

      const regenerateResult = await this.plannerGraph.regenerateSectioned({
        currentPlan: plan,
        originalInput,
        editSummary: summary,
        llmInvoker: wrappedInvoker,
        signal: abortController.signal,
        refinementInstruction: this.collectFullRefinementHistory(plan),
        onError: (event) => {
          if (event.kind === 'invalid_json' || event.kind === 'schema_validation' || event.kind === 'provider_error') {
            errorCount += 1;
          } else if (event.kind === 'retry') {
            retryCount += 1;
          } else if (event.kind === 'repair') {
            repairCount += 1;
          }
          updateLive();
        },
      });

      const completion = Math.max(0, Math.ceil((this.store.streamBuffer() ?? '').length / 4));
      const finalStats = {
        promptTokens,
        completionTokens: completion,
        totalTokens: promptTokens + completion,
        model,
        generatedAt: regenerateResult.plan.meta.generatedAt,
        startedAt: startedAtIso,
        llmCalls,
        errors: errorCount,
        retries: retryCount,
        repairs: repairCount,
      };

      this.store.setTokenStats(finalStats);
      this.store.setPlan(regenerateResult.plan, finalStats, false);
      this.store.clearAllRefinementChats();
      this.store.clearActivities();
      void this.router.navigate(['/editor']);
    } catch (err) {
      const failure: PlannerError =
        err && typeof err === 'object' && 'type' in err
          ? (err as PlannerError)
          : {
              type: 'stage_failed',
              stage: 'merge',
              message: err instanceof Error ? err.message : String(err),
            };
      this.store.failRegenerate(failure);
      this.store.clearActivities();
      void this.router.navigate(['/editor']);
    } finally {
      this.store.setIsGenerating(false);
      this.store.clearActivities();
      this.streamHost.markRunFinished();
      this.generationAbort.setActive(null);
    }
  }

  private collectFullRefinementHistory(plan: Plan): RefinementInstructionBlock | undefined {
    const sessions = plan.refinementChats ?? [];
    if (sessions.length === 0) return undefined;

    const FORWARDABLE_STATUSES = ['ready', 'applied', 'awaiting_answers'] as const;
    const usable = sessions.filter((session) =>
      (FORWARDABLE_STATUSES as readonly string[]).includes(session.status),
    );
    if (usable.length === 0) return undefined;

    const instructionParts: string[] = [];
    const answers: { questionId: string; value: string }[] = [];
    const transcript: { role: 'user' | 'assistant'; text: string; at?: string }[] = [];
    const seenAnswers = new Set<string>();
    let newestUserPrompt: string | undefined;
    let newestUserAt: string | undefined;
    let newestNonSummaryUserPrompt: string | undefined;
    let newestNonSummaryUserAt: string | undefined;

    const isSyntheticSummaryTurn = (text: string): boolean =>
      text.trimStart().startsWith('My answers:');

    for (const session of usable) {
      const instruction = session.finalInstruction?.trim();
      if (instruction) instructionParts.push(instruction);
      for (const answer of session.collectedAnswers ?? []) {
        if (!answer.value.trim() || answer.skipped) continue;
        if (seenAnswers.has(answer.questionId)) continue;
        seenAnswers.add(answer.questionId);
        answers.push({ questionId: answer.questionId, value: answer.value.trim() });
      }
      for (const turn of session.turns ?? []) {
        if (turn.role === 'user') {
          transcript.push({ role: 'user', text: turn.text, at: turn.at });
          if (!newestUserAt || turn.at > newestUserAt) {
            newestUserAt = turn.at;
            newestUserPrompt = turn.text;
          }
          if (!isSyntheticSummaryTurn(turn.text)) {
            if (!newestNonSummaryUserAt || turn.at > newestNonSummaryUserAt) {
              newestNonSummaryUserAt = turn.at;
              newestNonSummaryUserPrompt = turn.text;
            }
          }
        } else if (turn.kind === 'message') {
          transcript.push({ role: 'assistant', text: turn.text, at: turn.at });
        } else if (turn.kind === 'questions') {
          const qTexts = turn.questions
            .map((q) => q.question?.trim() || q.id)
            .filter(Boolean)
            .join(' | ');
          if (qTexts) {
            transcript.push({ role: 'assistant', text: `Q: ${qTexts}`, at: turn.at });
          }
        }
      }
    }

    const instruction = instructionParts.join('\n\n').trim();
    const userPrompt = newestNonSummaryUserPrompt ?? newestUserPrompt;
    if (!instruction && answers.length === 0 && !userPrompt && transcript.length === 0) {
      return undefined;
    }

    return {
      instruction,
      answers,
      userPrompt,
      chatTranscript: transcript,
    };
  }
}

function emptyUserEditSummary(): UserEditSummary {
  return {
    capturedAt: new Date().toISOString(),
    preservedFilePaths: [],
    addedElements: [],
    removedElements: [],
    fieldChanges: [],
    naturalLanguageDigest: '',
  };
}
