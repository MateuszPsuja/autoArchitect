import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ProjectStore } from '../../../core/project.store';
import { exportBaseName } from '../../../core/feature-slug';
import { hydratePlan } from '../../../core/hydration';
import { SavedPlanEntry } from '../../../core/saved-plan-entry.model';

type ImportStatus =
  | { kind: 'idle' }
  | { kind: 'success'; title: string }
  | { kind: 'error'; message: string };

@Component({
  selector: 'app-export-json',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonModule, MessageModule],
  template: `
    <section class="card export-shell" aria-labelledby="export-json-heading">
      <h3 id="export-json-heading">Internal Plan (.json)</h3>
      <p class="subtitle">
        The autoArchitect-native <code>plan.json</code> dump — preserves every
        field of the active plan (including any editor overrides and the
        per-component test specs). Use this to back up work-in-progress or to
        hand a plan to a teammate; it round-trips through the <strong>Import</strong>
        button below.
      </p>

      <div class="export-actions">
        <p-button
          label="Download plan.json"
          icon="pi pi-download"
          severity="secondary"
          [disabled]="!store.plan()"
          (onClick)="downloadJson()"
        />
        <p-button
          label="Import plan.json"
          icon="pi pi-upload"
          severity="secondary"
          [outlined]="true"
          (onClick)="openFilePicker()"
        />
        <input
          #fileInput
          type="file"
          accept="application/json,.json"
          hidden
          (change)="onFileSelected($event)"
        />
      </div>

      @if (status(); as s) {
        @if (s.kind === 'success') {
          <p-message severity="success" styleClass="w-full">
            Imported <strong>{{ s.title }}</strong>. The plan is now active —
            continue editing in the Editor tab.
          </p-message>
        } @else if (s.kind === 'error') {
          <p-message severity="error" styleClass="w-full">
            Could not import this file: {{ s.message }}
          </p-message>
        }
      }
    </section>
  `,
  styles: `
    .export-shell {
      display: grid;
      gap: 0.75rem;
      padding: 1rem;
    }

    .export-shell h3 {
      font-size: 1rem;
      font-weight: 600;
      margin: 0;
    }

    .subtitle {
      color: var(--text-color-secondary);
      font-size: 0.875rem;
      margin: 0;
    }

    .export-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }
  `,
})
export class ExportJsonComponent {
  protected readonly store = inject(ProjectStore);
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  protected readonly status = signal<ImportStatus>({ kind: 'idle' });

  protected downloadJson(): void {
    const plan = this.store.plan();
    if (!plan) return;
    const stamped = {
      ...plan,
      meta: { ...plan.meta, tokenStats: this.store.tokenStats() },
    };
    const blob = new Blob([JSON.stringify(stamped, null, 2)], { type: 'application/json' });
    triggerDownload(
      blob,
      `${exportBaseName(plan)}-plan.json`,
    );
  }

  protected openFilePicker(): void {
    this.fileInput()?.nativeElement.click();
  }

  protected async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const raw = await file.text();
      const result = hydratePlan(raw);
      if (!result.plan) {
        this.status.set({ kind: 'error', message: result.reason === 'invalid' ? 'file is not a valid plan.json export' : 'file contained no plan data' });
        return;
      }
      const stamped = applyTokenStats(result.plan, result.tokenStats);
      const entry: SavedPlanEntry = {
        id: `imported-${Date.now().toString(36)}`,
        title: stamped.meta.title,
        savedAt: new Date().toISOString(),
        model: stamped.meta.model,
        tokenStats: result.tokenStats,
        plan: stamped,
      };
      this.store.savePlan(entry);
      this.store.setPlan(stamped);
      this.status.set({ kind: 'success', title: stamped.meta.title });
    } catch (err) {
      this.status.set({
        kind: 'error',
        message: err instanceof Error ? err.message : 'unexpected error',
      });
    }
  }
}

function applyTokenStats<T extends { meta: { tokenStats?: unknown } }>(plan: T, stats: unknown): T {
  if (!stats) return plan;
  return { ...plan, meta: { ...plan.meta, tokenStats: stats } } as T;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

