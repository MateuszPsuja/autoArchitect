import { ChangeDetectionStrategy, Component, inject, input, output, signal, viewChild } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { FileUploadModule } from 'primeng/fileupload';
import { MessageModule } from 'primeng/message';
import { ContextAttachment } from '../../core/context-attachment.model';
import { ContextFileReaderService } from '../../core/context-file-reader.service';

@Component({
  selector: 'app-context-attachments',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonModule, FileUploadModule, MessageModule],
  template: `
    <section class="attachments" aria-labelledby="context-files-title">
      <div class="section-header">
        <div>
          <h3 id="context-files-title">Context files</h3>
          <p class="hint">Add markdown, text, PDF, or image files as prompt context only.</p>
        </div>
        @if (attachments().length > 0) {
          <p-button
            label="Clear"
            severity="secondary"
            size="small"
            [text]="true"
            (onClick)="clear()"
          />
        }
      </div>

      <p-fileupload
        #contextFileUpload
        mode="advanced"
        name="contextFiles[]"
        accept=".md,.markdown,.txt,.pdf,image/*"
        [multiple]="true"
        [customUpload]="true"
        [showUploadButton]="false"
        [showCancelButton]="false"
        chooseLabel="Choose context files"
        (onSelect)="onSelectedFiles($event)"
      >
        <ng-template #empty>
          <div class="empty-upload">
            <i class="pi pi-cloud-upload" aria-hidden="true"></i>
            <p>Drag and drop files here, or choose files from disk.</p>
          </div>
        </ng-template>
      </p-fileupload>

      @if (isReading()) {
        <p class="reading" role="status" aria-live="polite">Reading context files…</p>
      }

      @if (attachments().length > 0) {
        <ul class="attachment-list" aria-label="Selected context files">
          @for (attachment of attachments(); track attachment.id) {
            <li class="attachment-item">
              <div class="attachment-meta">
                <strong>{{ attachment.name }}</strong>
                <span>{{ attachment.kind }} · {{ formatBytes(attachment.size) }}</span>
                @if (attachment.summary) {
                  <span>{{ attachment.summary }}</span>
                }
                @if (attachment.warning) {
                  <p-message severity="warn" [text]="attachment.warning" styleClass="w-full" />
                }
              </div>
              <p-button
                icon="pi pi-times"
                severity="danger"
                size="small"
                [text]="true"
                [ariaLabel]="'Remove ' + attachment.name"
                (onClick)="remove(attachment.id)"
              />
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: `
    .attachments {
      display: grid;
      gap: 0.75rem;
    }

    .section-header {
      align-items: flex-start;
      display: flex;
      justify-content: space-between;
      gap: 1rem;
    }

    h3 {
      font-size: 1rem;
      margin: 0 0 0.25rem;
    }

    .hint,
    .reading {
      color: var(--text-color-secondary);
      font-size: 0.85rem;
      margin: 0;
    }

    .empty-upload {
      align-items: center;
      color: var(--text-color-secondary);
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      justify-content: center;
      padding: 1.5rem;
      text-align: center;
    }

    .empty-upload i {
      border: 2px solid var(--surface-border);
      border-radius: 999px;
      font-size: 1.5rem;
      padding: 0.75rem;
    }

    .attachment-list {
      display: grid;
      gap: 0.5rem;
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .attachment-item {
      align-items: flex-start;
      border: 1px solid var(--surface-border);
      border-radius: var(--radius-md);
      display: flex;
      gap: 0.75rem;
      justify-content: space-between;
      padding: 0.75rem;
    }

    .attachment-meta {
      display: grid;
      gap: 0.25rem;
      min-width: 0;
    }

    .attachment-meta strong {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .attachment-meta span {
      color: var(--text-color-secondary);
      font-size: 0.78rem;
    }
  `,
})
export class ContextAttachmentsComponent {
  readonly initialAttachments = input<ContextAttachment[]>([]);
  readonly attachmentsChange = output<ContextAttachment[]>();

  private readonly reader = inject(ContextFileReaderService);
  private readonly contextFileUpload = viewChild<{ clear: () => void }>('contextFileUpload');
  protected readonly attachments = signal<ContextAttachment[]>([]);
  protected readonly isReading = signal(false);

  constructor() {
    queueMicrotask(() => {
      this.attachments.set(this.initialAttachments());
    });
  }

  protected async onSelectedFiles(event: { files?: File[]; currentFiles?: File[] }): Promise<void> {
    const files = event.currentFiles ?? event.files ?? [];
    if (files.length === 0) {
      return;
    }

    this.isReading.set(true);
    try {
      const next = await this.reader.readFiles(files);
      this.attachments.set(next);
      this.attachmentsChange.emit(next);
      this.contextFileUpload()?.clear();
    } finally {
      this.isReading.set(false);
    }
  }

  protected remove(id: string): void {
    const next = this.attachments().filter((attachment) => attachment.id !== id);
    this.attachments.set(next);
    this.attachmentsChange.emit(next);
  }

  protected clear(): void {
    this.attachments.set([]);
    this.attachmentsChange.emit([]);
    this.contextFileUpload()?.clear();
  }

  protected formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / 1024 ** exponent;
    return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
  }
}
