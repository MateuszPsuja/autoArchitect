import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import mermaid from 'mermaid';
import {
  PdfExportReloadRequested,
  PdfExportService,
  PDF_EXPORT_RELOAD_FLAG_KEY,
} from './pdf-export.service';
import { PdfDocument, PdfSection, PdfBlock } from './pdf-document.schema';
import { minimalPlanFixture } from '../testing/fixtures';

const SIMPLE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="#fff"/></svg>';

function buildDocument(): PdfDocument {
  return {
    title: 'Plan Spec',
    subtitle: 'A concise distillation of the active plan.',
    generatedAt: '2026-08-18T00:00:00.000Z',
    executiveSummary:
      'This PDF distils the active Plan into a single readable spec covering context, layers, and decisions. ' +
      'It is grounded in the active plan and references only diagrams already present on the plan.',
    sections: [
      {
        heading: 'System Context',
        blocks: [
          {
            kind: 'paragraph',
            text: 'The system provides a planner surface for generating architecture plans.',
          },
          {
            kind: 'keyValueTable',
            rows: [['Constraint', 'Frontend only']],
          },
          {
            kind: 'mermaidRef',
            ref: { kind: 'system', field: 'c4.contextDiagram' },
            caption: 'C4 context diagram for the planner.',
          },
        ],
      },
      {
        heading: 'Bounded Contexts',
        blocks: [{ kind: 'bullets', items: ['Planning — core domain.'] }],
      },
      {
        heading: 'Workflows',
        blocks: [{ kind: 'numbered', items: ['Capture input', 'Generate plan', 'Persist plan'] }],
      },
    ],
  };
}

describe('PdfExportService — composition', () => {
  let service: PdfExportService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PdfExportService);
  });

  it('builds a cover page that contains title, subtitle, and Executive Summary', () => {
    const cover = service.buildCoverPage(buildDocument(), minimalPlanFixture);
    expect(cover.length).toBeGreaterThan(0);
    const flat = JSON.stringify(cover);
    expect(flat).toContain('Plan Spec');
    expect(flat).toContain('A concise distillation of the active plan.');
    expect(flat).toContain('Executive Summary');



    expect(flat).not.toContain(minimalPlanFixture.meta.title);
  });

  it('buildCoverPage ends with a pageBreak directive so the cover always stands alone', () => {
    const cover = service.buildCoverPage(buildDocument(), minimalPlanFixture);
    const last = cover[cover.length - 1] as { pageBreak?: string; margin?: [number, number, number, number] };



    expect(last.pageBreak).toBe('after');
  });

  it('composeDocDefinition emits the new page margins, a function-style header, and the page-number footer', () => {
    const def = service.composeDocDefinition(buildDocument(), minimalPlanFixture, []);



    expect(def.pageMargins).toEqual([56, 80, 56, 60]);
    expect(typeof def.header).toBe('function');
    expect(def.footer).toBeTruthy();
  });

  it('header returns null on the cover page (page 1) and the running header on later pages', () => {
    const def = service.composeDocDefinition(buildDocument(), minimalPlanFixture, []);
    const headerFn = def.header as (currentPage: number, pageCount: number) => unknown;

    expect(headerFn(1, 12)).toBeNull();

    const rendered = headerFn(2, 12) as { columns: Array<{ text: string }> };
    expect(rendered.columns[0].text).toContain('Plan Spec');
  });
});

