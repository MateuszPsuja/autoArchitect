import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { ProjectStore } from '../../../core/project.store';
import { exportBaseName } from '../../../core/feature-slug';

@Component({
  selector: 'app-export-json',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonModule],
  template: `
    <section class="card export-shell" aria-labelledby="export-json-heading">
      <h3 id="export-json-heading">JSON</h3>
      <p class="subtitle">
        The autoArchitect-native <code>plan.json</code> dump — preserves every
        field of the active plan (including any editor overrides and the
        per-component test specs). Use this to back up work-in-progress or to
        hand a plan to a teammate.
      </p>

      <div class="export-actions">
        <p-button
          label="Download plan.json"
          icon="pi pi-download"
          severity="secondary"
          [disabled]="!store.plan()"
          (onClick)="downloadJson()"
        />
      </div>
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
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
