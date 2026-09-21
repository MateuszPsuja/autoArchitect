import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import DOMPurify from 'dompurify';
import mermaid from 'mermaid';
import { normalizeMermaidChart } from './mermaid-utils';

export interface EdgeLabelStyleMap {
  [labelText: string]: string;
}

interface EdgePaletteEntry {
  stroke: string;
  strokeWidth: string;
  dasharray?: string;
  labelBg: string;
  labelFg: string;
}

const EDGE_PALETTE: Record<string, EdgePaletteEntry> = {
  'edge-uses': {
    stroke: '#0284c7',
    strokeWidth: '2.5px',
    labelBg: '#0284c7',
    labelFg: '#ffffff',
  },
  'edge-impl': {
    stroke: '#7c3aed',
    strokeWidth: '2.5px',
    dasharray: '6 4',
    labelBg: '#7c3aed',
    labelFg: '#ffffff',
  },
};

function ensureMermaidRenderable(chart: string): string {
  if (!chart) return '';
  const headerBodyMatch = chart.match(
    /^(\s*(?:graph|flowchart)\s+(?:TD|LR|TB|RL|BT))\s*([\s\S]+)/i,
  );
  if (!headerBodyMatch) return chart;
  const body = headerBodyMatch[2].trim();
  if (/-->|->>|\b\w+\[/m.test(body)) return chart;
  if (body.length === 0) return chart;
  const esc = (s: string) =>
    s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ').trim();
  const parts = body
    .split(/;+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const nodes = parts.map((p, i) => `n${i + 1}["${esc(p)}"]`);
  const edgeLines = parts.slice(1).map((_, i) => `n${i + 1} --> n${i + 2}`);
  return `graph TD\n${[...nodes, ...edgeLines].join('\n')}`;
}

export interface IntrinsicSize {
  w: number;
  h: number;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const SCALE_STEP = 1.2;
const FIT_PADDING = 24; 

const DEFAULT_INTRINSIC_SIZE: IntrinsicSize = { w: 800, h: 400 };

const warnedFallbackSvgElements = new WeakSet<SVGSVGElement>();

export function clampScale(scale: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
}

export function parsePixelLength(raw: string | null): number | null {
  if (!raw) return null;
  if (raw === '100%' || raw.endsWith('%')) return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function readSvgIntrinsicSize(svg: Element): IntrinsicSize | null {
  const wAttr = svg.getAttribute('width');
  const hAttr = svg.getAttribute('height');
  const wPx = parsePixelLength(wAttr);
  const hPx = parsePixelLength(hAttr);
  if (wPx !== null && hPx !== null) {
    return { w: wPx, h: hPx };
  }



  const viewBox = svg.getAttribute('viewBox');
  if (viewBox) {
    const parts = viewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      const [, , vw, vh] = parts;
      if (vw > 0 && vh > 0) {
        return { w: vw, h: vh };
      }
    }
  }





  const bboxFn = (svg as unknown as { getBBox?: () => unknown }).getBBox;
  if (typeof bboxFn === 'function') {
    try {
      const bbox = bboxFn.call(svg) as
        | { width?: number; height?: number }
        | null
        | undefined;
      if (
        bbox &&
        Number.isFinite(bbox.width) &&
        Number.isFinite(bbox.height) &&
        (bbox.width as number) > 0 &&
        (bbox.height as number) > 0
      ) {
        return { w: bbox.width as number, h: bbox.height as number };
      }
    } catch {

    }
  }
  const rectFn = (svg as unknown as { getBoundingClientRect?: () => unknown })
    .getBoundingClientRect;
  if (typeof rectFn === 'function') {
    try {
      const rect = rectFn.call(svg) as
        | { width?: number; height?: number }
        | null
        | undefined;
      if (
        rect &&
        Number.isFinite(rect.width) &&
        Number.isFinite(rect.height) &&
        (rect.width as number) > 0 &&
        (rect.height as number) > 0
      ) {
        return { w: rect.width as number, h: rect.height as number };
      }
    } catch {

    }
  }



  if (typeof SVGSVGElement !== 'undefined' && svg instanceof SVGSVGElement) {
    if (!warnedFallbackSvgElements.has(svg)) {
      warnedFallbackSvgElements.add(svg);
      console.warn(
        `[mermaid-preview] SVG has no measurable dimensions (missing/zero viewBox, ` +
          `getBBox/getBoundingClientRect unavailable). Falling back to ${DEFAULT_INTRINSIC_SIZE.w}x${DEFAULT_INTRINSIC_SIZE.h} default.`,
      );
    }
  }
  return { ...DEFAULT_INTRINSIC_SIZE };
}

@Component({
  selector: 'app-mermaid-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="diagram">
      <div
        class="viewport"
        #viewportEl
        tabindex="0"
        role="img"
        aria-label="Mermaid diagram — use arrow keys to pan, plus and minus to zoom"
        [class.is-dragging]="isDragging()"
        [class.viewport--fallback]="showMinHeight()"
        (keydown)="onKeyDown($event)"
        (pointerdown)="onPointerDown($event)"
        (pointermove)="onPointerMove($event)"
        (pointerup)="onPointerUp($event)"
        (pointercancel)="onPointerUp($event)"
        (pointerleave)="onPointerUp($event)"
      >
        <div class="stage" [style.transform]="stageTransform()" [style.transformOrigin]="'0 0'">
          <div [id]="containerId()"></div>
        </div>
        @if (warning()) {
          <div class="warning" role="alert" data-testid="mermaid-render-warning">
            {{ warning() }}
          </div>
        }
        <div
          class="zoom-controls"
          role="toolbar"
          aria-label="Diagram zoom"
          (pointerdown)="$event.stopPropagation()"
        >
          <button type="button" class="zoom-btn" (click)="zoomOut()" aria-label="Zoom out">
            −
          </button>
          <button
            type="button"
            class="zoom-btn zoom-btn--label"
            (click)="resetView()"
            aria-label="Reset zoom"
            data-testid="zoom-reset"
          >
            {{ zoomPercent() }}%
          </button>
          <button type="button" class="zoom-btn" (click)="zoomIn()" aria-label="Zoom in">+</button>
          <button type="button" class="zoom-btn" (click)="fitToFrame()" aria-label="Fit to frame">
            Fit
          </button>
        </div>
      </div>
    </section>
  `,
  styles: `
    :host {
      display: block;
      width: 100%;
    }

    .diagram {
      background: #ffffff;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      box-sizing: border-box;
      display: block;
      padding: 1.25rem 1.5rem;
      width: 100%;
    }

    .viewport {
      align-items: center;
      cursor: grab;
      display: flex;
      justify-content: center;
      overflow: hidden;
      position: relative;
      touch-action: none;
      user-select: none;
      width: 100%;
    }

    .viewport.is-dragging {
      cursor: grabbing;
    }

    /* Layout safety net for diagrams whose intrinsic size is not yet known
       (e.g. sequenceDiagram viewBox collapsed to vh=0). Removed once the
       first render reports a real intrinsic size so it never creates a
       permanent gap below small flowchart diagrams. */
    .viewport--fallback {
      min-height: 200px;
    }

    .stage {
      display: inline-block;
      height: max-content;
      transform-origin: 0 0;
      width: max-content;
      will-change: transform;
    }

    .stage > div {
      display: block;
      width: auto !important;
    }

    .zoom-controls {
      background: var(--surface-card);
      border: 1px solid var(--surface-border);
      border-radius: var(--radius-md);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
      display: flex;
      gap: 0.25rem;
      padding: 0.25rem;
      pointer-events: auto;
      position: absolute;
      right: 0.5rem;
      top: 0.5rem;
      z-index: 5;
    }

    .zoom-btn {
      background: transparent;
      border: 0;
      border-radius: var(--radius-sm);
      color: var(--text-color);
      cursor: pointer;
      font: inherit;
      font-weight: 600;
      min-width: 2rem;
      padding: 0.25rem 0.5rem;
    }

    .zoom-btn:hover {
      background: var(--surface-hover);
    }

    .zoom-btn--label {
      min-width: 3.25rem;
    }

    /* The injected SVG keeps its intrinsic (viewBox-driven) size so the
       .stage transform can scale it. A width:100% rule would force a layout
       reflow on every zoom step instead of a transform. The width:auto
       rule on .stage > div (above) overrides the original
       .diagram > div { width: 100% } rule for this component.
       Width/height attributes set by applyZoomSize() must win over CSS,
       so this rule does not force width/height back to auto. */
    .viewport ::ng-deep svg {
      display: block;
      max-width: none !important;
    }

    .warning {
      background: rgba(245, 158, 11, 0.1);
      border: 1px solid var(--orange-500, #f59e0b);
      border-radius: var(--radius-sm);
      color: var(--orange-500, #f59e0b);
      font-family: 'Menlo', 'Monaco', monospace;
      font-size: 0.75rem;
      margin-top: 0.5rem;
      padding: 0.5rem 0.75rem;
      white-space: pre-wrap;
      word-break: break-word;
    }

    @media (max-width: 768px) {
      .zoom-controls {
        right: 0.25rem;
        top: 0.25rem;
      }
    }
  `,
})
export class MermaidPreviewComponent {
  readonly chart = input.required<string>();
  readonly edgeLabelStyles = input<EdgeLabelStyleMap>({});
  readonly nodeLabelFontSize = input<string>(NODE_LABEL_FONT_SIZE);
  readonly nodeLabelFontWeight = input<string>(NODE_LABEL_FONT_WEIGHT);

  protected readonly warning = signal('');
  protected readonly containerId = signal(`mermaid-${crypto.randomUUID()}`);
  protected readonly lastSvg = signal('');

  protected readonly renderScale = signal(1);
  protected readonly pan = signal<{ tx: number; ty: number }>({ tx: 0, ty: 0 });
  protected readonly intrinsicSize = signal<IntrinsicSize | null>(null);
  protected readonly isDragging = signal(false);
  protected readonly zoomPercent = signal(100);

  protected readonly showMinHeight = computed(() => this.intrinsicSize() === null);

  protected readonly viewportEl = viewChild<ElementRef<HTMLElement>>('viewportEl');
  private readonly destroyRef = inject(DestroyRef);

  private readonly warnedChartKeys = new Set<string>();

  private activePointers = new Map<number, { x: number; y: number }>();
  private lastPan = { x: 0, y: 0 };





  private fittedChartKey: string | null = null;



  private userHasZoomed = false;
  private resizeObserver: ResizeObserver | null = null;
  private renderTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor() {
    effect(() => {
      const code = this.chart();
      const scale = this.renderScale();
      const shouldAutoFit = this.fittedChartKey !== code;
      untracked(() => {
        const labelMap = this.edgeLabelStyles();
        const nodeFontSize = this.nodeLabelFontSize();
        const nodeFontWeight = this.nodeLabelFontWeight();
        if (this.renderTimer !== null) {
          clearTimeout(this.renderTimer);
        }
        if (this.destroyed) {
          return;
        }
        this.renderTimer = setTimeout(() => {
          this.renderTimer = null;
          if (this.destroyed) {
            return;
          }
          void this.renderChart(code, scale, labelMap, nodeFontSize, nodeFontWeight).then(() => {
            if (this.destroyed) {
              return;
            }
            if (shouldAutoFit && this.intrinsicSize()) {
              this.fittedChartKey = code;
              this.installResizeObserver();





              this.fitToFrame();
            }
          });
        }, 0);
      });
    });

    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      if (this.renderTimer !== null) {
        clearTimeout(this.renderTimer);
        this.renderTimer = null;
      }
      for (const id of Array.from(this.activePointers.keys())) {
        this.activePointers.delete(id);
      }
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
    });
  }

  private installResizeObserver(): void {
    if (this.resizeObserver) return;
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => {



      if (this.userHasZoomed) return;
      this.fitToFrame();
    });
    const host = this.viewportEl()?.nativeElement;
    if (host) {
      this.resizeObserver.observe(host);
    }
  }

  private applyZoomSize(host: Element, scale: number, chartKey: string): IntrinsicSize | null {
    const svg = host.querySelector('svg');
    if (!svg) {
      if (!this.warnedChartKeys.has(chartKey)) {
        this.warnedChartKeys.add(chartKey);
        console.warn(
          '[mermaid-preview] no <svg> element found in viewport; diagram will not render.',
        );
      }
      return null;
    }
    const intrinsic = readSvgIntrinsicSize(svg);
    if (!intrinsic) {
      if (!this.warnedChartKeys.has(chartKey)) {
        this.warnedChartKeys.add(chartKey);
        console.warn(
          '[mermaid-preview] could not determine intrinsic size for diagram; using default.',
        );
      }
      return null;
    }
    const { w, h } = intrinsic;
    svg.setAttribute('width', String(Math.round(w * scale)));
    svg.setAttribute('height', String(Math.round(h * scale)));
    return { w, h };
  }

  protected readonly stageTransform = (): string => {
    const p = this.pan();
    return `translate(${p.tx}px, ${p.ty}px)`;
  };

  protected zoomIn(): void {
    this.userHasZoomed = true;
    this.renderScale.set(clampScale(this.renderScale() * SCALE_STEP));
    this.pan.set({ tx: 0, ty: 0 });
  }

  protected zoomOut(): void {
    this.userHasZoomed = true;
    this.renderScale.set(clampScale(this.renderScale() / SCALE_STEP));
    this.pan.set({ tx: 0, ty: 0 });
  }

  protected resetView(): void {
    this.userHasZoomed = false;
    this.fitToFrame();
  }

  protected fitToFrame(): void {
    const host = this.viewportEl()?.nativeElement;
    const intrinsic = this.intrinsicSize();
    if (!host || !intrinsic || intrinsic.w <= 0) return;
    const hostRect = host.getBoundingClientRect();
    if (hostRect.width <= 0) return;
    const availableW = Math.max(1, hostRect.width - FIT_PADDING * 2);
    const target = clampScale(availableW / intrinsic.w);
    this.renderScale.set(target);
    this.pan.set({ tx: 0, ty: 0 });
  }

  protected onPointerDown(event: PointerEvent): void {
    const target = event.currentTarget as HTMLElement;
    if ((event.target as HTMLElement | null)?.closest('.zoom-controls')) {
      return;
    }
    target.setPointerCapture(event.pointerId);
    this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.lastPan = { x: event.clientX, y: event.clientY };
    if (this.activePointers.size === 1) {
      this.isDragging.set(true);
    }
  }

  protected onPointerMove(event: PointerEvent): void {
    if (!this.activePointers.has(event.pointerId)) return;
    this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const p = this.pan();
    const dx = event.clientX - this.lastPan.x;
    const dy = event.clientY - this.lastPan.y;
    this.lastPan = { x: event.clientX, y: event.clientY };
    this.pan.set({ tx: p.tx + dx, ty: p.ty + dy });
  }

  protected onPointerUp(event: PointerEvent): void {
    if (!this.activePointers.has(event.pointerId)) return;
    this.activePointers.delete(event.pointerId);
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture?.(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
    if (this.activePointers.size === 0) {
      this.isDragging.set(false);
    }
  }

  protected onKeyDown(event: KeyboardEvent): void {
    const STEP = 24;
    switch (event.key) {
      case 'ArrowLeft':
        this.pan.update((p) => ({ tx: p.tx + STEP, ty: p.ty }));
        event.preventDefault();
        return;
      case 'ArrowRight':
        this.pan.update((p) => ({ tx: p.tx - STEP, ty: p.ty }));
        event.preventDefault();
        return;
      case 'ArrowUp':
        this.pan.update((p) => ({ tx: p.tx, ty: p.ty + STEP }));
        event.preventDefault();
        return;
      case 'ArrowDown':
        this.pan.update((p) => ({ tx: p.tx, ty: p.ty - STEP }));
        event.preventDefault();
        return;
      case '+':
      case '=':
        this.zoomIn();
        event.preventDefault();
        return;
      case '-':
      case '_':
        this.zoomOut();
        event.preventDefault();
        return;
      case '0':
        this.resetView();
        event.preventDefault();
        return;
      default:
        return;
    }
  }

  private async renderChart(
    chart: string,
    scale: number,
    labelMap: EdgeLabelStyleMap = {},
    nodeFontSize: string = NODE_LABEL_FONT_SIZE,
    nodeFontWeight: string = NODE_LABEL_FONT_WEIGHT,
  ): Promise<void> {
    const element = document.getElementById(this.containerId());
    if (!element) {
      return;
    }

    const normalized = ensureMermaidRenderable(normalizeMermaidChart(chart));

    try {
      const m: any = mermaid as any;
      const parseFn = m.parse ?? m.mermaidAPI?.parse;
      if (typeof parseFn === 'function') {
        await parseFn(normalized);
      }
    } catch (err) {
      console.debug('Mermaid pre-parse hint (non-fatal):', err);
    }

    try {
      const res = await mermaid.render(`graph-${crypto.randomUUID()}`, normalized);
      if (this.destroyed) {
        return;
      }
      let svg = '';
      if (typeof res === 'string') {
        svg = res;
      } else if (res && typeof res === 'object') {
        svg = res.svg ?? (res as any).result ?? '';
      }
      const decorated = applySvgBackground(
        applyEdgeLabelCentering(
          applyNodeLabelFontSize(
            applyClusterTitleSizing(applyEdgeLabelStyles(svg, labelMap)),
            nodeFontSize,
            nodeFontWeight,
          ),
        ),
      );
      const safeSvg = DOMPurify.sanitize(decorated, {
        USE_PROFILES: { svg: true, svgFilters: true },
        ADD_ATTR: ['style', 'data-edge-palette', 'fill', 'stroke'],
      });
      if (this.destroyed) {
        return;
      }
      element.innerHTML = safeSvg;
      const intrinsic = this.applyZoomSize(element, scale, chart);
      if (intrinsic) {
        this.intrinsicSize.set(intrinsic);
        this.zoomPercent.set(Math.round(scale * 100));
      }
      this.lastSvg.set(element.innerHTML);
      this.warning.set('');
    } catch (err) {
      if (this.destroyed) {
        return;
      }
      if (this.lastSvg()) {
        element.innerHTML = this.lastSvg();
      } else {
        element.innerHTML = '';
      }
      const snippet = (normalized || '').slice(0, 2000);
      console.warn(`[mermaid-preview] render failed: ${String(err)}\nNormalized chart: ${snippet}`);
      const message = err instanceof Error ? err.message : String(err);
      this.warning.set(`Render failed: ${message.slice(0, 240)}`);
    }
  }
}

export function applyEdgeLabelStyles(svg: string, labelMap: EdgeLabelStyleMap): string {
  if (!svg || typeof svg !== 'string') return svg;
  if (!labelMap || Object.keys(labelMap).length === 0) return svg;

  const labelKeys = Object.keys(labelMap)
    .map((k) => k.trim())
    .filter(Boolean);
  if (labelKeys.length === 0) return svg;

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  } catch {
    return svg;
  }
  const root = doc.documentElement;
  if (!root || root.nodeName !== 'svg') return svg;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const edgePathsGroup = root.querySelector('g.edgePaths');
  const edgeLabelsGroup = root.querySelector('g.edgeLabels');
  if (!edgePathsGroup || !edgeLabelsGroup) return svg;

  const pathChildren = Array.from(edgePathsGroup.children).filter(
    (c) => c.tagName.toLowerCase() === 'path',
  );
  const labelChildren = Array.from(edgeLabelsGroup.children);

  const usedKeys = new Set<string>();
  let matchedAny = false;

  labelChildren.forEach((labelGroup, idx) => {
    const textEl = labelGroup.querySelector('text');
    let label = (textEl?.textContent ?? '').trim();
    if (!label) {
      const tspan = labelGroup.querySelector('tspan');
      label = (tspan?.textContent ?? '').trim();
    }
    if (!label) return;
    const paletteKey = labelMap[label];
    if (!paletteKey) return;
    const palette = EDGE_PALETTE[paletteKey];
    if (!palette) return;

    const path = pathChildren[idx];
    paintPath(path, palette);
    paintLabelGroup(labelGroup, palette);

    usedKeys.add(paletteKey);
    matchedAny = true;
  });

  if (!matchedAny) return svg;

  const css = Array.from(usedKeys)
    .map((key) => EDGE_PALETTE_CSS[key])
    .filter(Boolean)
    .join('\n');

  const existingStyle = root.querySelector(':scope > style[data-edge-labels="true"]');
  const styleEl = existingStyle ?? doc.createElementNS(SVG_NS, 'style');
  styleEl.setAttribute('data-edge-labels', 'true');
  styleEl.setAttribute('type', 'text/css');
  styleEl.textContent = css;
  if (!existingStyle) {
    root.insertBefore(styleEl, root.firstChild);
  }

  return new XMLSerializer().serializeToString(root);
}

function paintPath(path: Element | undefined, palette: EdgePaletteEntry): void {
  if (!path) return;
  path.setAttribute('stroke', palette.stroke);
  path.setAttribute('stroke-width', palette.strokeWidth);
  if (palette.dasharray) {
    path.setAttribute('stroke-dasharray', palette.dasharray);
  }
  path.removeAttribute('style');
  path.setAttribute('data-edge-palette', palette.stroke);
}

export const DIAGRAM_TEXT_FILL = '#0f172a';

export const CLUSTER_TITLE_FONT_SIZE = '21px';
export const CLUSTER_TITLE_FONT_WEIGHT = '700';

export function applyClusterTitleSizing(svg: string): string {
  if (!svg || typeof svg !== 'string') return svg;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  } catch {
    return svg;
  }
  const root = doc.documentElement;
  if (!root || root.nodeName !== 'svg') return svg;

  let touched = false;
  const labels = root.getElementsByTagNameNS('*', 'g');
  for (const g of Array.from(labels)) {
    if (!/(?:^|\s)cluster-label(?:\s|$)/.test(g.getAttribute('class') ?? '')) continue;
    const text = g.getElementsByTagNameNS('*', 'text')[0];
    if (!text) continue;
    text.setAttribute('font-size', CLUSTER_TITLE_FONT_SIZE);
    text.setAttribute('font-weight', CLUSTER_TITLE_FONT_WEIGHT);
    text.setAttribute('font-family', '"Inter", system-ui, sans-serif');
    text.setAttribute('fill', DIAGRAM_TEXT_FILL);
    text.setAttribute('stroke', 'none');
    for (const tspan of Array.from(text.getElementsByTagNameNS('*', 'tspan'))) {
      tspan.setAttribute('font-size', CLUSTER_TITLE_FONT_SIZE);
      tspan.setAttribute('font-weight', CLUSTER_TITLE_FONT_WEIGHT);
      tspan.setAttribute('font-family', '"Inter", system-ui, sans-serif');
      tspan.setAttribute('fill', DIAGRAM_TEXT_FILL);
      tspan.setAttribute('stroke', 'none');
    }
    touched = true;
  }

  return touched ? new XMLSerializer().serializeToString(root) : svg;
}

export const NODE_LABEL_FONT_SIZE = '16px';
export const NODE_LABEL_FONT_WEIGHT = '600';

export function applyNodeLabelFontSize(
  svg: string,
  fontSize: string = NODE_LABEL_FONT_SIZE,
  fontWeight: string = NODE_LABEL_FONT_WEIGHT,
): string {
  if (!svg || typeof svg !== 'string') return svg;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  } catch {
    return svg;
  }
  const root = doc.documentElement;
  if (!root || root.nodeName !== 'svg') return svg;

  let touched = false;
  const nodeGroups = root.getElementsByTagNameNS('*', 'g');
  for (const g of Array.from(nodeGroups)) {
    const cls = g.getAttribute('class') ?? '';
    if (!/(?:^|\s)node(?:\s|$)/.test(cls)) continue;
    const text = g.getElementsByTagNameNS('*', 'text')[0];
    if (!text) continue;
    text.setAttribute('font-size', fontSize);
    text.setAttribute('font-weight', fontWeight);
    text.setAttribute('font-family', '"Inter", system-ui, sans-serif');
    text.setAttribute('fill', DIAGRAM_TEXT_FILL);
    text.setAttribute('stroke', 'none');
    for (const tspan of Array.from(text.getElementsByTagNameNS('*', 'tspan'))) {
      tspan.setAttribute('font-size', fontSize);
      tspan.setAttribute('font-weight', fontWeight);
      tspan.setAttribute('font-family', '"Inter", system-ui, sans-serif');
      tspan.setAttribute('fill', DIAGRAM_TEXT_FILL);
      tspan.setAttribute('stroke', 'none');
    }
    touched = true;
  }

  return touched ? new XMLSerializer().serializeToString(root) : svg;
}

export const EDGE_LABEL_VERTICAL_OFFSET = 22;

export const DIAGRAM_BACKGROUND_FILL = '#ffffff';

export function applySvgBackground(svg: string): string {
  if (!svg || typeof svg !== 'string') return svg;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  } catch {
    return svg;
  }
  const root = doc.documentElement;
  if (!root || root.nodeName !== 'svg') return svg;

  const SVG_NS = 'http://www.w3.org/2000/svg';

  let width = 0;
  let height = 0;
  let x = 0;
  let y = 0;
  const viewBox = root.getAttribute('viewBox');
  if (viewBox) {
    const parts = viewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      [x, y, width, height] = parts;
    }
  }
  if (!Number.isFinite(width) || width <= 0) {
    const w = root.getAttribute('width');
    const m = w && /[\d.]+/.exec(w);
    if (m) width = parseFloat(m[0]);
  }
  if (!Number.isFinite(height) || height <= 0) {
    const h = root.getAttribute('height');
    const m = h && /[\d.]+/.exec(h);
    if (m) height = parseFloat(m[0]);
  }
  if (!Number.isFinite(width) || width <= 0) width = 1;
  if (!Number.isFinite(height) || height <= 0) height = 1;

  const existing = root.querySelector(':scope > rect[data-diagram-bg="true"]');

  const rect = existing ?? (doc.createElementNS(SVG_NS, 'rect') as SVGRectElement);
  rect.setAttribute('x', String(x));
  rect.setAttribute('y', String(y));
  rect.setAttribute('width', String(width));
  rect.setAttribute('height', String(height));
  rect.setAttribute('fill', DIAGRAM_BACKGROUND_FILL);
  rect.setAttribute('stroke', 'none');
  rect.setAttribute('data-diagram-bg', 'true');

  if (!existing) {
    root.insertBefore(rect, root.firstChild);
  }

  return new XMLSerializer().serializeToString(root);
}

export function applyEdgeLabelCentering(svg: string): string {
  if (!svg || typeof svg !== 'string') return svg;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  } catch {
    return svg;
  }
  const root = doc.documentElement;
  if (!root || root.nodeName !== 'svg') return svg;

  let touched = false;
  const labels = root.getElementsByTagNameNS('*', 'g');
  for (const g of Array.from(labels)) {
    const cls = g.getAttribute('class') ?? '';
    if (!/(?:^|\s)edgeLabel(?:\s|$)/.test(cls)) continue;
    const transform = g.getAttribute('transform') ?? '';
    const m = transform.match(/translate\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/);
    if (!m) continue;
    const tx = parseFloat(m[1]);
    const ty = parseFloat(m[2]);
    g.setAttribute('transform', `translate(${tx}, ${ty - EDGE_LABEL_VERTICAL_OFFSET})`);
    touched = true;
  }

  return touched ? new XMLSerializer().serializeToString(root) : svg;
}

function paintLabelGroup(labelGroup: Element, palette: EdgePaletteEntry): void {
  const padX = 12;
  const padY = 7;
  const radius = 4;

  const rect = labelGroup.querySelector('rect.background, rect');
  if (rect) {
    const origX = parseFloat(rect.getAttribute('x') ?? '0');
    const origY = parseFloat(rect.getAttribute('y') ?? '0');
    const origW = parseFloat(rect.getAttribute('width') ?? '0');
    const origH = parseFloat(rect.getAttribute('height') ?? '0');
    if (Number.isFinite(origW) && origW > 0) {
      rect.setAttribute('x', String(origX - padX));
      rect.setAttribute('width', String(origW + padX * 2));
    }
    if (Number.isFinite(origH) && origH > 0) {
      rect.setAttribute('y', String(origY - padY));
      rect.setAttribute('height', String(origH + padY * 2));
    }
    if (radius > 0) {
      rect.setAttribute('rx', String(radius));
      rect.setAttribute('ry', String(radius));
    }
    rect.setAttribute('fill', palette.labelBg);
    rect.setAttribute('stroke', palette.stroke);
    rect.setAttribute('style', `fill: ${palette.labelBg}; stroke: ${palette.stroke};`);
    rect.setAttribute('data-edge-palette', palette.stroke);
  }
  const text = labelGroup.querySelector('text');
  if (text) {
    const origY = parseFloat(text.getAttribute('y') ?? '0');
    if (Number.isFinite(origY)) {
      text.setAttribute('y', String(origY + padY));
    }
    text.setAttribute('fill', palette.labelFg);
    text.setAttribute('stroke', 'none');
    text.setAttribute('font-family', '"Inter", system-ui, sans-serif');
    text.setAttribute(
      'style',
      `fill: ${palette.labelFg}; stroke: none; font-weight: 700; font-family: "Inter", system-ui, sans-serif;`,
    );
  }
  for (const tspan of Array.from(labelGroup.querySelectorAll('tspan'))) {
    tspan.setAttribute('fill', palette.labelFg);
    tspan.setAttribute('font-family', '"Inter", system-ui, sans-serif');
    tspan.setAttribute(
      'style',
      `fill: ${palette.labelFg}; stroke: none; font-weight: 700; font-family: "Inter", system-ui, sans-serif;`,
    );
  }
}

const EDGE_PALETTE_CSS: Record<string, string> = {
  'edge-uses': `
    g.edgePaths path[data-edge-palette="#0284c7"] { stroke: #0284c7 !important; stroke-width: 2.5px !important; }
    g.edgeLabels rect[data-edge-palette="#0284c7"] { fill: #0284c7 !important; stroke: #0284c7 !important; }
    g.edgeLabels text[fill="#ffffff"] { fill: #ffffff !important; }
  `,
  'edge-impl': `
    g.edgePaths path[data-edge-palette="#7c3aed"] { stroke: #7c3aed !important; stroke-width: 2.5px !important; stroke-dasharray: 6 4 !important; }
    g.edgeLabels rect[data-edge-palette="#7c3aed"] { fill: #7c3aed !important; stroke: #7c3aed !important; }
    g.edgeLabels text[fill="#ffffff"] { fill: #ffffff !important; }
  `,
};