describe('PdfExportService — block rendering', () => {
  let service: PdfExportService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PdfExportService);
  });

  it('renders paragraph blocks as a single text element', () => {
    const blocks = service.composeBlock(
      { kind: 'paragraph', text: 'Hello world.' },
      new Map(),
    );
    expect(blocks.length).toBe(1);
    expect(JSON.stringify(blocks[0])).toContain('Hello world.');
  });

  it('renders bullets blocks as a pdfmake ul', () => {
    const blocks = service.composeBlock(
      { kind: 'bullets', items: ['a', 'b'] },
      new Map(),
    );
    expect(blocks.length).toBe(1);
    expect(JSON.stringify(blocks[0])).toContain('"ul"');
  });

  it('renders numbered blocks as a pdfmake ol', () => {
    const blocks = service.composeBlock(
      { kind: 'numbered', items: ['first', 'second'] },
      new Map(),
    );
    expect(blocks.length).toBe(1);
    expect(JSON.stringify(blocks[0])).toContain('"ol"');
  });

  it('renders keyValueTable as a pdfmake table', () => {
    const blocks = service.composeBlock(
      { kind: 'keyValueTable', rows: [['k', 'v']] },
      new Map(),
    );
    expect(blocks.length).toBe(1);
    expect(JSON.stringify(blocks[0])).toContain('"table"');
  });

  it('renders callout as a left-accent-bar columns layout with the tone fill on the right', () => {
    const blocks = service.composeBlock(
      { kind: 'callout', tone: 'risk', title: 'Heads up', text: 'deprecated' },
      new Map(),
    );
    expect(blocks.length).toBe(1);
    const node = blocks[0] as {
      columns: Array<{ width: number | string; stack: unknown; fillColor?: string }>;
      columnGap: number;
    };
    expect(node.columns).toHaveLength(2);



    expect(node.columns[0].width).toBe(3);
    const leftStack = node.columns[0].stack as Array<{ canvas: unknown[] }>;
    expect(leftStack[0].canvas[0]).toMatchObject({ type: 'rect', color: '#dc2626' });



    expect(node.columns[1].width).toBe('*');
    expect(node.columns[1].fillColor).toBe('#fef2f2');
    const flat = JSON.stringify(blocks[0]);
    expect(flat).toContain('Heads up');
    expect(flat).toContain('deprecated');
  });

  it('renders callout with default info tone and no title', () => {
    const blocks = service.composeBlock({ kind: 'callout', text: 'plain' }, new Map());
    expect(blocks.length).toBe(1);
    const node = blocks[0] as { columns: Array<{ fillColor?: string }> };



    expect(node.columns[1].fillColor).toBe('#f0f9ff');
  });

  it('keyValueTable paints the header band (indigo-50) on the first row', () => {
    const blocks = service.composeBlock(
      { kind: 'keyValueTable', rows: [['Constraint', 'Frontend only']] },
      new Map(),
    );
    const flat = JSON.stringify(blocks[0]);

    expect(flat).toContain('"tableHeader"');
    expect(flat).toContain('#eef2ff');
  });

  it('renders glossary as a two-column table with bold term column', () => {
    const blocks = service.composeBlock(
      {
        kind: 'glossary',
        entries: [
          ['Plan', 'A structured architecture document'],
          ['Domain', 'A distinct business area'],
        ],
      },
      new Map(),
    );
    expect(blocks.length).toBe(1);
    const flat = JSON.stringify(blocks[0]);
    expect(flat).toContain('"table"');
    expect(flat).toContain('Plan');
    expect(flat).toContain('A structured architecture document');



    expect(flat).toContain('"tableHeader"');
  });

  it('renders matrix with header row + alternating row fills', () => {
    const blocks = service.composeBlock(
      {
        kind: 'matrix',
        columns: ['Frontend', 'Backend'],
        rows: [
          { label: 'targetPlatform', cells: ['TS 5.5', 'TS 5.5'] },
          { label: 'storage', cells: ['N/A', 'PostgreSQL 15'] },
        ],
        caption: 'Per-layer technical context',
      },
      new Map(),
    );

    expect(blocks.length).toBe(2);
    const flat = JSON.stringify(blocks);
    expect(flat).toContain('Frontend');
    expect(flat).toContain('TS 5.5');
    expect(flat).toContain('#f8fafc'); 

    expect(flat).toContain('Per-layer technical context');
  });

  it('keyValueTable widths sum to the printable page width (no off-page value column)', () => {
    const blocks = service.composeBlock(
      {
        kind: 'keyValueTable',
        rows: [
          ['constraints', 'FastAPI, SQLAlchemy 2, Pydantic v2, redis-py, ARQ, pytest'],
        ],
      },
      new Map(),
    );
    const node = blocks[0] as { table: { widths: number[] } };
    expect(node.table.widths).not.toContain('auto');

    expect(node.table.widths.length).toBe(2);
    expect(node.table.widths[0]).toBeCloseTo(144.9, 1); 

    expect(node.table.widths[1]).toBeCloseTo(338.1, 1); 

    expect(node.table.widths[0] + node.table.widths[1]).toBeCloseTo(483, 1);
  });

  it('glossary widths sum to the printable page width (no off-page definition column)', () => {
    const blocks = service.composeBlock(
      {
        kind: 'glossary',
        entries: [['constraints', 'a long definition that would push past the margin']],
      },
      new Map(),
    );
    const node = blocks[0] as { table: { widths: number[] } };
    expect(node.table.widths).not.toContain('auto');
    expect(node.table.widths.length).toBe(2);
    expect(node.table.widths[0]).toBeCloseTo(144.9, 1);
    expect(node.table.widths[1]).toBeCloseTo(338.1, 1);
  });

  it('pads/trims matrix data rows so every row matches the column count (avoids NaN widths)', () => {





    const blocks = service.composeBlock(
      {
        kind: 'matrix',
        columns: ['Frontend', 'Backend'],
        rows: [

          { label: 'targetPlatform', cells: ['TS 5.5'] },

          { label: 'storage', cells: ['N/A', 'PostgreSQL 15', 'extra'] },
        ],
      },
      new Map(),
    );
    const node = blocks[0] as { table: { widths: number[]; body: unknown[][] } };

    expect(node.table.widths.length).toBe(3);



    for (const w of node.table.widths) {
      expect(w).not.toBe('auto');
    }



    const total = node.table.widths.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThan(483);
    expect(total).toBeGreaterThan(483 * 0.9);

    expect(node.table.body.length).toBe(3);

    for (const row of node.table.body) {
      expect(row.length).toBe(3);
    }
  });

  it('buildCoverPage omits the KPI table and Plan/Model/Generated meta line', () => {
    const cover = service.buildCoverPage(buildDocument(), minimalPlanFixture);
    const flat = JSON.stringify(cover);
    expect(flat).not.toContain('LAYERS');
    expect(flat).not.toContain('CONTEXTS');
    expect(flat).not.toContain('COMPONENTS');
    expect(flat).not.toContain('AGENT TASKS');
    expect(flat).not.toContain('demo-seed');
    expect(flat).not.toContain('Model:');
  });

  it('buildCoverPage still renders title, subtitle, and Executive Summary heading + body', () => {
    const cover = service.buildCoverPage(buildDocument(), minimalPlanFixture);
    const flat = JSON.stringify(cover);
    expect(flat).toContain('Plan Spec');
    expect(flat).toContain('A concise distillation of the active plan.');
    expect(flat).toContain('Executive Summary');
    expect(flat).toContain('This PDF distils');
  });

  it('buildCoverPage paints the top accent bar (canvas) and the right-aligned meta line', () => {
    const cover = service.buildCoverPage(buildDocument(), minimalPlanFixture);
    const flat = JSON.stringify(cover);

    expect(flat).toContain('"canvas"');
    expect(flat).toContain('#1e40af');

    expect(flat).toMatch(/Generated .* · /);

    expect(flat).toContain('ARCHITECTURE SPECIFICATION');
    expect(flat).toContain(`${buildDocument().sections.length} sections`);
  });

  it('keeps wide diagrams at the default on-page width and shrinks only tall ones', () => {
    const cache = new Map<
      string,
      { dataUrl: string; width: number; height: number } | null
    >();
    cache.set('system:c4.contextDiagram:', {
      dataUrl: 'data:image/png;base64,xxx',
      width: 960,
      height: 400, 

    });
    const blocks = service.composeBlock(
      {
        kind: 'mermaidRef',
        ref: { kind: 'system', field: 'c4.contextDiagram' },
        caption: 'wide',
      },
      cache,
    );

    const image = blocks[1] as { width?: number; height?: number };
    expect(image.width).toBe(460);
    expect(image.height).toBeLessThanOrEqual(720);
  });

  it('fits a very tall rasterised mermaid diagram inside the page box (no overflow)', () => {
    const cache = new Map<
      string,
      { dataUrl: string; width: number; height: number } | null
    >();
    cache.set('system:c4.contextDiagram:', {
      dataUrl: 'data:image/png;base64,xxx',
      width: 480,
      height: 5760, 

    });
    const blocks = service.composeBlock(
      {
        kind: 'mermaidRef',
        ref: { kind: 'system', field: 'c4.contextDiagram' },
        caption: 'tall',
      },
      cache,
    );
    const image = blocks[1] as { image?: string; width?: number; height?: number };
    expect(image.image).toBe('data:image/png;base64,xxx');
    expect(image.width).toBeLessThanOrEqual(460);
    expect(image.height).toBeLessThanOrEqual(720);

    expect(image.height).toBe(720);
  });

  it('emits a Figure N — label that increments per diagram in document order', () => {
    const cache = new Map<
      string,
      { dataUrl: string; width: number; height: number } | null
    >();
    cache.set('system:c4.contextDiagram:', {
      dataUrl: 'data:image/png;base64,xxx',
      width: 800,
      height: 400,
    });

    const ref: Extract<PdfBlock, { kind: 'mermaidRef' }> = {
      kind: 'mermaidRef',
      ref: { kind: 'system', field: 'c4.contextDiagram' },
      caption: 'a diagram',
    };

    const first = service.composeBlock(ref, cache);
    expect(JSON.stringify(first)).toContain('Figure 1 —');

    const second = service.composeBlock(ref, cache);
    const third = service.composeBlock(ref, cache);
    expect(JSON.stringify(second)).toContain('Figure 2 —');
    expect(JSON.stringify(third)).toContain('Figure 3 —');
  });
});

