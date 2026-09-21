import { ChangeDetectionStrategy, Component, effect, inject, output, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { debounceTime } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TextareaModule } from 'primeng/textarea';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { GeneratePromptInput } from '../../core/prompt-builder.service';
import { ProjectStore } from '../../core/project.store';
import { ConstraintsFormComponent } from './constraints-form.component';
import { ContextAttachment } from '../../core/context-attachment.model';
import { ContextAttachmentsComponent } from './context-attachments.component';

@Component({
  selector: 'app-project-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    TextareaModule,
    ButtonModule,
    InputTextModule,
    ConstraintsFormComponent,
    ContextAttachmentsComponent,
  ],
  template: `
    <form class="form" [formGroup]="form" (ngSubmit)="submit()">
      <div style="display: flex; flex-direction: column; gap: 0.5rem; width: 100%;">
        <label for="title" class="field-label mb-2">Title</label>
        <input
          pInputText
          id="title"
          formControlName="title"
          autocomplete="off"
          class="w-full"
          placeholder="e.g. Acme Task Manager"
        />
      </div>

      <div style="display: flex; flex-direction: column; gap: 0.5rem; width: 100%;">
        <label for="idea" class="field-label mb-2">Application Idea</label>
        <textarea
          pTextarea
          id="idea"
          rows="4"
          formControlName="idea"
          autocomplete="off"
          class="w-full"
          placeholder="Describe the application you want to build&#8230;"
        ></textarea>
      </div>

      <app-constraints-form
        inputId="constraints"
        label="Technical Constraints"
        hint="Optional free-form context. Describe anything relevant, or leave blank for the architect to infer it."
        placeholder="Describe limits, policies, integrations, deployment context, or any other relevant notes&#8230;"
        [control]="form.controls.technicalConstraints"
      />

      <app-constraints-form
        inputId="nfrs"
        label="Non-Functional Requirements"
        hint="Optional free-form quality goals. Use any format, or leave blank to infer sensible requirements."
        placeholder="Describe performance, security, accessibility, scale, reliability, or other expectations&#8230;"
        [control]="form.controls.nfrs"
      />

      <app-constraints-form
        inputId="hints"
        label="Technology Hints"
        hint="Optional free-form preferences or existing stack. Leave blank for technology recommendations."
        placeholder="Describe preferred technologies, existing systems, versions, team skills, or any other context&#8230;"
        [control]="form.controls.hints"
      />

      <app-context-attachments
        [initialAttachments]="contextAttachments"
        (attachmentsChange)="onAttachmentsChanged($event)"
      />

      <div class="actions-row">
        <p-button
          type="button"
          label="Refine with questions"
          icon="pi pi-comments"
          severity="success"
          [outlined]="true"
          (onClick)="onRefine()"
          [disabled]="form.invalid || form.pending"
        />
        <p-button
          type="submit"
          label="Generate Plan"
          icon="pi pi-bolt"
          severity="success"
          [disabled]="form.invalid || form.pending"
        />
      </div>
    </form>
  `,
  styles: `
    :host {
      display: block;
    }

    .form {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .actions-row {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      justify-content: flex-end;
      margin-top: 0.5rem;
    }

    textarea {
      min-height: 6rem;
    }
  `,
})
export class ProjectInputComponent {
  private readonly fb = inject(FormBuilder);
  private readonly store = inject(ProjectStore);

  readonly generate = output<GeneratePromptInput>();
  readonly refine = output<GeneratePromptInput>();
  protected contextAttachments: ContextAttachment[] = [];

  protected readonly form = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(2)]],
    idea: ['', [Validators.required, Validators.minLength(20)]],
    technicalConstraints: [''],
    nfrs: [''],
    hints: [''],
  });

  protected submit(): void {
    const value = this.form.getRawValue();
    this.emitValue(value);
  }

  protected onRefine(): void {
    if (this.form.invalid || this.form.pending) {
      return;
    }
    const value = this.form.getRawValue();
    this.refine.emit(this.toPayload(value));
  }

  private emitValue(value: ReturnType<typeof this.form.getRawValue>): void {
    this.generate.emit(this.toPayload(value));
  }

  private toPayload(value: ReturnType<typeof this.form.getRawValue>): GeneratePromptInput {
    return {
      title: value.title.trim(),
      idea: value.idea.trim(),
      technicalConstraints: value.technicalConstraints.trim(),
      nfrs: value.nfrs.trim(),
      hints: value.hints.trim(),
      contextAttachments: this.contextAttachments,
    };
  }

  protected onAttachmentsChanged(attachments: ContextAttachment[]): void {
    this.contextAttachments = attachments;
    this.persistDraft();
  }

  constructor() {

    const pending = this.store.pendingInput?.() ?? null;
    if (pending) {
      this.form.controls.title.setValue(pending.title ?? '');
      this.form.controls.idea.setValue(pending.idea ?? '');
      this.form.controls.technicalConstraints.setValue(pending.technicalConstraints ?? '');
      this.form.controls.nfrs.setValue(pending.nfrs ?? '');
      this.form.controls.hints.setValue(pending.hints ?? '');
      this.contextAttachments = pending.contextAttachments ?? [];
    }

    this.form.valueChanges.pipe(debounceTime(400), takeUntilDestroyed()).subscribe((v) => {
      try {
        this.persistDraft();
      } catch {

      }
    });













    effect(() => {
      if (this.store.plannerResetTick() === 0) {
        return;
      }
      untracked(() => this.resetForm());
    });
  }

  protected resetForm(): void {
    this.form.reset({
      title: '',
      idea: '',
      technicalConstraints: '',
      nfrs: '',
      hints: '',
    });
    this.contextAttachments = [];



    this.persistDraft();
  }

  private persistDraft(): void {
    const v = this.form.getRawValue();
    this.store.setPendingInput({
      title: v.title ?? '',
      idea: v.idea ?? '',
      technicalConstraints: (v.technicalConstraints ?? '').trim(),
      nfrs: (v.nfrs ?? '').trim(),
      hints: (v.hints ?? '').trim(),
      contextAttachments: this.contextAttachments,
    });
  }
}
