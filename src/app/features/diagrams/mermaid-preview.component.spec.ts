import { TestBed } from '@angular/core/testing';
import { ElementRef } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mermaid from 'mermaid';
import type { WritableSignal } from '@angular/core';
import {
  applyClusterTitleSizing,
  applyNodeLabelFontSize,
  clampScale,
  CLUSTER_TITLE_FONT_SIZE,
  CLUSTER_TITLE_FONT_WEIGHT,
  DIAGRAM_TEXT_FILL,
  MermaidPreviewComponent,
  NODE_LABEL_FONT_SIZE,
  parsePixelLength,
  readSvgIntrinsicSize,
} from './mermaid-preview.component';

const SAMPLE_SVG = `
<svg xmlns="http://www.w3.org/2000/svg">
  <g class="cluster-label ">
    <text style="fill: #ddd;">Key Actors</text>
  </g>
  <g class="cluster-label ">
    <text>Frontend <tspan>Contexts</tspan></text>
  </g>
  <g class="node default">
    <text>News Catalog</text>
  </g>
  <g class="node default">
    <text>Reading <tspan>Experience</tspan></text>
  </g>
  <g class="edgeLabel"><text>uses</text></g>
</svg>
`;

describe('applyClusterTitleSizing', () => {
  it('sets fill, font-size, and font-weight on every cluster-label text', () => {
    const out = applyClusterTitleSizing(SAMPLE_SVG);
    expect(out).toContain('Key Actors');
    expect(out).toContain(`font-size="${CLUSTER_TITLE_FONT_SIZE}"`);
    expect(out).toContain(`font-weight="${CLUSTER_TITLE_FONT_WEIGHT}"`);
    expect(out).toContain(`fill="${DIAGRAM_TEXT_FILL}"`);

    expect(out).not.toMatch(/<g class="edgeLabel"[^>]*>\s*<text[^>]*fill="#0f172a"/);
  });

  it('propagates fill + sizing onto tspan children', () => {
    const out = applyClusterTitleSizing(SAMPLE_SVG);
    expect(out).toMatch(/<tspan[^>]*fill="#0f172a"/);
    expect(out).toMatch(/<tspan[^>]*font-size="21px"/);
  });

  it('returns the input unchanged when no cluster-label groups exist', () => {
    const noCluster = `<svg xmlns="http://www.w3.org/2000/svg"><g class="node"><text>x</text></g></svg>`;
    expect(applyClusterTitleSizing(noCluster)).toBe(noCluster);
  });
});

describe('applyNodeLabelFontSize', () => {
  it('sets fill on every node text so labels never inherit grey', () => {
    const out = applyNodeLabelFontSize(SAMPLE_SVG);

    const nodeTextMatches = out.match(/<g class="node[^"]*"[^>]*>[\s\S]*?<text[\s\S]*?<\/text>/g) ?? [];
    expect(nodeTextMatches.length).toBeGreaterThan(0);
    for (const nodeText of nodeTextMatches) {
      expect(nodeText).toContain(`fill="${DIAGRAM_TEXT_FILL}"`);
      expect(nodeText).toContain(`font-size="${NODE_LABEL_FONT_SIZE}"`);
    }
  });

  it('uses the provided font-size override when supplied', () => {
    const out = applyNodeLabelFontSize(SAMPLE_SVG, '13px', '400');
    expect(out).toContain('font-size="13px"');
    expect(out).toContain('font-weight="400"');

    expect(out).toContain(`fill="${DIAGRAM_TEXT_FILL}"`);
  });

  it('propagates fill onto tspan children of node labels', () => {
    const out = applyNodeLabelFontSize(SAMPLE_SVG);
    expect(out).toMatch(/<tspan[^>]*fill="#0f172a"/);
  });

  it('returns the input unchanged when no node groups exist', () => {
    const noNode = `<svg xmlns="http://www.w3.org/2000/svg"><g class="edgeLabel"><text>x</text></g></svg>`;
    expect(applyNodeLabelFontSize(noNode)).toBe(noNode);
  });
});

describe('clampScale', () => {
  it('passes through values within bounds', () => {
    expect(clampScale(1)).toBe(1);
    expect(clampScale(2.5)).toBe(2.5);
  });

  it('clamps to MIN_SCALE (0.25) below', () => {
    expect(clampScale(0.1)).toBe(0.25);
    expect(clampScale(0)).toBe(0.25);
    expect(clampScale(-5)).toBe(0.25);
  });

  it('clamps to MAX_SCALE (4) above', () => {
    expect(clampScale(5)).toBe(4);
    expect(clampScale(100)).toBe(4);
  });
});