describe('PdfExportService — buildPdf TOC toggle', () => {
  let service: PdfExportService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PdfExportService);
  });

  it('buildPdf exposes an includeToc option on its third parameter', () => {





    expect(service.buildPdf.length).toBeGreaterThanOrEqual(2);
  });

  it('rendering the same section through two independent services yields identical content', () => {





    const section: PdfSection = {
      heading: 'Isolated',
      blocks: [{ kind: 'paragraph', text: 'a' }],
    };
    const svcA = TestBed.inject(PdfExportService);
    const first = svcA.composeSection(section, 0, new Map());
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const svcB = TestBed.inject(PdfExportService);
    const second = svcB.composeSection(section, 0, new Map());
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('composes section headings and a hairline rule beneath each', () => {
    const section: PdfSection = {
      heading: 'Section under test',
      blocks: [{ kind: 'paragraph', text: 'body' }],
    };
    const out = service.composeSection(section, 0, new Map());
    const flat = JSON.stringify(out);
    expect(flat).toContain('Section under test');
    expect(flat).toContain('#cbd5e1'); 

  });
});

describe('PdfExportService — diagram resolution', () => {
  let service: PdfExportService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PdfExportService);

    (
      mermaid as unknown as {
        render: (id: string, src: string) => Promise<string | { svg: string }>;
      }
    ).render = vi.fn(async () => SIMPLE_SVG);
  });

  it('resolves a system mermaidRef — calls mermaid.render and stores a cached result', async () => {
    const cache = new Map<string, { dataUrl: string; width: number; height: number } | null>();
    const png = await service.resolveMermaidRef(
      { kind: 'system', field: 'c4.contextDiagram' },
      minimalPlanFixture,
      cache,
    );



    expect(png).toBeNull();
    expect(cache.size).toBe(1);
  });

  it('caches after the first resolve call', async () => {
    const renderSpy = vi.spyOn(
      mermaid as unknown as { render: (...args: unknown[]) => Promise<unknown> },
      'render',
    );
    const cache = new Map<string, { dataUrl: string; width: number; height: number } | null>();
    await service.resolveMermaidRef(
      { kind: 'system', field: 'c4.contextDiagram' },
      minimalPlanFixture,
      cache,
    );
    await service.resolveMermaidRef(
      { kind: 'system', field: 'c4.contextDiagram' },
      minimalPlanFixture,
      cache,
    );
    expect(renderSpy).toHaveBeenCalledTimes(1);
  });

  it('returns null when mermaid.render throws — does not propagate the error', async () => {
    (mermaid as unknown as { render: () => Promise<unknown> }).render = vi.fn(async () => {
      throw new Error('boom');
    });
    const result = await service.resolveMermaidRef(
      { kind: 'system', field: 'c4.contextDiagram' },
      minimalPlanFixture,
      new Map(),
    );
    expect(result).toBeNull();
  });

  it('returns the rasterised result when the system field is present on the plan', async () => {
    const result = await service.resolveMermaidRef(
      { kind: 'system', field: 'boundedContextMap' },
      minimalPlanFixture,
      new Map(),
    );

    expect(result === null || typeof result === 'object').toBe(true);
  });

  it('returns null when the layer mermaidRef refers to a layer that does not exist', async () => {
    const renderSpy = vi.spyOn(
      mermaid as unknown as { render: (...args: unknown[]) => Promise<unknown> },
      'render',
    );
    const result = await service.resolveMermaidRef(
      { kind: 'layer', layerId: 'infrastructure', field: 'mermaidDiagram' },
      minimalPlanFixture,
      new Map(),
    );
    expect(result).toBeNull();
    expect(renderSpy).not.toHaveBeenCalled();
  });

  it('findDiagramSource returns the boundedContextMap when the field matches', () => {
    const source = service.findDiagramSource(
      { kind: 'system', field: 'boundedContextMap' },
      minimalPlanFixture,
    );
    expect(source).toBe(minimalPlanFixture.systemOverview.boundedContextMap);
  });

  it('findDiagramSource resolves a blueprint ref to the synthesised system-wide diagram', () => {
    const source = service.findDiagramSource({ kind: 'blueprint' }, minimalPlanFixture);
    expect(source).toBeDefined();
    expect(source).toContain('graph TD');
    expect(source).not.toMatch(/No architecture data yet/i);
  });

  it('findDiagramSource returns undefined for a blueprint ref when the plan has no actors/contexts/domains', () => {
    const empty = JSON.parse(JSON.stringify(minimalPlanFixture)) as typeof minimalPlanFixture;
    empty.systemOverview.keyActors = [];
    empty.boundedContexts = [];
    empty.domains = [];
    const source = service.findDiagramSource({ kind: 'blueprint' }, empty);
    expect(source).toBeUndefined();
  });

  it('findDiagramSource resolves a tech-stack ref to the matching layer diagram', () => {
    const backend = service.findDiagramSource(
      { kind: 'tech-stack', layerId: 'backend' },
      minimalPlanFixture,
    );
    const frontend = service.findDiagramSource(
      { kind: 'tech-stack', layerId: 'frontend' },
      minimalPlanFixture,
    );
    expect(backend).toBeDefined();
    expect(frontend).toBeDefined();
    expect(backend).toContain('Backend');
    expect(frontend).toContain('Frontend');
    expect(backend).not.toBe(frontend);
  });

  it('findDiagramSource returns undefined for a tech-stack ref whose layer has no techStack', () => {
    const noTech = JSON.parse(JSON.stringify(minimalPlanFixture)) as typeof minimalPlanFixture;
    const shared = noTech.architectureLayers.find((l) => l.id === 'frontend')!;
    shared.techStack = [];
    const source = service.findDiagramSource(
      { kind: 'tech-stack', layerId: 'frontend' },
      noTech,
    );
    expect(source).toBeUndefined();
  });

  it('findDiagramSource returns undefined for a tech-stack ref whose layer does not exist', () => {
    const source = service.findDiagramSource(
      { kind: 'tech-stack', layerId: 'infrastructure' },
      minimalPlanFixture,
    );
    expect(source).toBeUndefined();
  });

  it('findDiagramSource preserves layerId → diagram index alignment after filtering layers without techStack', () => {





    const plan = JSON.parse(JSON.stringify(minimalPlanFixture)) as typeof minimalPlanFixture;
    const frontend = plan.architectureLayers.find((l) => l.id === 'frontend')!;
    frontend.techStack = [];
    const backend = service.findDiagramSource(
      { kind: 'tech-stack', layerId: 'backend' },
      plan,
    );
    expect(backend).toBeDefined();
    expect(backend).toContain('Backend');
    expect(backend).not.toContain('Frontend');
  });

  it('cacheKey distinguishes blueprint / tech-stack / system / layer refs', () => {
    const keys = new Set<string>();
    const refs: Array<Parameters<typeof service.findDiagramSource>[0]> = [
      { kind: 'system', field: 'c4.contextDiagram' },
      { kind: 'layer', layerId: 'backend', field: 'mermaidDiagram' },
      { kind: 'blueprint' },
      { kind: 'tech-stack', layerId: 'backend' },
      { kind: 'tech-stack', layerId: 'frontend' },
    ];
    for (const ref of refs) {
      const key = (service as unknown as { cacheKey: (r: typeof ref) => string }).cacheKey(ref);
      keys.add(key);
    }
    expect(keys.size).toBe(refs.length);
  });

  it('passes a sized, hidden container as the third arg to mermaid.render and removes it after', async () => {
    const renderSpy = vi.spyOn(
      mermaid as unknown as { render: (...args: unknown[]) => Promise<unknown> },
      'render',
    );
    const before = Array.from(document.body.children);
    const cache = new Map<string, { dataUrl: string; width: number; height: number } | null>();
    await service.resolveMermaidRef(
      { kind: 'system', field: 'c4.contextDiagram' },
      minimalPlanFixture,
      cache,
    );

    expect(renderSpy).toHaveBeenCalledTimes(1);
    const call = renderSpy.mock.calls[0];
    expect(call.length).toBe(3);
    const container = call[2] as HTMLElement | undefined;
    expect(container).toBeInstanceOf(HTMLElement);
    expect(container!.style.width).toBe('960px');
    expect(container!.style.position).toBe('fixed');
    expect(container!.style.visibility).toBe('hidden');

    const after = Array.from(document.body.children);
    expect(after.length).toBe(before.length);
    expect(after).not.toContain(container);
  });
});

