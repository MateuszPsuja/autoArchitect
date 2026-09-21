import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AccordionModule } from 'primeng/accordion';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TextareaModule } from 'primeng/textarea';
import { TooltipModule } from 'primeng/tooltip';
import { MarkdownFile, MarkdownRendererService } from '../../core/markdown-renderer.service';
import { ProjectStore } from '../../core/project.store';
import { MarkdownPreviewComponent } from '../../shared/markdown-preview/markdown-preview.component';

interface FileSection {
  readonly label: string;
  readonly sortKey: number;
  readonly files: readonly MarkdownFile[];
}

export function deriveSection(path: string): { label: string; sortKey: number } {
  const parts = path.split('/');
  if (parts.length === 1) {
    return { label: 'Root', sortKey: Number.MAX_SAFE_INTEGER };
  }

  let label: string;
  let sortKey = Number.MAX_SAFE_INTEGER;
  const effectiveParts =
    parts[0] === 'specs' && parts.length >= 3 ? parts.slice(2) : parts;
  if (effectiveParts[0] === 'docs' && effectiveParts.length >= 3) {
    label = effectiveParts[1].replace(/^\d{2}-/, '');
    const numericMatch = effectiveParts[1].match(/^(\d{2})-/);
    if (numericMatch) {
      sortKey = Number.parseInt(numericMatch[1], 10);
    }
  } else {
    label = effectiveParts[0].replace(/^\d{2}-/, '');
    const numericMatch = effectiveParts[0].match(/^(\d{2})-/);
    if (numericMatch) {
      sortKey = Number.parseInt(numericMatch[1], 10);
    }
  }

  return { label, sortKey };
}

const FILENAME_STRIP_PREFIX = /^(?:adr[-_]\d{3,}[-_]|adr[-_])/i;
const FILENAME_STRIP_VERB =
  /^(?:use|prefer|adopt|introduce|enable|support|add|allow|switch[-_]?to|migrate[-_]?to|replace|remove|provide)-/i;

function basenameOf(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] ?? path;
}

export function displayName(path: string): string {
  const full = basenameOf(path);
  const adrMatch = full.match(/^adr[-_](\d{3,})/i);
  let stripped = full.replace(FILENAME_STRIP_PREFIX, '');
  stripped = stripped.replace(FILENAME_STRIP_VERB, '');
  if (adrMatch) {
    stripped = `adr-${adrMatch[1]}: ${stripped}`;
  }
  return stripped;
}