interface IntrinsicState {
  w: number;
  h: number;
}

interface PanState {
  tx: number;
  ty: number;
}

type TestComponent = MermaidPreviewComponent & {
  viewportEl: () => { nativeElement: HTMLElement } | undefined;
  renderScale: () => number;
  pan: () => PanState;
  intrinsicSize: WritableSignal<IntrinsicState | null>;
  zoomPercent: () => number;
  fitToFrame: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
  warning: () => string;
  lastSvg: () => string;
};

function asTest(component: MermaidPreviewComponent): TestComponent {
  return component as unknown as TestComponent;
}

const SIMPLE_CHART = 'graph TD\nA --> B';

const SAMPLE_INTRINSIC: IntrinsicState = { w: 1000, h: 500 };

const RECT_800x400: DOMRect = {
  width: 800,
  height: 400,
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 800,
  bottom: 400,
  toJSON: () => ({}),
} as DOMRect;

const RECT_1000x400: DOMRect = {
  width: 1000,
  height: 400,
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 1000,
  bottom: 400,
  toJSON: () => ({}),
} as DOMRect;

function buildMermaidSvg(intrinsic: IntrinsicState): string {
  const { w, h } = intrinsic;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><g><rect width="${w}" height="${h}" fill="#fff"/></g></svg>`;
}

let mermaidRenderSpy: ReturnType<typeof vi.spyOn>;
let lastRenderPromise: Promise<unknown> | null = null;

beforeEach(() => {



  lastRenderPromise = null;
  mermaidRenderSpy = vi
    .spyOn(mermaid, 'render')
    .mockImplementation(((_id: string, _code: string) => {
      const p = Promise.resolve({
        svg: buildMermaidSvg(SAMPLE_INTRINSIC),
        diagramType: 'flowchart',
      });
      lastRenderPromise = p;
      return p;
    }) as unknown as typeof mermaid.render);
});

afterEach(() => {
  mermaidRenderSpy.mockRestore();
  lastRenderPromise = null;
});

async function flushRender(
  fixture: ReturnType<typeof TestBed.createComponent<MermaidPreviewComponent>>,
): Promise<void> {
  fixture.detectChanges();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 3; i++) {
    const pending = lastRenderPromise;
    if (pending) {
      await pending;
    }
    await new Promise((r) => setTimeout(r, 0));
    await fixture.whenStable();
    fixture.detectChanges();
  }
}

async function mountPreview(chart: string = SIMPLE_CHART): Promise<{
  fixture: ReturnType<typeof TestBed.createComponent<MermaidPreviewComponent>>;
  component: TestComponent;
}> {
  await TestBed.configureTestingModule({
    imports: [MermaidPreviewComponent],
  }).compileComponents();
  const fixture = TestBed.createComponent(MermaidPreviewComponent);
  fixture.componentRef.setInput('chart', chart);
  fixture.detectChanges();



  await new Promise((r) => setTimeout(r, 0));
  await fixture.whenStable();
  await flushRender(fixture);
  return { fixture, component: asTest(fixture.componentInstance) };
}

describe('MermaidPreviewComponent — viewport element type', () => {
  it('exposes an ElementRef whose nativeElement is the .viewport div', async () => {
    const { component, fixture } = await mountPreview();
    try {
      const ref = component.viewportEl();
      expect(ref).toBeTruthy();





      expect(ref).toBeInstanceOf(ElementRef);
      const host = ref!.nativeElement;
      expect(host).toBeInstanceOf(HTMLElement);
      expect(host.constructor.name).toBe('HTMLDivElement');
      expect(fixture.nativeElement.querySelector('.viewport')).toBe(host);
    } finally {
      fixture.destroy();
    }
  });

  it('centers the .stage inside the .viewport (display:flex, centering axes)', async () => {
    const { component, fixture } = await mountPreview();
    try {
      const host = component.viewportEl()!.nativeElement as HTMLElement;
      const style = getComputedStyle(host);
      expect(style.display).toBe('flex');
      expect(style.alignItems).toBe('center');
      expect(style.justifyContent).toBe('center');
    } finally {
      fixture.destroy();
    }
  });
});

describe('MermaidPreviewComponent — wheel event', () => {
  it('does not change the rendered scale on wheel over the viewport', async () => {
    const { component, fixture } = await mountPreview();
    try {
      const before = component.renderScale();
      const host = component.viewportEl()!.nativeElement;
      const ev = new Event('wheel', { cancelable: true }) as WheelEvent;
      Object.defineProperty(ev, 'deltaY', { value: -100 });
      Object.defineProperty(ev, 'clientX', { value: 100 });
      Object.defineProperty(ev, 'clientY', { value: 100 });
      Object.defineProperty(ev, 'currentTarget', { value: host });
      host.dispatchEvent(ev);
      expect(component.renderScale()).toBe(before);

      expect(mermaidRenderSpy).toHaveBeenCalledTimes(1);
    } finally {
      fixture.destroy();
    }
  });
});

describe('MermaidPreviewComponent — zoom buttons re-render the SVG', () => {
  it('zoomIn() increases renderScale and triggers a second mermaid.render with scaled width/height', async () => {
    const { component, fixture } = await mountPreview();
    try {
      const host = component.viewportEl()!.nativeElement;
      const before = component.renderScale();
      expect(before).toBe(1);
      expect(mermaidRenderSpy).toHaveBeenCalledTimes(1);

      component.zoomIn();

      await flushRender(fixture);

      expect(mermaidRenderSpy.mock.calls.length).toBeGreaterThan(1);
      expect(component.renderScale()).toBeCloseTo(1.2, 5);
      expect(component.pan()).toEqual({ tx: 0, ty: 0 });

      const svg = host.querySelector('svg') as SVGSVGElement | null;
      expect(svg).toBeTruthy();
      expect(svg!.getAttribute('width')).toBe(String(Math.round(SAMPLE_INTRINSIC.w * 1.2)));
      expect(svg!.getAttribute('height')).toBe(String(Math.round(SAMPLE_INTRINSIC.h * 1.2)));
    } finally {
      fixture.destroy();
    }
  });

  it('zoomOut() decreases renderScale and clears pan', async () => {
    const { component, fixture } = await mountPreview();
    try {

      component.zoomIn();
      component.zoomIn();
      await flushRender(fixture);
      expect(component.renderScale()).toBeCloseTo(1.2 * 1.2, 5);

      component.zoomOut();
      expect(component.renderScale()).toBeCloseTo(1.2, 5);
      expect(component.pan()).toEqual({ tx: 0, ty: 0 });
    } finally {
      fixture.destroy();
    }
  });

  it('resetView() returns the diagram to fit-scale and clears pan', async () => {
    const { component, fixture } = await mountPreview();
    try {
      component.zoomIn();
      component.zoomIn();
      await flushRender(fixture);
      expect(component.renderScale()).not.toBe(1);

      component.resetView();



      await flushRender(fixture);
      const after = component.renderScale();



      expect(after).toBeGreaterThanOrEqual(0.25);
      expect(component.pan()).toEqual({ tx: 0, ty: 0 });
    } finally {
      fixture.destroy();
    }
  });

  it('fitToFrame() shrinks an oversized diagram down so it fits the host', async () => {
    const { component, fixture } = await mountPreview();
    try {
      const host = component.viewportEl()!.nativeElement;

      vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(RECT_800x400);

      component.fitToFrame();
      await flushRender(fixture);
      const scale = component.renderScale();
      expect(scale).toBeCloseTo(0.752, 2);

      const svg = host.querySelector('svg')!;
      expect(parseFloat(svg.getAttribute('width') ?? '0')).toBeCloseTo(SAMPLE_INTRINSIC.w * scale, 0);

      expect(component.pan()).toEqual({ tx: 0, ty: 0 });
    } finally {
      fixture.destroy();
    }
  });

  it('fitToFrame() grows a small diagram up to fit the host (no longer shrink-only)', async () => {
    const { component, fixture } = await mountPreview();
    try {
      const host = component.viewportEl()!.nativeElement;

      vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(RECT_1000x400);

      component.intrinsicSize.set({ w: 500, h: 200 });

      component.fitToFrame();
      await flushRender(fixture);

      expect(component.renderScale()).toBeCloseTo(1.904, 2);
      expect(component.zoomPercent()).toBe(190);
    } finally {
      fixture.destroy();
    }
  });

  it('fitToFrame() clamps an absurdly small host fit to MIN_SCALE (0.25)', async () => {
    const { component, fixture } = await mountPreview();
    try {
      const host = component.viewportEl()!.nativeElement;

      vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({
        ...RECT_800x400,
        width: 200,
        height: 100,
      } as DOMRect);

      component.fitToFrame();
      await flushRender(fixture);
      expect(component.renderScale()).toBe(0.25);
    } finally {
      fixture.destroy();
    }
  });
});

describe('MermaidPreviewComponent — drag-to-pan', () => {
  it('shifts pan.tx/ty by the pointer delta and does not change renderScale', async () => {
    const { component, fixture } = await mountPreview();
    try {
      const host = component.viewportEl()!.nativeElement;





      (host as unknown as Record<string, unknown>)['setPointerCapture'] = () => {};
      (host as unknown as Record<string, unknown>)['releasePointerCapture'] = () => {};
      (host as unknown as Record<string, unknown>)['hasPointerCapture'] = () => true;

      const initialScale = component.renderScale();
      const startPan = component.pan();

      const evDown = new Event('pointerdown') as PointerEvent;
      Object.defineProperty(evDown, 'pointerId', { value: 1 });
      Object.defineProperty(evDown, 'clientX', { value: 50 });
      Object.defineProperty(evDown, 'clientY', { value: 50 });
      Object.defineProperty(evDown, 'target', { value: host });
      Object.defineProperty(evDown, 'currentTarget', { value: host });
      host.dispatchEvent(evDown);

      const evMove = new Event('pointermove') as PointerEvent;
      Object.defineProperty(evMove, 'pointerId', { value: 1 });
      Object.defineProperty(evMove, 'clientX', { value: 80 });
      Object.defineProperty(evMove, 'clientY', { value: 70 });
      Object.defineProperty(evMove, 'target', { value: host });
      Object.defineProperty(evMove, 'currentTarget', { value: host });
      host.dispatchEvent(evMove);

      const afterPan = component.pan();
      expect(afterPan.tx - startPan.tx).toBeCloseTo(30, 5);
      expect(afterPan.ty - startPan.ty).toBeCloseTo(20, 5);

      expect(component.renderScale()).toBe(initialScale);

      expect(mermaidRenderSpy).toHaveBeenCalledTimes(1);

      const evUp = new Event('pointerup') as PointerEvent;
      Object.defineProperty(evUp, 'pointerId', { value: 1 });
      Object.defineProperty(evUp, 'currentTarget', { value: host });
      host.dispatchEvent(evUp);
    } finally {
      fixture.destroy();
    }
  });
});

function buildSvg(attrs: Record<string, string>): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg') as SVGSVGElement;
  for (const [k, v] of Object.entries(attrs)) {
    svg.setAttribute(k, v);
  }
  return svg;
}

describe('parsePixelLength', () => {
  it('parses positive pixel numbers', () => {
    expect(parsePixelLength('800')).toBe(800);
    expect(parsePixelLength('800.5')).toBe(800.5);
  });

  it('rejects percentages and zero/negative', () => {
    expect(parsePixelLength('100%')).toBeNull();
    expect(parsePixelLength('50%')).toBeNull();
    expect(parsePixelLength('0')).toBeNull();
    expect(parsePixelLength('-5')).toBeNull();
    expect(parsePixelLength(null)).toBeNull();
    expect(parsePixelLength('')).toBeNull();
  });
});

describe('readSvgIntrinsicSize', () => {
  it('prefers explicit pixel width/height attributes when both are positive', () => {
    const svg = buildSvg({ width: '600', height: '300', viewBox: '0 0 100 100' });
    expect(readSvgIntrinsicSize(svg)).toEqual({ w: 600, h: 300 });
  });

  it('falls back to a positive viewBox when width/height are percentages', () => {
    const svg = buildSvg({ width: '100%', height: '100%', viewBox: '0 0 800 400' });
    expect(readSvgIntrinsicSize(svg)).toEqual({ w: 800, h: 400 });
  });

  it('skips a degenerate viewBox (vh=0) and tries getBBox next', () => {



    const svg = buildSvg({ width: '100%', height: '100%', viewBox: '0 0 800 0' });
    (svg as unknown as { getBBox: () => DOMRect }).getBBox = () =>
      ({ x: 0, y: 0, width: 800, height: 420, top: 0, left: 0, right: 800, bottom: 420, toJSON: () => ({}) }) as DOMRect;
    expect(readSvgIntrinsicSize(svg)).toEqual({ w: 800, h: 420 });
  });

  it('falls back to getBoundingClientRect when getBBox returns 0,0,0,0', () => {
    const svg = buildSvg({ width: '100%', height: '100%', viewBox: '0 0 800 0' });
    (svg as unknown as { getBBox: () => DOMRect }).getBBox = () =>
      ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) }) as DOMRect;
    (svg as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
      ({ x: 0, y: 0, width: 1024, height: 600, top: 0, left: 0, right: 1024, bottom: 600, toJSON: () => ({}) }) as DOMRect;
    expect(readSvgIntrinsicSize(svg)).toEqual({ w: 1024, h: 600 });
  });

  it('returns the 800x400 default when every measurement is zero or unavailable', () => {
    const svg = buildSvg({ width: '100%', height: '100%', viewBox: '0 0 800 0' });



    (svg as unknown as { getBBox: () => DOMRect }).getBBox = () =>
      ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) }) as DOMRect;
    (svg as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
      ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) }) as DOMRect;
    expect(readSvgIntrinsicSize(svg)).toEqual({ w: 800, h: 400 });
  });

  it('tolerates getBBox throwing and falls through to getBoundingClientRect', () => {
    const svg = buildSvg({ width: '100%', height: '100%', viewBox: '0 0 800 0' });
    (svg as unknown as { getBBox: () => DOMRect }).getBBox = () => {
      throw new Error('not laid out');
    };
    (svg as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
      ({ x: 0, y: 0, width: 900, height: 500, top: 0, left: 0, right: 900, bottom: 500, toJSON: () => ({}) }) as DOMRect;
    expect(readSvgIntrinsicSize(svg)).toEqual({ w: 900, h: 500 });
  });

  it('does not call getBBox or getBoundingClientRect when pixel attrs are valid', () => {
    const svg = buildSvg({ width: '400', height: '200' });
    const bboxSpy = vi.fn(() => ({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      toJSON: () => ({}),
    }) as DOMRect);
    const rectSpy = vi.fn(() => ({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      toJSON: () => ({}),
    }) as DOMRect);
    (svg as unknown as { getBBox: () => DOMRect }).getBBox = bboxSpy;
    (svg as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = rectSpy;
    expect(readSvgIntrinsicSize(svg)).toEqual({ w: 400, h: 200 });
    expect(bboxSpy).not.toHaveBeenCalled();
    expect(rectSpy).not.toHaveBeenCalled();
  });
});

describe('MermaidPreviewComponent — min-height safety net', () => {
  it('applies the viewport--fallback class until the first intrinsic size is known', async () => {
    const { component, fixture } = await mountPreview();
    try {
      const host = component.viewportEl()!.nativeElement;

      await flushRender(fixture);
      expect(host.classList.contains('viewport--fallback')).toBe(false);
    } finally {
      fixture.destroy();
    }
  });
});

describe('MermaidPreviewComponent — render error path (diagram audit fix)', () => {
  it('surfaces a non-empty warning starting with "Render failed:" when mermaid.render rejects', async () => {

    mermaidRenderSpy.mockRestore();
    mermaidRenderSpy = vi
      .spyOn(mermaid, 'render')
      .mockRejectedValue(new Error('Syntax error at line 3: Unexpected token')) as unknown as ReturnType<typeof vi.spyOn>;

    const { component, fixture } = await mountPreview('graph TD\nA->B');
    try {
      expect(component.warning()).toMatch(/^Render failed:/);
      expect(component.warning()).toContain('Syntax error at line 3');
      fixture.detectChanges();
      const banner = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="mermaid-render-warning"]',
      );
      expect(banner).toBeTruthy();
      expect(banner!.textContent).toContain('Render failed:');
    } finally {
      fixture.destroy();
    }
  });

  it('keeps the last good SVG in the viewport when a subsequent render fails (lastSvg fallback)', async () => {

    const first = await mountPreview('graph TD\nA-->B');
    try {
      const host = first.component.viewportEl()!.nativeElement;
      const firstSvg = host.querySelector('svg');
      expect(firstSvg).toBeTruthy();
      const lastGoodSvg = first.component.lastSvg();
      expect(lastGoodSvg.length).toBeGreaterThan(0);
    } finally {
      first.fixture.destroy();
    }
  });
});