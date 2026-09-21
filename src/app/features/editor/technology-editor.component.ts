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
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { TextareaModule } from 'primeng/textarea';
import { ProjectStore } from '../../core/project.store';

interface LayerDraft {
  id: string;
  name: string;
  stackText: string;
  hasEmpty: boolean;
}

@Component({
  selector: 'app-technology-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ButtonModule, MessageModule, TextareaModule],
  template: `
    @if (layers().length === 0) {
      <p-message severity="info" styleClass="w-full">
        This plan has no architecture layers yet. Add one in the Plan Fields tab first.
      </p-message>
    } @else {
      <section class="tech-stack-tool">
        <section class="card tech-hints-card">
          <div class="tech-hints-header">
            <h3 class="tech-section-title">Technology hints (free-form)</h3>
            <p class="tech-hint-text">
              Mirrors the Project Input "Technology Hints" field. Use this to give the
              planner extra guidance on the stack; the change is merged into the
              Regenerate prompt automatically.
            </p>
          </div>
          <textarea
            pTextarea
            class="w-full tech-hints-textarea"
            rows="6"
            [ngModel]="hintsText()"
            (ngModelChange)="onHintsChange($event)"
            placeholder="e.g. Team prefers Postgres and NestJS; please keep Angular 17 for the frontend…"
            data-testid="technology-hints-textarea"
          ></textarea>
        </section>

        <section class="tech-layers-grid">
          @for (layer of layers(); track layer.id) {
            <section class="card tech-layer-card">
              <div class="tech-layer-header">
                <h3 class="tech-section-title">{{ layer.name }}</h3>
                <span class="tech-layer-id">{{ layer.id }}</span>
              </div>
              <label class="tech-layer-label" [attr.for]="'tech-' + layer.id">
                Tech stack (one per line, 1–8 entries)
              </label>
              <textarea
                pTextarea
                class="w-full tech-stack-textarea"
                [id]="'tech-' + layer.id"
                rows="10"
                [ngModel]="layer.stackText"
                (ngModelChange)="onStackChange(layer.id, $event)"
                [attr.data-testid]="'tech-stack-' + layer.id"
              ></textarea>
              @if (layer.hasEmpty) {
                <p-message severity="warn" styleClass="w-full tech-stack-warn">
                  Add at least one technology. The layer cannot be saved empty.
                </p-message>
              }
              <div class="tech-layer-actions">
                <p-button
                  label="Reset to original"
                  icon="pi pi-refresh"
                  severity="secondary"
                  size="small"
                  [disabled]="!canResetLayer(layer.id)"
                  (onClick)="resetLayer(layer.id)"
                />
              </div>
            </section>
          }
        </section>

        @if (regenerateHint()) {
          <p-message
            severity="info"
            styleClass="w-full"
            [text]="regenerateHint()"
          />
        }
      </section>
    }
  `,
  styles: `
    .tech-stack-tool {
      display: grid;
      gap: 1rem;
    }

    .tech-section-title {
      font-size: 1rem;
      font-weight: 600;
      margin: 0;
    }

    .tech-hints-header {
      display: grid;
      gap: 0.35rem;
      margin-bottom: 0.5rem;
    }

    .tech-hint-text {
      color: var(--text-color-secondary);
      font-size: 0.85rem;
      margin: 0;
    }

    .tech-hints-textarea {
      min-height: 7rem;
    }

    .tech-layers-grid {
      display: grid;
      gap: 1rem;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    @media (max-width: 768px) {
      .tech-layers-grid {
        grid-template-columns: minmax(0, 1fr);
      }
    }

    .tech-layer-card {
      display: grid;
      gap: 0.5rem;
    }

    .tech-layer-header {
      align-items: baseline;
      display: flex;
      justify-content: space-between;
      gap: 0.75rem;
    }

    .tech-layer-id {
      color: var(--text-color-secondary);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.78rem;
    }

    .tech-layer-label {
      display: block;
      font-size: 0.85rem;
      font-weight: 600;
    }

    .tech-stack-textarea {
      min-height: 14rem;
      resize: vertical;
    }

    .tech-layer-actions {
      display: flex;
      justify-content: flex-end;
    }

    .tech-stack-warn {
      margin-top: 0.25rem;
    }
  `,
})
export class TechnologyEditorComponent {
  protected readonly store = inject(ProjectStore);

  protected readonly hintsText = signal<string>('');

  protected readonly layers = computed<LayerDraft[]>(() => {
    const plan = this.store.plan();
    if (!plan) return [];
    return plan.architectureLayers.map((layer) => {
      const text = layer.techStack.join('\n');
      return {
        id: layer.id,
        name: layer.name,
        stackText: text,
        hasEmpty: layer.techStack.length === 0,
      };
    });
  });

  protected readonly baselineById = computed(() => {
    const baseline = this.store.lastGeneratedPlanRef();
    if (!baseline) return new Map<string, string[]>();
    return new Map(baseline.architectureLayers.map((l) => [l.id, l.techStack]));
  });

  protected readonly regenerateHint = computed(() => {
    const plan = this.store.plan();
    const baseline = this.store.lastGeneratedPlanRef();
    if (!plan || !baseline) return '';
    const hint = 'Click Regenerate in the workspace header to rebuild the plan with your technology choices.';
    const currentHints = plan.meta.technologyHints ?? '';
    const baselineHints = baseline.meta.technologyHints ?? '';
    if (currentHints !== baselineHints) return hint;
    const baselineById = this.baselineById();
    for (const layer of plan.architectureLayers) {
      const baseStack = baselineById.get(layer.id);
      if (!baseStack) return hint;
      if (baseStack.length !== layer.techStack.length) return hint;
      for (let i = 0; i < baseStack.length; i++) {
        if (baseStack[i] !== layer.techStack[i]) return hint;
      }
    }
    return '';
  });

  constructor() {
    effect(() => {
      const plan = this.store.plan();
      const seed = untracked(() => this.hintsText());
      if (plan && seed === '' && plan.meta.technologyHints) {
        this.hintsText.set(plan.meta.technologyHints);
      }
    });
  }

  protected onStackChange(layerId: string, value: string): void {
    const lines = this.splitLines(value);
    const next = this.layers().map((layer) =>
      layer.id === layerId
        ? {
            ...layer,
            stackText: value,
            hasEmpty: lines.length === 0,
          }
        : layer,
    );
    this.commit(next);
  }

  protected onHintsChange(value: string): void {
    this.hintsText.set(value);
    this.commit(this.layers());
  }

  protected canResetLayer(layerId: string): boolean {
    const baseline = this.baselineById().get(layerId);
    if (!baseline) return false;
    const current = this.store
      .plan()
      ?.architectureLayers.find((l) => l.id === layerId)?.techStack;
    if (!current) return false;
    if (current.length !== baseline.length) return true;
    return current.some((entry, i) => entry !== baseline[i]);
  }

  protected resetLayer(layerId: string): void {
    const baseline = this.baselineById().get(layerId);
    if (!baseline) return;
    const text = baseline.join('\n');
    const next = this.layers().map((layer) =>
      layer.id === layerId
        ? {
            ...layer,
            stackText: text,
            hasEmpty: false,
          }
        : layer,
    );
    this.commit(next);
  }

  private commit(drafts: LayerDraft[]): void {
    this.store.mergeTechnologyOverride(
      drafts.map((d) => ({ id: d.id, techStack: this.splitLines(d.stackText) })),
      this.hintsText(),
    );
  }

  private splitLines(value: string): string[] {
    return value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
}