@Component({
  selector: 'app-plan-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    AccordionModule,
    ButtonModule,
    DialogModule,
    MarkdownPreviewComponent,
    TextareaModule,
    TooltipModule,
  ],
  template: `
    @if (!store.plan()) {
      <section class="empty">Generate a plan to start editing markdown files.</section>
    } @else {
      <section class="editor-layout">
        <aside class="tree" aria-label="File tree">
          <p-accordion
            [value]="openSectionValues()"
            [multiple]="true"
            (valueChange)="onAccordionChange($event)"
          >
            @for (section of fileSections(); track section.label) {
              <p-accordion-panel [value]="section.label">
                <p-accordion-header>
                  <span class="section-title">{{ section.label }}</span>
                  <span class="section-count">({{ section.files.length }})</span>
                </p-accordion-header>
                <p-accordion-content>
                  <ul class="file-list" role="list">
                    @for (file of section.files; track file.path) {
                      <li>
                        <button
                          type="button"
                          class="file"
                          [class.active]="selectedPath() === file.path"
                          (click)="select(file.path)"
                        >
                          <span
                            class="file-name"
                            [pTooltip]="file.path"
                            tooltipPosition="top"
                          >{{ displayName(file.path) }}</span>
                          @if (isOverridden(file.path)) {
                            <span class="star" aria-hidden="true">*</span>
                            <span class="sr-only">(modified)</span>
                          }
                        </button>
                      </li>
                    }
                  </ul>
                </p-accordion-content>
              </p-accordion-panel>
            }
          </p-accordion>
        </aside>

        <div class="main">
          <div class="toolbar">
            <span class="selected-path">{{ selectedPath() || 'No file selected' }}</span>
              <p-button
                class="edit-button"
                label="Edit"
                icon="pi pi-pencil"
                severity="secondary"
                (onClick)="openEdit()"
                [disabled]="!selectedPath() || readonly()"
              />
          </div>

          <div class="preview-shell">
            <app-markdown-preview [markdown]="selectedContent()" />
          </div>
        </div>
      </section>

        <p-dialog
          [(visible)]="editing"
          [modal]="true"
          [style]="{ width: 'min(960px, 92vw)' }"
          [contentStyle]="{ height: '70vh', display: 'flex' }"
          header="Edit file"
          (onHide)="cancelEdit()"
        >
          <textarea
            pTextarea
            class="edit-textarea"
            [ngModel]="editBuffer()"
            (ngModelChange)="editBuffer.set($event)"
          ></textarea>
          <ng-template pTemplate="footer">
            <p-button
              label="Reset to Plan"
              severity="danger"
              [outlined]="true"
              (onClick)="resetBuffer()"
              [disabled]="!selectedPath()"
            />
            <div class="spacer"></div>
            <p-button
              label="Cancel"
              severity="secondary"
              [text]="true"
              (onClick)="cancelEdit()"
            />
            <p-button
              label="Save"
              severity="primary"
              (onClick)="saveEdit()"
            />
          </ng-template>
        </p-dialog>
    }
  `,
  styles: `
    .editor-layout {
      align-items: stretch;
      display: grid;
      gap: 1rem;
      grid-template-columns: minmax(240px, 28%) 1fr;
      min-height: 0;
    }

    .tree {
      background: var(--surface-card);
      border: 1px solid var(--surface-border);
      border-radius: var(--radius-lg);
      box-shadow: var(--card-shadow);
      max-height: 720px;
      overflow-x: hidden;
      overflow-y: auto;
      padding: 0.5rem;
    }

    .tree ::ng-deep .p-accordion {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .tree ::ng-deep .p-accordionpanel {
      background: transparent;
      border: 0;
      border-radius: var(--radius-md);
    }

    .tree ::ng-deep .p-accordionheader {
      align-items: center;
      background: var(--surface-50);
      border: 1px solid var(--surface-border);
      border-radius: var(--radius-md);
      color: var(--text-color);
      display: flex;
      font-size: 0.75rem;
      font-weight: 600;
      gap: 0.4rem;
      padding: 0.4rem 0.6rem;
      text-transform: capitalize;
    }

    .tree ::ng-deep .p-accordionheader:hover {
      background: var(--surface-hover);
    }

    .tree ::ng-deep .p-accordionheader.p-accordionheader-active {
      background: var(--surface-100);
      border-color: var(--primary-color);
    }

    .section-title {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .section-count {
      color: var(--text-color-secondary);
      font-size: 0.7rem;
      font-weight: 400;
    }

    .tree ::ng-deep .p-accordioncontent-content {
      padding: 0.35rem 0.25rem 0.25rem;
    }

    .tree ::ng-deep .p-tooltip .p-tooltip-text {
      max-width: 60rem;
      white-space: normal;
    }

    .file-list {
      display: grid;
      gap: 0.15rem;
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .file {
      align-items: center;
      background: transparent;
      border: 0;
      border-radius: var(--radius-sm);
      color: var(--text-color-secondary);
      cursor: pointer;
      display: flex;
      font-size: 0.7rem;
      gap: 0.3rem;
      justify-content: space-between;
      min-width: 0;
      overflow: hidden;
      padding: 0.25rem 0.5rem;
      text-align: left;
      transition: background 120ms ease, color 120ms ease;
      width: 100%;

      &:hover {
        background: var(--surface-hover);
        color: var(--text-color);
      }

      &.active {
        background: rgba(16, 185, 129, 0.1);
        border-left: 2px solid var(--primary-color);
        color: var(--text-color);
        font-weight: 500;
        padding-left: calc(0.5rem - 2px);
      }
    }

    .file-name {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .star {
      color: var(--primary-color);
      flex-shrink: 0;
    }

    .main {
      align-items: stretch;
      display: grid;
      gap: 0.5rem;
      grid-template-rows: auto 1fr;
      min-height: 0;
      position: relative;
    }

    .toolbar {
      align-items: center;
      align-self: start;
      display: flex;
      gap: 0.5rem;
      min-height: 0;
      padding-block: 1rem;
    }

    .toolbar ::ng-deep p-button,
    .toolbar ::ng-deep .p-button {
      align-self: center;
      display: inline-flex;
    }

    .selected-path {
      color: var(--text-color-secondary);
      flex: 1 1 auto;
      font-size: 1rem;
      line-height: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .toolbar ::ng-deep .edit-button {
      display: flex;
    }

    .preview-shell {
      align-self: stretch;
      background: var(--surface-card);
      border: 1px solid var(--surface-border);
      border-radius: var(--radius-lg);
      box-shadow: var(--card-shadow);
      min-height: 0;
      overflow: auto;
      padding: 1.25rem 1.5rem;
    }

    .preview-shell app-markdown-preview {
      display: block;
    }

    .edit-textarea {
      flex: 1 1 auto;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.85rem;
      resize: none;
      width: 100%;
    }

    .spacer {
      flex: 1 1 auto;
    }

    .empty {
      border: 1px dashed var(--surface-border);
      border-radius: var(--radius-lg);
      color: var(--text-color-secondary);
      padding: 1.5rem;
    }
  `,
})
export class PlanEditorComponent {

