import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { TagModule } from 'primeng/tag';
import { TabsModule } from 'primeng/tabs';
import {
  buildArchitectureBlueprint,
  buildTechStackDiagram,
} from '../../core/architecture-blueprint';
import { ArchitectureLayer } from '../../core/plan.schema';
import { STUB_MARKER } from '../../core/plan-schema.service';
import { ProjectStore } from '../../core/project.store';
import { MermaidPreviewComponent } from './mermaid-preview.component';

const BLUEPRINT_EDGE_LABEL_STYLES: Record<string, string> = {
  uses: 'edge-uses',
  'implemented by': 'edge-impl',
};

const TECH_STACK_NODE_LABEL_FONT_SIZE = '13px';
const TECH_STACK_NODE_LABEL_FONT_WEIGHT = '400';

type ArchSubTab = 0 | 1 | 2;

const SUB_TAB_STORAGE_KEY = 'arc-planner:arch-subtab';

@Component({
  selector: 'app-architecture-tree',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TagModule, TabsModule, MermaidPreviewComponent],
  template: `
    @if (!store.plan()) {
      <section class="empty">No architecture to visualize yet.</section>
    } @else {
      <section class="blueprint-page">

        <p-tabs class="sub-tabs" [value]="activeSubTab()" (valueChange)="onSubTabChange($any($event))">
          <p-tablist>
            <p-tab [value]="0">Blueprint</p-tab>
            <p-tab [value]="1">Tech Stack</p-tab>
            <p-tab [value]="2">Layers</p-tab>
          </p-tablist>
          <p-tabpanels>

            <!-- ── 01 · Blueprint ─────────────────────────────────────── -->
            <p-tabpanel [value]="0">
              <article class="console-panel">
                <header class="arch-panel-header">
                  <h3>Architecture Blueprint</h3>
                  <p class="caption">
                    Synthesized from actors, bounded contexts and domains — each role
                    uses a distinct shape &amp; colour.
                  </p>
                </header>

                <div class="diagram-wrap">
                  <app-mermaid-preview
                    [chart]="contextDiagram()"
                    [edgeLabelStyles]="blueprintEdgeLabelStyles()"
                  />
                </div>
              </article>
            </p-tabpanel>

            <!-- ── 02 · Tech Stack ────────────────────────────────────── -->
            <p-tabpanel [value]="1">
              <article class="console-panel">
                <header class="arch-panel-header">
                  <h3>Tech Stack</h3>
                  <p class="caption">
                    Per-layer technology choices and patterns. Each layer is shown
                    in its own diagram because the layers are independent.
                  </p>
                </header>

                @if (hasTechStack()) {
                  <div class="tech-stack-grid">
                    @for (chart of techStackDiagram(); track $index) {
                      <div class="tech-diagram-slot">
                        <app-mermaid-preview
                          [chart]="chart"
                          [nodeLabelFontSize]="techStackNodeFontSize()"
                          [nodeLabelFontWeight]="techStackNodeFontWeight()"
                        />
                      </div>
                    }
                  </div>
                } @else {
                  <p class="empty-inline">No tech stack declared yet.</p>
                }
              </article>
            </p-tabpanel>

            <!-- ── 03 · Layers ───────────────────────────────────────── -->
            <p-tabpanel [value]="2">
              <article class="console-panel">
                <header class="arch-panel-header">
                  <h3>Per-Layer Architecture</h3>
                  <p class="caption">
                    One overview diagram per layer — title and rendered Mermaid.
                  </p>
                </header>

                @if (store.plan()!.architectureLayers.length > 0) {
                  <div class="layer-details-grid">
                    @for (layer of store.plan()!.architectureLayers; track layer.id) {
                      <section class="layer-details-card">
                        <header class="layer-details-header">
                          <span class="layer-tag layer-tag--{{ layer.id }}">{{ layer.name }}</span>
                          @if (isLayerStubbed(layer.id)) {
                            <p-tag value="Auto-generated" severity="warn" />
                          }
                          <h4>Overview</h4>
                        </header>
                        @if (layer.mermaidDiagram) {
                          <app-mermaid-preview [chart]="layer.mermaidDiagram" />
                        }
                      </section>
                    }
                  </div>
                } @else {
                  <p class="empty-inline">No per-layer architecture declared yet.</p>
                }
              </article>
            </p-tabpanel>

          </p-tabpanels>
        </p-tabs>

      </section>
    }
  `,
  styles: `
    /* ── Sub-tab strip — shares global <p-tabs> chrome from
       styles.scss (background, border, padding, hover/active state,
       flush tab items). The Aura preset provides the horizontal
       layout; this component contributes no extra tab chrome. */

    /* The eyebrow above each panel title uses the shared .eyebrow
       utility from styles.scss so it matches Plan Fields / Plan
       Editor / Editor chrome. */

    /* ── Console panel — matches the global .card surface so the
       architecture panels share elevation and border with the editor
       header / Plan Fields cards above them. No horizontal padding
       anywhere: the global .p-tabpanel flush rule and the explicit
       zero-inline-padding on every card here keep content
       edge-to-edge with the editor column. ────────────── */

    .blueprint-page {
      display: grid;
      gap: 1.25rem;
    }

    .console-panel {
      background: var(--surface-card);
      border-radius: 0;
      display: grid;
      gap: 1.25rem;
      min-width: 0;
      padding: 1.5rem 0;
    }

    .arch-panel-header {
      display: grid;
      gap: 0.35rem;
      min-width: 0;
    }

    .arch-panel-header h3 {
      font-size: 1.15rem;
      font-weight: 700;
      margin: 0;
    }

    .arch-panel-header .caption {
      color: var(--text-color-secondary);
      font-size: 0.82rem;
      margin: 0;
      max-width: 80ch;
    }

    .empty-inline {
      border: 1px dashed var(--surface-border);
      color: var(--text-color-secondary);
      font-size: 0.82rem;
      padding: 1.5rem;
    }

    .empty {
      border: 1px dashed var(--surface-border);
      color: var(--text-color-secondary);
      padding: 1.5rem;
    }

    .diagram-wrap {
      min-width: 0;
    }

    /* ── Tech Stack — full-width stacked diagrams ──────────────────── */

    .tech-stack-grid {
      align-items: start;
      display: grid;
      gap: 1.5rem;
      grid-template-columns: minmax(0, 1fr);
    }

    .tech-diagram-slot {
      align-self: flex-start;
      justify-self: stretch;
      min-width: 0;
      width: 100%;
    }

    .tech-diagram-slot app-mermaid-preview {
      align-self: flex-start;
      display: block;
      width: 100%;
    }

    /* ── Per-Layer — full-width stacked cards ──────────────────────── */

    .layer-details-grid {
      display: grid;
      gap: 1.5rem;
      grid-template-columns: minmax(0, 1fr);
    }

    .layer-details-card {
      background: var(--surface-card);
      border-radius: 0;
      display: grid;
      gap: 0.75rem;
      min-width: 0;
      padding: 1rem 0;
    }

    .layer-details-header {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      min-width: 0;
    }

    .layer-details-card app-mermaid-preview {
      align-self: flex-start;
      display: block;
      min-width: 0;
      width: 100%;
    }

    /* The card title inherits the global h4 rule (Inter, 700). Tune
       only the colour and size here so it reads as a section heading
       rather than a code-style tag. */
    .layer-details-header h4 {
      color: var(--text-color);
      font-family: inherit;
      font-size: 0.95rem;
      font-weight: 700;
      margin: 0;
    }
  `,
})
export class ArchitectureTreeComponent {
  protected readonly store = inject(ProjectStore);

