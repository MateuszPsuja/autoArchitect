import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ProjectStore } from '../../core/project.store';
import { GeneratePromptInput } from '../../core/prompt-builder.service';
import {
  RefinementService,
} from '../../core/refinement/refinement.service';
import type { RefinementAnswerContext } from '../../core/refinement/refinement.schema';
import { ProjectInputComponent } from '../project-input/project-input.component';
import { RefinementChatComponent } from './refinement-chat/refinement-chat.component';
import { GeneratePlanComponent } from './generate-plan.component';

type PlannerViewMode = 'idle' | 'generating' | 'done';

@Component({
  selector: 'app-planner-workspace',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    ButtonModule,
    MessageModule,
    ProjectInputComponent,
    RefinementChatComponent,
    GeneratePlanComponent,
  ],
  template: `
    <section class="workspace-stack">
      <section class="card workspace-header">
        <div class="workspace-header-info">
          <h2>Planner</h2>
          <p class="subtitle">Define your project inputs and generate an architecture plan.</p>
        </div>
      </section>

      @if (showConfigWarning()) {
        <p-message severity="warn" styleClass="w-full">
          Provider not fully configured —
          <a routerLink="/config" class="config-link">set up your API key and model</a>
          before generating.
        </p-message>
      }

      <section class="card planner-card">
        @if (store.refinement.status() === 'loading_questions' || store.refinement.status() === 'asking') {
          <app-refinement-chat />
        }
        @if (store.refinement.status() === 'error') {
          <section class="refinement-error" role="alert" aria-live="polite" data-testid="refinement-error">
            <div class="refinement-error-info">
              <span class="eyebrow">Refinement unavailable</span>
              <h3>We couldn't load refinement questions.</h3>
              <p class="refinement-error-message">
                {{ store.refinement.error() || 'The provider did not return a usable response.' }}
              </p>
              <p class="refinement-error-hint">
                Check your provider configuration, then retry — or generate the plan directly.
              </p>
            </div>
            <div class="refinement-error-actions">
              <p-button
                type="button"
                label="Back to form"
                icon="pi pi-arrow-left"
                severity="secondary"
                [outlined]="true"
                (onClick)="onBackToForm()"
                data-testid="refinement-error-back"
              />
              <p-button
                type="button"
                label="Generate plan anyway"
                icon="pi pi-bolt"
                severity="success"
                [outlined]="true"
                (onClick)="onSkipToGenerate()"
                data-testid="refinement-error-skip"
              />
              <p-button
                type="button"
                label="Try refinement again"
                icon="pi pi-refresh"
                severity="success"
                (onClick)="onRetryRefinement()"
                data-testid="refinement-error-retry"
              />
            </div>
          </section>
        }
        @if (showForm()) {
          <app-project-input
            (generate)="onGenerateImmediate($event)"
            (refine)="onRefineRequested($event)"
          />
        }
        @if (viewMode() !== 'idle' || store.refinement.status() === 'completed') {
          <app-generate-plan />
        }
      </section>
    </section>
  `,
  styles: `
    .workspace-stack {
      display: grid;
      gap: 1.25rem;
    }

    .workspace-header {
      align-items: flex-start;
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
      justify-content: space-between;
    }

    h2 {
      font-size: 1.25rem;
      font-weight: 700;
      margin: 0 0 0.25rem;
    }

    .subtitle {
      color: var(--text-color-secondary);
      font-size: 0.875rem;
      margin: 0;
    }

    .config-link {
      color: inherit;
      font-weight: 600;
      text-decoration: underline;
    }

    .planner-card {
      display: grid;
      gap: 1rem;
      padding: 1rem;
    }

    .muted {
      color: var(--text-muted);
      font-size: 0.875rem;
      margin: 0;
    }

    .refinement-error {
      align-items: flex-start;
      background: var(--surface-ground);
      border: 1px solid var(--red-500, #ef4444);
      border-radius: var(--radius-md);
      display: flex;
      flex-direction: column;
      gap: 1rem;
      padding: 1.25rem;
    }

    .refinement-error-info {
      display: grid;
      gap: 0.5rem;
    }

    .refinement-error .eyebrow {
      color: var(--red-500, #ef4444);
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .refinement-error h3 {
      font-size: 1.05rem;
      margin: 0;
    }

    .refinement-error-message {
      color: var(--text-color);
      font-size: 0.9rem;
      margin: 0;
      white-space: pre-wrap;
    }

    .refinement-error-hint {
      color: var(--text-color-secondary);
      font-size: 0.85rem;
      margin: 0;
    }

    .refinement-error-actions {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      justify-content: flex-end;
    }

    @media (max-width: 768px) {
      .workspace-header {
        flex-direction: column;
      }

      .workspace-stack {
        padding: 1rem;
      }
    }
  `,
})
export class PlannerWorkspaceComponent {
  protected readonly store = inject(ProjectStore);
  private readonly refinementService = inject(RefinementService);
  protected readonly viewChildGenerate = viewChild<GeneratePlanComponent>(GeneratePlanComponent);

