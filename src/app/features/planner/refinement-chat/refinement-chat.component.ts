import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ProgressBarModule } from 'primeng/progressbar';
import { TextareaModule } from 'primeng/textarea';
import { ProjectStore } from '../../../core/project.store';
import { REFINE_MORE_QUESTION_ID } from '../../../core/refinement/refinement.constants';
import type { RefinementQuestion } from '../../../core/refinement/refinement.schema';

@Component({
  selector: 'app-refinement-chat',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonModule, MessageModule, ProgressBarModule, TextareaModule],
  templateUrl: './refinement-chat.component.html',
  styleUrl: './refinement-chat.component.scss',
})
export class RefinementChatComponent {
  protected readonly store = inject(ProjectStore);
  protected readonly otherMode = signal(false);

  protected readonly currentQuestion = computed<RefinementQuestion | null>(() => {
    const questions = this.store.refinement.questions();
    return questions[this.store.refinement.currentIndex()] ?? null;
  });

  protected readonly history = computed(() => {
    const questions = this.store.refinement.questions();
    const answers = this.store.refinement.answers();
    const index = this.store.refinement.currentIndex();
    const seen = Math.min(answers.length, index);
    return answers.slice(0, seen).map((answer, i) => {
      const question = questions[i];
      return {
        question: question?.question ?? answer.questionId,
        value: answer.skipped ? '— skipped —' : answer.value,
        skipped: answer.skipped,
      };
    });
  });

  protected readonly canSubmit = computed(
    () => this.store.refinement.draftValue().trim().length > 0,
  );

  protected readonly progress = computed(() => {
    const total = this.store.refinement.questions().length;
    return total === 0 ? 0 : (this.store.refinement.currentIndex() / total) * 100;
  });

  protected readonly isRefineMoreQuestion = computed(
    () => this.currentQuestion()?.id === REFINE_MORE_QUESTION_ID,
  );

  constructor() {
    effect(() => {
      this.store.refinement.status();
      this.store.refinement.currentIndex();
      untracked(() => this.otherMode.set(false));
    });
  }

  protected selectOption(option: string): void {
    this.otherMode.set(false);
    this.store.setRefinementDraft(option);
  }

  protected showOther(): void {
    this.otherMode.set(true);
    this.store.setRefinementDraft('');
  }

  protected onDraftInput(event: Event): void {
    this.store.setRefinementDraft((event.target as HTMLTextAreaElement).value);
  }

  protected submitAnswer(): void {
    const question = this.currentQuestion();
    const value = this.store.refinement.draftValue().trim();
    if (!question || !value) return;
    this.store.submitRefinementAnswer({ questionId: question.id, value, skipped: false });
  }

  protected skipQuestion(): void {
    this.store.skipRefinementQuestion();
  }
}