  protected readonly activeSubTab = signal<ArchSubTab>(0);

  protected readonly contextDiagram = computed(() => {
    const plan = this.store.plan();
    if (!plan) {
      return 'graph TD\nA["No architecture data yet — generate a plan first."]';
    }
    const patch = this.store.synthesisedDiagramPatches()['blueprint'];
    if (patch) return patch;
    return buildArchitectureBlueprint(plan);
  });

  protected readonly techStackDiagram = computed(() => {
    const plan = this.store.plan();
    if (!plan) {
      return ['graph TD\nA["No tech stack declared yet."]'];
    }
    const rendered = buildTechStackDiagram(plan);
    const patches = this.store.synthesisedDiagramPatches();





    if (Object.keys(patches).length === 0) return rendered;
    const renderableLayers = (plan.architectureLayers ?? []).filter(
      (l: ArchitectureLayer) => Array.isArray(l?.techStack) && (l.techStack ?? []).some(Boolean),
    );
    return rendered.map((source, idx) => {
      const layer = renderableLayers[idx];
      if (!layer) return source;
      const patched = patches[`techStack:${layer.id}`];
      return patched ?? source;
    });
  });

  protected readonly hasTechStack = computed(() => {
    const plan = this.store.plan();
    if (!plan) return false;
    return (plan.architectureLayers ?? []).some(
      (l: ArchitectureLayer) => (l.techStack ?? []).some(Boolean),
    );
  });

  protected readonly blueprintEdgeLabelStyles = computed<Record<string, string>>(
    () => BLUEPRINT_EDGE_LABEL_STYLES,
  );

  protected readonly techStackNodeFontSize = signal<string>(TECH_STACK_NODE_LABEL_FONT_SIZE);
  protected readonly techStackNodeFontWeight = signal<string>(TECH_STACK_NODE_LABEL_FONT_WEIGHT);

  protected isLayerStubbed(layerId: string): boolean {
    const plan = this.store.plan();
    if (!plan) return false;
    const layer = plan.architectureLayers.find((l) => l.id === layerId);
    return !!layer && layer.description.includes(STUB_MARKER);
  }

  constructor() {





    try {
      if (typeof sessionStorage !== 'undefined') {
        const raw = sessionStorage.getItem(SUB_TAB_STORAGE_KEY);
        if (raw !== null) {
          const n = Math.min(Number.parseInt(raw, 10), 2);
          if (n === 0 || n === 1 || n === 2) {
            this.activeSubTab.set(n as ArchSubTab);
          }
        }
      }
    } catch {

    }
  }

  protected onSubTabChange(value: number | string): void {
    const n = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
    if (n === 0 || n === 1 || n === 2) {
      this.activeSubTab.set(n as ArchSubTab);
      try {
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem(SUB_TAB_STORAGE_KEY, String(n));
        }
      } catch {

      }
    }
  }
}