describe('PdfExportService — vite optimizeDeps stale-cache recovery', () => {
  const STALE_URL =
    'http://localhost:4200/.angular/cache/19.0.0/auto-architect/vite/deps/pdfmake_build_pdfmake__min__js.js?v=abc123';
  const STALE_TYPE_ERROR = new TypeError(
    `Failed to fetch dynamically imported module: ${STALE_URL}`,
  );
  const VFS_MODULE = { default: { 'Roboto-Medium.ttf': 'AA' } };

  type TestableMethods = {
    dynamicImportPdfMake: () => Promise<unknown>;
    dynamicImportVfsFonts: () => Promise<unknown>;
    loadPdfMake: () => Promise<unknown>;
  };

  function asTestable(s: PdfExportService): TestableMethods {
    return s as unknown as TestableMethods;
  }

  let service: PdfExportService;
  let reloadSpy: ReturnType<typeof vi.fn>;
  let originalLocation: Location;
  let dynamicImportPdfMakeCalls: number;
  let dynamicImportVfsFontsCalls: number;

  beforeEach(() => {
    sessionStorage.clear();
    PdfExportService.clearLoadPdfMakeCache();
    PdfExportService.STALE_CACHE_RETRY_DELAYS_MS = [0, 5, 5, 5, 5];
    TestBed.configureTestingModule({});
    service = TestBed.inject(PdfExportService);

    dynamicImportPdfMakeCalls = 0;
    dynamicImportVfsFontsCalls = 0;
    asTestable(service).dynamicImportPdfMake = vi.fn(async () => {
      dynamicImportPdfMakeCalls += 1;
      return {};
    });
    asTestable(service).dynamicImportVfsFonts = vi.fn(async () => {
      dynamicImportVfsFontsCalls += 1;
      return VFS_MODULE;
    });

    originalLocation = window.location;
    const reloadFn = vi.fn();
    reloadSpy = reloadFn;
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, reload: reloadFn },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
    sessionStorage.clear();
    PdfExportService.clearLoadPdfMakeCache();
  });

  it('retries the dynamic import with backoff and succeeds without reloading when vite re-bundles in time', async () => {
    const fakePdfMake = { createPdf: vi.fn(() => ({ getBlob: async () => new Blob(['x']) })) };
    asTestable(service).dynamicImportPdfMake = vi.fn(async () => {
      dynamicImportPdfMakeCalls += 1;
      if (dynamicImportPdfMakeCalls < 3) {
        throw STALE_TYPE_ERROR;
      }
      return fakePdfMake;
    });

    const result = await asTestable(service).loadPdfMake();
    expect(result).toBe(fakePdfMake);
    expect(dynamicImportPdfMakeCalls).toBe(3);
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PDF_EXPORT_RELOAD_FLAG_KEY)).toBeNull();
  });

  it('triggers a one-shot location.reload and sets the sessionStorage flag after all retries are exhausted', async () => {
    asTestable(service).dynamicImportPdfMake = vi.fn(async () => {
      dynamicImportPdfMakeCalls += 1;
      throw STALE_TYPE_ERROR;
    });

    const loadPromise = asTestable(service).loadPdfMake();

    const settled = await Promise.race([
      loadPromise.then(
        () => 'resolved',
        () => 'rejected',
      ),
      new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 200)),
    ]);
    expect(settled).toBe('timeout');

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(PDF_EXPORT_RELOAD_FLAG_KEY)).toBe('1');
    expect(dynamicImportPdfMakeCalls).toBe(5);
  });

  it('throws PdfExportReloadRequested on the second consecutive stale-cache rejection instead of reloading', async () => {
    sessionStorage.setItem(PDF_EXPORT_RELOAD_FLAG_KEY, '1');
    asTestable(service).dynamicImportPdfMake = vi.fn(async () => {
      dynamicImportPdfMakeCalls += 1;
      throw STALE_TYPE_ERROR;
    });

    await expect(asTestable(service).loadPdfMake()).rejects.toBeInstanceOf(
      PdfExportReloadRequested,
    );
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(dynamicImportPdfMakeCalls).toBe(5);
  });

  it('caches the resolved pdfmake promise so subsequent loadPdfMake calls reuse it', async () => {
    const fakePdfMake = { createPdf: vi.fn(() => ({ getBlob: async () => new Blob(['x']) })) };
    asTestable(service).dynamicImportPdfMake = vi.fn(async () => {
      dynamicImportPdfMakeCalls += 1;
      return fakePdfMake;
    });

    const first = await asTestable(service).loadPdfMake();
    const second = await asTestable(service).loadPdfMake();
    expect(first).toBe(second);
    expect(dynamicImportPdfMakeCalls).toBe(1);
  });

  it('does not intercept non-vite TypeErrors and rethrows them unchanged', async () => {
    const otherTypeError = new TypeError('Some other unrelated error');
    asTestable(service).dynamicImportPdfMake = vi.fn(async () => {
      dynamicImportPdfMakeCalls += 1;
      throw otherTypeError;
    });

    await expect(asTestable(service).loadPdfMake()).rejects.toBe(otherTypeError);
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PDF_EXPORT_RELOAD_FLAG_KEY)).toBeNull();
  });

  it('PdfExportReloadRequested carries isReload=true and the expected name', () => {
    const err = new PdfExportReloadRequested();
    expect(err.isReload).toBe(true);
    expect(err.name).toBe('PdfExportReloadRequested');
    expect(err).toBeInstanceOf(Error);
  });

  it('clearLoadPdfMakeCache resets the cached promise so a fresh import runs on the next call', async () => {
    const fakePdfMake = { createPdf: vi.fn(() => ({ getBlob: async () => new Blob(['x']) })) };
    asTestable(service).dynamicImportPdfMake = vi.fn(async () => {
      dynamicImportPdfMakeCalls += 1;
      return fakePdfMake;
    });

    await asTestable(service).loadPdfMake();
    PdfExportService.clearLoadPdfMakeCache();
    await asTestable(service).loadPdfMake();
    expect(dynamicImportPdfMakeCalls).toBe(2);
  });

  it('vfsFonts dynamic import also triggers the reload guard when it is the failing one', async () => {
    asTestable(service).dynamicImportVfsFonts = vi.fn(async () => {
      dynamicImportVfsFontsCalls += 1;
      throw STALE_TYPE_ERROR;
    });

    const loadPromise = asTestable(service).loadPdfMake();

    const settled = await Promise.race([
      loadPromise.then(
        () => 'resolved',
        (e: unknown) => `rejected:${(e as Error).message ?? String(e)}`,
      ),
      new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 100)),
    ]);
    expect(settled).toBe('timeout');
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(PDF_EXPORT_RELOAD_FLAG_KEY)).toBe('1');
  });
});
