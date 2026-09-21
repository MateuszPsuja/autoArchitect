import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { StateExportService } from '../../core/state-export.service';

@Component({
  selector: 'app-workspace-snapshot',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonModule, ConfirmDialogModule],
  providers: [ConfirmationService],
  template: `
    <section class="card">
      <div class="card-header">
        <h2>Workspace Snapshot</h2>
      </div>
      <p class="help-text">
        Export your current configuration, active plan, and saved plans to a
        single CSV file. Importing replaces the current workspace after
        confirmation.
      </p>
      <div class="actions">
        <p-button
          type="button"
          label="Export CSV"
          icon="pi pi-download"
          severity="secondary"
          (onClick)="onExport()"
        />
        <p-button
          type="button"
          label="Import CSV"
          icon="pi pi-upload"
          severity="secondary"
          (onClick)="triggerImport(importInput)"
        />
        <input
          #importInput
          type="file"
          accept=".csv,text/csv"
          hidden
          (change)="onImportFile($event, importInput)"
        />
      </div>
      <p-confirmDialog />
    </section>
  `,
  styles: `
    :host {
      display: block;
    }

    .card {
      max-width: none;
      width: 100%;
    }

    .card-header {
      align-items: center;
      display: flex;
      justify-content: space-between;
      margin-bottom: 1.25rem;
    }

    .card-header h2 {
      font-size: 1.25rem;
      font-weight: 700;
      margin: 0;
    }

    .help-text {
      color: var(--text-color-secondary);
      font-size: 0.875rem;
      margin: 0 0 1rem;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
  `,
})
export class WorkspaceSnapshotComponent {
  private readonly stateExport = inject(StateExportService);
  private readonly confirmation = inject(ConfirmationService);

  protected onExport(): void {
    this.stateExport.downloadSnapshot();
  }

  protected triggerImport(input: HTMLInputElement): void {
    input.click();
  }

  protected onImportFile(event: Event, input: HTMLInputElement): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    input.value = '';
    if (!file) return;
    this.stateExport.importFromFile(file).then((snapshot) => {
      this.confirmation.confirm({
        header: 'Replace workspace?',
        message: 'Importing this snapshot replaces your current configuration, plan, and saved plans.',
        icon: 'pi pi-exclamation-triangle',
        accept: () => this.stateExport.applySnapshot(snapshot),
      });
    }).catch(() => undefined);
  }
}
