import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { MessageModule } from 'primeng/message';
import { TabsModule } from 'primeng/tabs';
import { ProjectStore } from '../../core/project.store';
import { ExportJsonComponent } from './json/export-json.component';
import { ExportPdfComponent } from './pdf/export-pdf.component';
import { ExportZipComponent } from './zip/export-zip.component';

type ExportTab = 'zip' | 'json' | 'pdf';

@Component({
  selector: 'app-export-workspace',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MessageModule,
    TabsModule,
    ExportZipComponent,
    ExportJsonComponent,
    ExportPdfComponent,
  ],
  template: `
    <section class="workspace-stack">
      <section class="card workspace-header">
        <div class="workspace-header-info">
          <h2>Export</h2>
          <p class="subtitle">
            Download the active plan as a zip of markdown docs, a single JSON file, or a rendered PDF.
          </p>
        </div>
      </section>

      @if (store.plan()) {
        <p-tabs [value]="active()" (valueChange)="active.set($any($event))">
          <p-tablist>
            <p-tab value="zip">
              <i class="pi pi-file-archive"></i>
              spec-kit Export
            </p-tab>
            <p-tab value="json">
              <i class="pi pi-file-export"></i>
              Internal Plan
            </p-tab>
            <p-tab value="pdf">
              <i class="pi pi-file-pdf"></i>
              PDF
            </p-tab>
          </p-tablist>
          <p-tabpanels>
            <p-tabpanel value="zip">
              <app-export-zip />
            </p-tabpanel>
            <p-tabpanel value="json">
              <app-export-json />
            </p-tabpanel>
            <p-tabpanel value="pdf">
              <app-export-pdf />
            </p-tabpanel>
          </p-tabpanels>
        </p-tabs>
      } @else {
        <p-message severity="info" styleClass="w-full">
          Generate a plan in Planner first, then return here to export it.
        </p-message>
      }
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
export class ExportWorkspaceComponent {
  protected readonly store = inject(ProjectStore);
  protected readonly active = signal<ExportTab>('zip');

  constructor() {
    // Keep the user on the PDF tab while (and after) PDF generation runs, even
    // if the tab gets recreated by PrimeNG or by a brief @if flicker. The PDF
    // tab is the only place that shows the live progress, the stats panel,
    // and any error from the export pipeline.
    effect(() => {
      const isPdfRun = this.store.isGenerating() && this.store.pdfTokenStats() !== null;
      if (isPdfRun) {
        this.active.set('pdf');
      }
    });
  }
}
