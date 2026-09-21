import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { FileUploadModule } from 'primeng/fileupload';
import { MessageModule } from 'primeng/message';
import { ProjectStore } from '../../../core/project.store';
import { PlanSchemaService } from '../../../core/plan-schema.service';
import { Plan } from '../../../core/plan.schema';

const FILE_SIZE_LIMIT = 2_000_000;

@Component({
  selector: 'app-import-json',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonModule, ConfirmDialogModule, FileUploadModule, MessageModule],
  providers: [ConfirmationService],
  template: `
    <section class="card import-shell" aria-labelledby="import-json-heading">
      <h3 id="import-json-heading">JSON</h3>
      <p class="subtitle">
        Choose a <code>plan.json</code> exported from this app. The imported plan will
        replace the currently active plan.
      </p>

      <div class="import-source">
        <p-fileupload
          mode="basic"
          chooseLabel="Choose plan.json"
          accept="application/json,.json"
          [auto]="false"
          [maxFileSize]="2000000"
          chooseIcon="pi pi-upload"
          (onSelect)="onFileSelected($event)"
        />
      </div>

      @if (errorMessage(); as msg) {
        <p-message severity="error" styleClass="w-full import-error">
          {{ msg }}
        </p-message>
      }
    </section>

    <p-confirmDialog />
  `,
  styles: `
    .import-shell {
      display: grid;
      gap: 0.75rem;
      padding: 1rem;
    }

    .import-shell h3 {
      font-size: 1rem;
      font-weight: 600;
      margin: 0;
    }

    .subtitle {
      color: var(--text-color-secondary);
      font-size: 0.875rem;
      margin: 0;
    }

    .import-source {
      display: grid;
      gap: 0.5rem;
    }

    .import-error {
      margin-top: 0.25rem;
    }
  `,
})
export class ImportJsonComponent {
  private readonly store = inject(ProjectStore);
  private readonly confirmation = inject(ConfirmationService);
  private readonly router = inject(Router);

  protected readonly errorMessage = signal<string | null>(null);

  protected onFileSelected(event: { files?: File[]; currentFiles?: File[] }): void {
    const file = (event.currentFiles ?? event.files ?? [])[0];
    if (!file) return;
    if (file.size > FILE_SIZE_LIMIT) {
      this.errorMessage.set(
        `Selected file exceeds the ${FILE_SIZE_LIMIT.toLocaleString()} byte limit.`,
      );
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => {
      this.errorMessage.set('Could not read the selected file.');
    };
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      if (text.length > FILE_SIZE_LIMIT) {
        this.errorMessage.set(
          `Selected file exceeds the ${FILE_SIZE_LIMIT.toLocaleString()} byte limit.`,
        );
        return;
      }
      this.importFromText(text);
    };
    reader.readAsText(file);
  }

  protected importFromText(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? `File is not valid JSON: ${err.message}`
          : 'File is not valid JSON.';
      this.errorMessage.set(message);
      return;
    }

    if (!PlanSchemaService.isPlan(parsed)) {
      this.errorMessage.set('File is not a valid Plan artefact.');
      return;
    }

    if (this.store.hasUserChanges()) {
      this.confirmation.confirm({
        header: 'Replace the active plan?',
        message:
          'You have unsaved changes in the active plan. Importing will discard them and replace the active plan with the imported one. This cannot be undone.',
        icon: 'pi pi-exclamation-triangle',
        acceptLabel: 'Replace plan',
        rejectLabel: 'Cancel',
        acceptButtonStyleClass: 'p-button-primary',
        accept: () => this.applyPlan(parsed as Plan),
      });
      return;
    }

    this.applyPlan(parsed as Plan);
  }

  private applyPlan(plan: Plan): void {
    const stats = plan.meta.tokenStats ?? null;
    this.store.setPlan(plan, stats);
    this.store.snapshotGeneration(plan);
    this.errorMessage.set(null);
    void this.router.navigate(['/planner']);
  }
}