  protected readonly store = inject(ProjectStore);
  private readonly markdown = inject(MarkdownRendererService);
  protected readonly selectedPath = signal('');
  protected readonly readonly = computed(() => this.store.isGenerating());
  protected readonly editing = signal(false);
  protected readonly editBuffer = signal('');

  protected readonly fileSections = computed<FileSection[]>(() => {
    const plan = this.store.plan();
    if (!plan) {
      return [];
    }
    const all = this.markdown.toMarkdownFiles(plan);

    const groups = new Map<string, { sortKey: number; files: MarkdownFile[] }>();
    for (const file of all) {
      const { label, sortKey } = deriveSection(file.path);
      const bucket = groups.get(label) ?? { sortKey, files: [] };
      bucket.files.push(file);
      groups.set(label, bucket);
    }

    return [...groups.entries()]
      .map(([label, { sortKey, files }]) => ({ label, sortKey, files }))
      .sort((a, b) => a.sortKey - b.sortKey);
  });

  protected readonly openSections = signal<ReadonlySet<string>>(new Set());

  protected readonly openSectionValues = computed<string[]>(() => [
    ...this.openSections(),
  ]);

  protected readonly selectedContent = computed(() => {
    const path = this.selectedPath();
    const selected = this.fileSections()
      .flatMap((s) => s.files)
      .find((file) => file.path === path);
    if (!selected) {
      return '';
    }
    return this.store.markdownOverrides()[path] ?? selected.content;
  });

  constructor() {
    effect(() => {
      const sections = this.fileSections();
      const currentOpen = untracked(this.openSections);
      const next = new Set(currentOpen);
      let changed = false;
      for (const section of sections) {
        if (!next.has(section.label)) {
          next.add(section.label);
          changed = true;
        }
      }
      for (const label of [...next]) {
        if (!sections.some((s) => s.label === label)) {
          next.delete(label);
          changed = true;
        }
      }
      if (changed) {
        this.openSections.set(next);
      }
    });

    effect(() => {
      const sections = this.fileSections();
      const currentPath = this.selectedPath();

      if (sections.length === 0) {
        if (currentPath) {
          this.selectedPath.set('');
        }
        return;
      }

      const allFiles = sections.flatMap((s) => s.files);
      const hasSelectedPath = allFiles.some((file) => file.path === currentPath);
      if (!hasSelectedPath) {
        this.selectedPath.set(allFiles[0].path);
        return;
      }

      const owningSection = sections.find((s) =>
        s.files.some((f) => f.path === currentPath),
      );
      if (owningSection) {
        const isOpen = untracked(this.openSections).has(owningSection.label);
        if (!isOpen) {
          const next = new Set(untracked(this.openSections));
          next.add(owningSection.label);
          this.openSections.set(next);
        }
      }
    });
  }

  protected onAccordionChange(value: string | string[] | number | number[] | null | undefined): void {
    const next = new Set<string>();
    if (Array.isArray(value)) {
      for (const v of value) {
        if (typeof v === 'string') {
          next.add(v);
        }
      }
    } else if (typeof value === 'string') {
      next.add(value);
    }
    this.openSections.set(next);
  }

  protected basename(path: string): string {
    const parts = path.split('/');
    return parts[parts.length - 1] ?? path;
  }

  protected displayName(path: string): string {
    return displayName(path);
  }

  protected select(path: string): void {
    this.selectedPath.set(path);
  }

  protected openEdit(): void {
    if (!this.selectedPath()) {
      return;
    }
    this.editBuffer.set(this.selectedContent());
    this.editing.set(true);
  }

  protected saveEdit(): void {
    const path = this.selectedPath();
    if (!path) {
      this.cancelEdit();
      return;
    }
    this.store.upsertMarkdownOverride(path, this.editBuffer());
    this.cancelEdit();
  }

  protected cancelEdit(): void {
    this.editing.set(false);
    this.editBuffer.set('');
  }

  protected resetBuffer(): void {
    const path = this.selectedPath();
    if (!path) {
      return;
    }
    const original = this.fileSections()
      .flatMap((s) => s.files)
      .find((file) => file.path === path);
    if (!original) {
      return;
    }
    this.editBuffer.set(original.content);
    this.saveEdit();
  }

  protected isOverridden(path: string): boolean {
    return Boolean(this.store.markdownOverrides()[path]);
  }
}