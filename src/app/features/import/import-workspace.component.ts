import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ImportJsonComponent } from './json/import-json.component';

@Component({
  selector: 'app-import-workspace',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ImportJsonComponent],
  template: `
    <section class="workspace-stack">
      <section class="card workspace-header">
        <div class="workspace-header-info">
          <h2>Import</h2>
          <p class="subtitle">
            Choose a <code>plan.json</code> exported from this app to replace the currently
            active plan.
          </p>
        </div>
      </section>

      <app-import-json />
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
export class ImportWorkspaceComponent {}