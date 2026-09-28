import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { OpenSpecExportService } from '../../../core/openspec-export.service';
import { ProjectStore } from '../../../core/project.store';
import { exportBaseName } from '../../../core/feature-slug';

@Component({
  selector: 'app-export-openspec',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonModule],
  template: `
    <section class="card export-shell" aria-labelledby="export-openspec-heading">
      <h3 id="export-openspec-heading">OpenSpec Export (.zip)</h3>

      <ul class="file-list">
        @for (file of files(); track file.path) {
          <li>
            <span class="file-path">{{ file.path }}</span>
          </li>
        } @empty {
          <li class="file-list-empty">No files to export.</li>
        }
      </ul>

      <div class="export-actions">
        <p-button
          label="Download .zip"
          icon="pi pi-download"
          severity="secondary"
          [loading]="exportingZip()"
          [disabled]="!store.plan()"
          (onClick)="downloadZip()"
        />
      </div>
    </section>
  `,
  styleUrl: './export-openspec.component.scss',
})
export class ExportOpenspecComponent {
  protected readonly store = inject(ProjectStore);
  private readonly exportService = inject(OpenSpecExportService);

  protected readonly exportingZip = signal(false);

  protected readonly files = computed(() => {
    const plan = this.store.plan();
    return plan ? this.exportService.listFiles(plan) : [];
  });

  protected downloadZip = async (): Promise<void> => {
    const plan = this.store.plan();
    if (!plan || this.exportingZip()) return;
    this.exportingZip.set(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    try {
      const blob = await this.exportService.buildZip(plan, this.store.markdownOverrides());
      triggerDownload(blob, `${exportBaseName(plan)}-OpenSpec.zip`);
    } finally {
      this.exportingZip.set(false);
    }
  };
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}