  protected readonly viewMode = computed<PlannerViewMode>(() => {
    if (this.store.isGenerating()) return 'generating';
    if (this.store.plan()) return 'done';
    if (this.store.error()) return 'done';
    return 'idle';
  });

  protected readonly showForm = computed(() => {
    if (this.store.isGenerating()) return false;
    if (this.store.plan()) return false;
    if (this.store.refinement.status() !== 'idle') return false;
    return true;
  });

  protected readonly showConfigWarning = computed(() => {
    const cfg = this.store.config();
    const slot = cfg.providerConfigs[cfg.provider];
    const hasKey = cfg.provider === 'lmstudio' || !!this.store.apiKey();
    return !hasKey || !slot.selectedModel;
  });

  public onRefineRequested(inputValue: GeneratePromptInput): void {
    this.store.setPendingInput(inputValue);
    this.store.setLastOriginalInput(inputValue);
    this.store.startRefinement(inputValue);
    void this.loadRefinementQuestions(inputValue);
  }

  public onGenerateImmediate(inputValue: GeneratePromptInput): void {
    this.store.setPendingInput(inputValue);
    this.store.setLastOriginalInput(inputValue);
    this.store.skipRefinement();
  }

  private async loadRefinementQuestions(
    input: GeneratePromptInput,
    priorAnswers?: RefinementAnswerContext[],
  ): Promise<void> {
    try {
      const questions = await this.refinementService.suggestQuestions(
        input,
        undefined,
        priorAnswers,
      );
      this.store.setRefinementQuestions(questions);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Refinement question generation failed. Check your provider configuration and try again.';
      this.store.setRefinementError(message);
    }
  }

  protected onRetryRefinement(): void {
    const input = this.store.refinement.originalInput();
    if (!input) {
      this.store.clearRefinement();
      return;
    }
    this.store.startRefinement(input);
    void this.loadRefinementQuestions(input);
  }

  protected onSkipToGenerate(): void {
    this.store.skipRefinement();
  }

  protected onBackToForm(): void {
    this.store.clearRefinement();
  }

  private buildPriorAnswers(
    questions: ReadonlyArray<{ id: string; question: string }>,
    answers: ReadonlyArray<{ questionId: string; value: string; skipped: boolean }>,
  ): RefinementAnswerContext[] {
    const out: RefinementAnswerContext[] = [];
    for (const answer of answers) {
      const question = questions.find((q) => q.id === answer.questionId);
      if (!question) continue;
      out.push({
        question: question.question,
        value: answer.value,
        skipped: answer.skipped,
      });
    }
    return out;
  }

  constructor() {
    effect(() => {
      const refinement = this.store.refinement;
      if (
        refinement.status() === 'loading_questions' &&
        refinement.pendingRefineMore()
      ) {
        const input = refinement.originalInput();
        if (!input) return;
        const questions = refinement.questions();
        const answers = refinement.answers();
        const priorAnswers = this.buildPriorAnswers(questions, answers);
        void this.loadRefinementQuestions(input, priorAnswers);
      }
    });
  }
}
