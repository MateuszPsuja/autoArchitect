import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { ExportService } from '../../../core/export.service';
import { MarkdownRendererService } from '../../../core/markdown-renderer.service';
import { ProjectStore } from '../../../core/project.store';
import { exportBaseName } from '../../../core/feature-slug';

@Component({
  selector: 'app-export-zip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonModule],
  template: `
    <section class="card export-shell" aria-labelledby="export-zip-heading">
      <h3 id="export-zip-heading">Files (.zip)</h3>
      <p class="subtitle">
        A read-only archive of every markdown file in the plan, plus a top-level
        <code>plan.json</code>.
      </p>

      <ul class="file-list">
        @for (file of files(); track file.path) {
          <li>
            <span class="file-path">
              {{ file.path }}
              @if (store.markdownOverrides()[file.path]) {
                <span aria-hidden="true" class="modified-marker">*</span>
                <span class="sr-only">(modified)</span>
              }
            </span>
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

    .file-list {
      display: grid;
      gap: 0;
      list-style: none;
      margin: 0;
      max-height: 300px;
      overflow: auto;
      padding: 0;
    }

    .file-list li {
      align-items: center;
      border-bottom: 1px solid var(--surface-border);
      display: flex;
      justify-content: space-between;
      padding: 0.4rem 0;
    }

    .file-list-empty {
      color: var(--text-color-secondary);
      font-style: italic;
    }

    .file-path {
      color: var(--text-color-secondary);
      font-size: 0.8rem;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .modified-marker {
      color: var(--primary-color);
      margin-left: 0.3rem;
    }

    .export-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }

    .sr-only {
      clip: rect(0 0 0 0);
      clip-path: inset(50%);
      height: 1px;
      overflow: hidden;
      position: absolute;
      white-space: nowrap;
      width: 1px;
    }
  `,
})
export class ExportZipComponent {
  protected readonly store = inject(ProjectStore);
  private readonly exportService = inject(ExportService);
  private readonly markdown = inject(MarkdownRendererService);

  protected readonly exportingZip = signal(false);

  protected readonly files = computed(() => this.store.derivedFiles());

  protected downloadZip = async (): Promise<void> => {
    const plan = this.store.plan();
    if (!plan || this.exportingZip()) return;
    this.exportingZip.set(true);
    try {
      const blob = await this.exportService.buildZip(plan, this.store.markdownOverrides());
      triggerDownload(blob, `${exportBaseName(plan)}-docs.zip`);
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
  // Defer the revoke so Safari has a chance to read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
