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
  styleUrl: './import-workspace.component.scss',
})
export class ImportWorkspaceComponent {}