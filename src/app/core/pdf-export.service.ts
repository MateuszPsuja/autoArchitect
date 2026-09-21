import { Injectable } from '@angular/core';
import mermaid from 'mermaid';
import DOMPurify from 'dompurify';
import { Plan, ArchitectureLayer } from './plan.schema';
import { PdfBlock, PdfDocument, PdfSection, MermaidRef } from './pdf-document.schema';
import { normalizeMermaidChart } from '../features/diagrams/mermaid-utils';
import {
  buildArchitectureBlueprint,
  buildTechStackDiagram,
} from './architecture-blueprint';

export type PdfMakeContent = unknown;
export type PdfMakeDocDefinition = {
  content: PdfMakeContent[];
  styles?: Record<string, unknown>;
  defaultStyle?: Record<string, unknown>;
  header?: PdfMakeContent;
  footer?: PdfMakeContent;
  pageMargins?: [number, number, number, number];
};

type PdfMakeModule = {
  createPdf: (def: PdfMakeDocDefinition) => {
    getBlob: () => Promise<Blob>;
  };
  vfs?: Record<string, string>;
};

const DIAGRAM_RENDER_TIMEOUT_MS = 10_000;
const RASTER_TIMEOUT_MS = 6_000;
const DIAGRAM_RASTER_SCALE = 6;
const PDF_MERMAID_LAYOUT_WIDTH = 960;
const PDF_MERMAID_MAX_SOURCE_DIM = 960;
const PDF_MERMAID_IMAGE_WIDTH = 460;
const PDF_MERMAID_IMAGE_MAX_HEIGHT = 720;

const STALE_VITE_DEPS_RE = /\.angular\/cache\/[^?\s]*\/vite\/deps\/[^?\s]*\?v=/;
export const PDF_EXPORT_RELOAD_FLAG_KEY = 'pdf-export-reload-requested';

export class PdfExportReloadRequested extends Error {
  readonly isReload = true;
  constructor(message = 'PDF export requires a one-shot page reload to refresh the dev-server cache.') {
    super(message);
    this.name = 'PdfExportReloadRequested';
  }
}

function isStaleViteDepsError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' && STALE_VITE_DEPS_RE.test(message);
}

const PDF_PAGE_WIDTH = 595;
const PDF_HORIZONTAL_MARGIN = 56 + 56;
const PDF_VERTICAL_MARGIN = 80 + 60;
export const PDF_PRINTABLE_WIDTH = PDF_PAGE_WIDTH - PDF_HORIZONTAL_MARGIN;
export const PDF_PAGE_HEIGHT = 842;
export const PDF_PRINTABLE_HEIGHT = PDF_PAGE_HEIGHT - PDF_VERTICAL_MARGIN;

const PDF_DESIGN = {
  coverAccent: '#1e40af', 

  rule: '#cbd5e1',        

  text: '#0f172a',        

  textMuted: '#475569',   

  textFaint: '#94a3b8',   

  surface: '#f8fafc',     

  surfaceAlt: '#eef2ff',  

  bulletsMarker: '#1e40af', 

  numberedMarker: '#0f172a', 

  callout: {
    info: { accent: '#0ea5e9', fill: '#f0f9ff' },
    success: { accent: '#16a34a', fill: '#f0fdf4' },
    warning: { accent: '#d97706', fill: '#fffbeb' },
    risk: { accent: '#dc2626', fill: '#fef2f2' },
  },
} as const;

const CALLOUT_PALETTE = {
  info: { fill: '#e0f2fe', border: '#7dd3fc' },
  success: { fill: '#dcfce7', border: '#86efac' },
  warning: { fill: '#fef3c7', border: '#fcd34d' },
  risk: { fill: '#fee2e2', border: '#fca5a5' },
} as const;

const SECTION_COVER_BAND_COLOR = PDF_DESIGN.coverAccent;
const SECTION_RULE_COLOR = PDF_DESIGN.rule;
const HEADER_TEXT_COLOR = PDF_DESIGN.textMuted;
const FOOTER_TEXT_COLOR = PDF_DESIGN.textFaint;

type RasterisedDiagram = { dataUrl: string; width: number; height: number };

const MAX_FIGURE_INDEX = 99;

async function rasteriseSvgToPng(svg: string): Promise<RasterisedDiagram | null> {
  if (typeof document === 'undefined') {
    return null;
  }



  if (!hasWorkingCanvas()) {
    return null;
  }
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const blobUrl = URL.createObjectURL(svgBlob);

  try {
    const result = await Promise.race([
      drawSvgToCanvas(blobUrl),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('rasterise timed out')), RASTER_TIMEOUT_MS),
      ),
    ]);
    return result;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

function hasWorkingCanvas(): boolean {
  try {
    const probe = document.createElement('canvas');
    const ctx = probe.getContext('2d');
    if (!ctx) return false;
    probe.width = 1;
    probe.height = 1;
    probe.toDataURL('image/png');
    return true;
  } catch {
    return false;
  }
}

function formatHumanTimestamp(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return iso;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(ts));
}

function stripTrailingBottomMargin(content: PdfMakeContent[]): void {
  for (let i = content.length - 1; i >= 0; i--) {
    const node = content[i] as
      | { margin?: [number, number, number, number]; pageBreak?: unknown }
      | undefined;
    if (!node) return;
    if (node.pageBreak !== undefined) return;
    if (Array.isArray(node.margin) && node.margin.length === 4) {
      const next: [number, number, number, number] = [
        node.margin[0],
        node.margin[1],
        node.margin[2],
        node.margin[3],
      ];
      next[2] = 0;
      node.margin = next;
      return;
    }
  }
}

function fitDiagramToBox(
  sourceWidth: number,
  sourceHeight: number,
): { width: number; height: number } {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { width: PDF_MERMAID_IMAGE_WIDTH, height: PDF_MERMAID_IMAGE_MAX_HEIGHT };
  }
  const maxWidth = PDF_MERMAID_IMAGE_WIDTH;
  const maxHeight = PDF_MERMAID_IMAGE_MAX_HEIGHT;
  const heightAtMaxWidth = maxWidth * (sourceHeight / sourceWidth);
  if (heightAtMaxWidth <= maxHeight) {
    return { width: maxWidth, height: Math.round(heightAtMaxWidth) };
  }
  const k = maxHeight / heightAtMaxWidth;
  return {
    width: Math.max(1, Math.round(maxWidth * k)),
    height: maxHeight,
  };
}

function drawSvgToCanvas(
  blobUrl: string,
): Promise<{ width: number; height: number; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = DIAGRAM_RASTER_SCALE;
      let width = img.naturalWidth || img.width || 800;
      let height = img.naturalHeight || img.height || 600;





      const maxSource = Math.max(width, height);
      if (maxSource > PDF_MERMAID_MAX_SOURCE_DIM) {
        const k = PDF_MERMAID_MAX_SOURCE_DIM / maxSource;
        width = Math.max(1, Math.round(width * k));
        height = Math.max(1, Math.round(height * k));
      }
      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('2d canvas context unavailable'));
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      try {
        const dataUrl = canvas.toDataURL('image/png');
        resolve({ width, height, dataUrl });
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('image load failed'));
    img.src = blobUrl;
  });
}

function resolveSynthesizedBlueprint(plan: Plan): string | undefined {
  const source = buildArchitectureBlueprint(plan);
  if (!source) return undefined;
  if (/No architecture data yet/i.test(source)) return undefined;
  return source;
}

function resolveSynthesizedTechStack(layerId: string, plan: Plan): string | undefined {
  const layers = Array.isArray(plan.architectureLayers) ? plan.architectureLayers : [];
  const renderable = layers.filter(
    (l) => Array.isArray(l?.techStack) && (l.techStack ?? []).some(Boolean),
  );
  const idx = renderable.findIndex((l) => l.id === layerId);
  if (idx < 0) return undefined;
  const diagrams = buildTechStackDiagram(plan, { maxNodes: 80 });



  if (idx >= diagrams.length) return undefined;
  const source = diagrams[idx];
  if (!source || /No tech stack declared yet/i.test(source)) return undefined;
  return source;
}

@Injectable({ providedIn: 'root' })
export class PdfExportService {

  private static cachedLoadPromise: Promise<PdfMakeModule> | null = null;

  static STALE_CACHE_RETRY_DELAYS_MS: readonly number[] = [
    0, 500, 1_500, 4_000, 8_000,
  ];


  static STALE_CACHE_RETRY_DELAYS_MS_AFTER_RELOAD: readonly number[] = [
    0, 1_000, 3_000, 8_000, 15_000,
  ];

  private currentSectionStack: PdfSection[] = [];

  private figureIndex = 0;

  async buildPdf(
    plan: Plan,
    document: PdfDocument,
    options: { includeToc?: boolean } = {},
  ): Promise<Blob> {
    const pdfMake = await this.loadPdfMake();
    const renderedDiagrams = new Map<string, RasterisedDiagram | null>();



    this.currentSectionStack = [];
    this.figureIndex = 0;





    const refs: MermaidRef[] = document.sections
      .flatMap((section) => section.blocks)
      .filter(
        (block): block is Extract<PdfBlock, { kind: 'mermaidRef' }> => block.kind === 'mermaidRef',
      )
      .map((block) => block.ref);

    await Promise.all(refs.map((ref) => this.resolveMermaidRef(ref, plan, renderedDiagrams)));

    const content: PdfMakeContent[] = [];
    content.push(...this.buildCoverPage(document, plan));

    if (options.includeToc !== false) {
      const toc = this.buildToc(document);
      if (toc) {
        content.push(...toc);
      }
    }

    for (let index = 0; index < document.sections.length; index += 1) {
      const section = document.sections[index];
      const sectionContent = this.composeSection(section, index, renderedDiagrams);
      content.push(...sectionContent);
    }

    stripTrailingBottomMargin(content);
    const docDefinition = this.composeDocDefinition(document, plan, content);

    return pdfMake.createPdf(docDefinition).getBlob();
  }

  composeDocDefinition(
    document: PdfDocument,
    plan: Plan,
    content: PdfMakeContent[],
  ): PdfMakeDocDefinition {
    return {
      content,
      pageMargins: [56, 80, 56, 60],
      defaultStyle: { font: 'Roboto', fontSize: 10, lineHeight: 1.25, color: PDF_DESIGN.text },
      styles: {
        coverPartLabel: {
          fontSize: 10,
          color: '#64748b',
          characterSpacing: 1,
          bold: true,
          margin: [0, 0, 0, 12],
        },
        coverTitle: {
          fontSize: 26,
          bold: true,
          color: PDF_DESIGN.text,
          margin: [0, 0, 0, 8],
        },
        coverSubtitle: {
          fontSize: 13,
          color: PDF_DESIGN.textMuted,
          lineHeight: 1.25,
          margin: [0, 0, 0, 14],
        },
        coverMeta: {
          fontSize: 9,
          color: PDF_DESIGN.textFaint,
          alignment: 'right',
          margin: [0, 0, 0, 12],
        },
        coverSectionCount: {
          fontSize: 9,
          color: PDF_DESIGN.textFaint,
          margin: [0, 6, 0, 0],
        },
        tocHeading: {
          fontSize: 18,
          bold: true,
          color: PDF_DESIGN.text,
          margin: [0, 0, 0, 8],
        },
        tocEntry: {
          fontSize: 10,
          color: PDF_DESIGN.text,
          margin: [0, 2, 0, 2],
        },
        tocEntryIndex: {
          fontSize: 9,
          color: PDF_DESIGN.textFaint,
          alignment: 'right',
        },
        sectionHeading: {
          fontSize: 18,
          bold: true,
          color: PDF_DESIGN.text,
          margin: [0, 14, 0, 4],
        },
        paragraph: { margin: [0, 2, 0, 4], color: PDF_DESIGN.text },
        bullets: { margin: [0, 2, 0, 4], color: PDF_DESIGN.text },
        numbered: { margin: [0, 2, 0, 4], color: PDF_DESIGN.text },
        tableLabel: { bold: true, color: PDF_DESIGN.text },
        tableValue: { color: '#1e293b' },
        tableHeader: {
          bold: true,
          color: PDF_DESIGN.text,
          fillColor: PDF_DESIGN.surfaceAlt,
        },
        figureLabel: {
          fontSize: 9,
          bold: true,
          color: PDF_DESIGN.textMuted,
          margin: [0, 4, 0, 2],
        },
        diagramCaption: {
          italics: true,
          fontSize: 9,
          color: PDF_DESIGN.textMuted,
          margin: [0, 0, 0, 8],
        },
        calloutInfo: { fontSize: 10, color: '#0c4a6e' },
        calloutSuccess: { fontSize: 10, color: '#166534' },
        calloutWarning: { fontSize: 10, color: '#92400e' },
        calloutRisk: { fontSize: 10, color: '#991b1b' },
        calloutTitle: { bold: true, fontSize: 11, color: PDF_DESIGN.text },
        calloutBody: { fontSize: 10, color: '#475569' },
        codeInline: { font: 'Courier', color: PDF_DESIGN.text },
        matrixCaption: {
          italics: true,
          fontSize: 9,
          color: PDF_DESIGN.textMuted,
          margin: [0, 0, 0, 8],
        },
      },







      header: (currentPage: number, _pageCount: number) => {
        if (currentPage === 1) return null;
        const section = this.currentSectionStack[this.currentSectionStack.length - 1];
        const rightText = section?.heading ?? document.title;
        return {
          columns: [
            {
              text: document.title,
              italics: true,
              fontSize: 9,
              color: HEADER_TEXT_COLOR,
              margin: [0, 0, 0, 4],
            },
            {
              text: rightText,
              fontSize: 9,
              color: HEADER_TEXT_COLOR,
              alignment: 'right',
              margin: [0, 0, 0, 4],
            },
          ],



          margin: [56, 24, 56, 6],
        };
      },
      footer: (currentPage: number, pageCount: number) => ({
        text: `${currentPage} / ${pageCount}`,
        alignment: 'center',
        margin: [56, 0, 56, 20],
        fontSize: 9,
        color: FOOTER_TEXT_COLOR,
      }),
    };
  }

  buildCoverPage(document: PdfDocument, plan: Plan): PdfMakeContent[] {
    const elements: PdfMakeContent[] = [];



    elements.push(this.buildCoverAccentBar());
    elements.push({
      text: 'ARCHITECTURE SPECIFICATION',
      style: 'coverPartLabel',
    });
    elements.push({ text: document.title, style: 'coverTitle' });
    if (document.subtitle) {
      elements.push({ text: document.subtitle, style: 'coverSubtitle' });
    }
    const generatedAt = formatHumanTimestamp(document.generatedAt);
    const model = plan.meta.model?.trim() || 'auto';
    elements.push({
      text: `Generated ${generatedAt} · ${model}`,
      style: 'coverMeta',
    });
    elements.push(this.buildHairline(SECTION_RULE_COLOR));
    elements.push({
      text: 'Executive Summary',
      style: 'sectionHeading',
    });
    if (document.executiveSummary.length < 40) {
      elements.push({
        text: 'Plan has no executive summary — regenerated with placeholder.',
        style: 'paragraph',
        margin: [0, 2, 0, 2],
        color: '#92400e',
      });
    }
    elements.push({
      text: document.executiveSummary,
      style: 'paragraph',
      margin: [0, 2, 0, 4],
    });
    elements.push({
      text: `${document.sections.length} sections`,
      style: 'coverSectionCount',
    });



    elements.push({ text: '', pageBreak: 'after' });
    stripTrailingBottomMargin(elements);
    return elements;
  }

  private buildToc(document: PdfDocument): PdfMakeContent[] | null {
    const sections = document.sections;
    if (!sections || sections.length === 0) return null;
    const elements: PdfMakeContent[] = [];
    elements.push({ text: 'Contents', style: 'tocHeading' });
    elements.push(this.buildHairline(SECTION_RULE_COLOR));
    sections.forEach((section, idx) => {
      elements.push({
        columns: [
          {
            text: section.heading,
            style: 'tocEntry',
            margin: [0, 0, 0, 0],
          },
          {
            text: `Section ${idx + 1}`,
            style: 'tocEntryIndex',
            margin: [0, 0, 0, 0],
          },
        ],



        columnGap: 12,
        margin: [0, 2, 0, 2],
      });
    });
    elements.push({ text: '', pageBreak: 'after' });
    return elements;
  }

  composeSection(
    section: PdfSection,
    index: number,
    renderedDiagrams: Map<string, RasterisedDiagram | null>,
  ): PdfMakeContent[] {
    const blocks: PdfMakeContent[] = [];



    if (index > 0) {
      blocks.push({ text: '', pageBreak: 'before' });
    }



    blocks.push({ text: section.heading, style: 'sectionHeading' });
    blocks.push(this.buildHairline(SECTION_RULE_COLOR));

    this.currentSectionStack.push(section);
    try {
      for (const block of section.blocks) {
        blocks.push(...this.composeBlock(block, renderedDiagrams));
      }
    } finally {
      this.currentSectionStack.pop();
    }
    return blocks;
  }

  composeBlock(block: PdfBlock, renderedDiagrams: Map<string, RasterisedDiagram | null>): PdfMakeContent[] {
    switch (block.kind) {
      case 'paragraph': {
        const trimmed = block.text.trim();
        const display = trimmed.length === 0 ? '—' : block.text;
        return [{ text: display, style: 'paragraph', margin: [0, 2, 0, 4] }];
      }
      case 'bullets':
        return [
          {
            ul: block.items.map((text) => ({ text })),
            style: 'bullets',
            markerColor: PDF_DESIGN.bulletsMarker,
          },
        ];
      case 'numbered':
        return [
          {
            ol: block.items.map((text) => ({ text })),
            style: 'numbered',
            markerColor: PDF_DESIGN.numberedMarker,
          },
        ];
      case 'keyValueTable':
        return [
          {
            table: {









              widths: [PDF_PRINTABLE_WIDTH * 0.3, PDF_PRINTABLE_WIDTH * 0.7],
              body: block.rows.map(([k, v]) => [
                { text: k, style: 'tableHeader', fillColor: PDF_DESIGN.surfaceAlt },
                { text: v, style: 'tableValue' },
              ]),
            },
            layout: this.buildHairlineTableLayout(),
            margin: [0, 4, 0, 6],
          },
        ];
      case 'mermaidRef': {
        const key = this.cacheKey(block.ref);
        const png = renderedDiagrams.get(key);
        const elements: PdfMakeContent[] = [];



        this.figureIndex = Math.min(this.figureIndex + 1, MAX_FIGURE_INDEX);
        const figureNumber = this.figureIndex;
        elements.push({
          text: `Figure ${figureNumber} —`,
          style: 'figureLabel',
        });
        if (png) {
          const dims = fitDiagramToBox(png.width, png.height);
          elements.push({
            image: png.dataUrl,
            width: dims.width,
            height: dims.height,
            margin: [0, 2, 0, 2],
          });
        }
        elements.push({ text: block.caption, style: 'diagramCaption' });
        return elements;
      }
      case 'callout': {
        const tone = block.tone ?? 'info';
        const palette = PDF_DESIGN.callout[tone];





        const rightStack: PdfMakeContent[] = [];
        if (block.title) {
          rightStack.push({
            text: block.title,
            style: 'calloutTitle',
            margin: [0, 0, 0, 2],
          });
        }
        rightStack.push({ text: block.text, style: 'calloutBody' });
        return [
          {
            columns: [
              {
                width: 3,
                stack: [
                  {
                    canvas: [
                      {
                        type: 'rect',
                        x: 0,
                        y: 0,
                        w: 3,
                        h: 24,
                        color: palette.accent,
                      },
                    ],
                  },
                ],
              },
              {
                width: '*',
                stack: rightStack,
                fillColor: palette.fill,
                margin: [10, 6, 10, 8],
              },
            ],
            columnGap: 0,
            margin: [0, 6, 0, 8],
          },
        ];
      }
      case 'glossary':
        return [
          {
            table: {



              widths: [PDF_PRINTABLE_WIDTH * 0.3, PDF_PRINTABLE_WIDTH * 0.7],
              body: block.entries.map(([term, defn]) => [
                { text: term, style: 'tableHeader', fillColor: PDF_DESIGN.surfaceAlt },
                { text: defn, style: 'tableValue' },
              ]),
            },
            layout: this.buildHairlineTableLayout(),
            margin: [0, 4, 0, 6],
          },
        ];
      case 'matrix': {
        const colCount = block.columns.length;











        const usableWidth = PDF_PRINTABLE_WIDTH * 0.95;
        const labelPt = usableWidth * 0.22;
        const dataPt = (usableWidth - labelPt) / Math.max(colCount, 1);
        const widths: number[] = [
          labelPt,
          ...Array.from({ length: colCount }, () => dataPt),
        ];
        const headerFill = PDF_DESIGN.surfaceAlt;
        const zebraFill = PDF_DESIGN.surface;
        const body = [





          [
            {
              text: '',
              style: 'tableHeader',
              fillColor: headerFill,
              border: [false, false, false, false],
            },
            ...block.columns.map((c) => ({
              text: c,
              style: 'tableHeader',
              fillColor: headerFill,
              border: [false, false, false, false],
            })),
          ],
          ...block.rows.map((row, rowIdx) => {
            const fill = rowIdx % 2 === 0 ? '#ffffff' : zebraFill;





            const cells = Array.from(
              { length: colCount },
              (_, i) => row.cells[i] ?? '',
            );
            return [
              { text: row.label, style: 'tableLabel', fillColor: fill },
              ...cells.map((cell) => ({
                text: cell,
                style: 'tableValue',
                fillColor: fill,
              })),
            ];
          }),
        ];
        const elements: PdfMakeContent[] = [
          {
            table: { widths, body },
            layout: this.buildHairlineTableLayout(),
            margin: [0, 2, 0, 2],
          },
        ];
        if (block.caption) {
          elements.push({ text: block.caption, style: 'matrixCaption' });
        }
        return elements;
      }
    }
  }

  async resolveMermaidRef(
    ref: MermaidRef,
    plan: Plan,
    cache: Map<string, RasterisedDiagram | null>,
  ): Promise<RasterisedDiagram | null> {
    const key = this.cacheKey(ref);
    if (cache.has(key)) {
      return cache.get(key) ?? null;
    }

    const source = this.findDiagramSource(ref, plan);
    if (!source) {
      cache.set(key, null);
      return null;
    }

    const normalized = normalizeMermaidChart(source);
    const id = `pdf-${crypto.randomUUID()}`;







    let container: HTMLElement | null = null;
    if (typeof document !== 'undefined' && document.body) {
      container = document.createElement('div');
      container.style.position = 'fixed';
      container.style.left = '-99999px';
      container.style.top = '0';
      container.style.visibility = 'hidden';
      container.style.pointerEvents = 'none';
      container.style.width = `${PDF_MERMAID_LAYOUT_WIDTH}px`;
      container.setAttribute('data-render-id', id);
      document.body.appendChild(container);
    }
    try {



      const renderPromise = mermaid.render(id, normalized, container ?? undefined);
      const svgString = await Promise.race([
        renderPromise.then((result) => (typeof result === 'string' ? result : (result?.svg ?? ''))),
        new Promise<string>((_, reject) =>
          setTimeout(
            () => reject(new Error('mermaid render timed out')),
            DIAGRAM_RENDER_TIMEOUT_MS,
          ),
        ),
      ]);
      const safe = DOMPurify.sanitize(svgString, {
        USE_PROFILES: { svg: true, svgFilters: true },
        ADD_ATTR: ['style'],
      });
      const rasterised = await rasteriseSvgToPng(safe);
      cache.set(key, rasterised);
      return rasterised;
    } catch {
      cache.set(key, null);
      return null;
    } finally {
      if (container && container.parentNode) {
        container.parentNode.removeChild(container);
      }
    }
  }

  private buildCoverAccentBar(): PdfMakeContent {
    return {
      canvas: [
        {
          type: 'rect',
          x: 0,
          y: 0,
          w: PDF_PRINTABLE_WIDTH,
          h: 4,
          color: SECTION_COVER_BAND_COLOR,
        },
      ],
      margin: [0, 0, 0, 16],
    } as unknown as PdfMakeContent;
  }

  private buildHairline(color: string): PdfMakeContent {
    return {
      canvas: [
        {
          type: 'rect',
          x: 0,
          y: 0,
          w: PDF_PRINTABLE_WIDTH,
          h: 0.5,
          color,
        },
      ],
      margin: [0, 0, 0, 8],
    } as unknown as PdfMakeContent;
  }

  private buildHairlineTableLayout() {
    const color = SECTION_RULE_COLOR;
    return {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0,
      hLineColor: () => color,
      vLineColor: () => color,
    };
  }

  private cacheKey(ref: MermaidRef): string {
    if (ref.kind === 'blueprint') {
      return 'blueprint:';
    }
    if (ref.kind === 'tech-stack') {
      return `tech-stack:${ref.layerId}`;
    }
    return `${ref.kind}:${'field' in ref ? ref.field : ''}:${'layerId' in ref ? ref.layerId : ''}`;
  }

  findDiagramSource(ref: MermaidRef, plan: Plan): string | undefined {
    if (ref.kind === 'system') {
      if (ref.field === 'boundedContextMap') {
        return plan.systemOverview.boundedContextMap;
      }
      if (ref.field === 'c4.contextDiagram') {
        return plan.systemOverview.c4.contextDiagram;
      }
      if (ref.field === 'c4.containerDiagram') {
        return plan.systemOverview.c4.containerDiagram;
      }
      return undefined;
    }
    if (ref.kind === 'blueprint') {
      return resolveSynthesizedBlueprint(plan);
    }
    if (ref.kind === 'tech-stack') {
      return resolveSynthesizedTechStack(ref.layerId, plan);
    }
    const layer = plan.architectureLayers.find((l) => l.id === ref.layerId) as
      | (ArchitectureLayer & Record<string, unknown>)
      | undefined;
    return layer ? (layer[ref.field] as string | undefined) : undefined;
  }

  private async loadPdfMake(): Promise<PdfMakeModule> {
    if (PdfExportService.cachedLoadPromise) {
      return PdfExportService.cachedLoadPromise;
    }

    const promise = (async (): Promise<PdfMakeModule> => {
      const [pdfMakeModule, vfsFontsModule] = await this.loadPdfMakeWithStaleCacheRecovery();
      const pdfMake: PdfMakeModule =
        (pdfMakeModule as { default?: PdfMakeModule }).default ?? (pdfMakeModule as PdfMakeModule);
      this.applyVfsFonts(pdfMake, vfsFontsModule);
      return pdfMake;
    })();

    PdfExportService.cachedLoadPromise = promise;
    return promise;
  }

  private async loadPdfMakeWithStaleCacheRecovery(): Promise<
    [{ default?: PdfMakeModule } & PdfMakeModule, { default?: Record<string, string> } & Record<string, string>]
  > {

    const postReload =
      typeof sessionStorage !== 'undefined' &&
      sessionStorage.getItem(PDF_EXPORT_RELOAD_FLAG_KEY) === '1';
    const retryDelaysMs = postReload
      ? PdfExportService.STALE_CACHE_RETRY_DELAYS_MS_AFTER_RELOAD
      : PdfExportService.STALE_CACHE_RETRY_DELAYS_MS;
    if (typeof console !== 'undefined' && postReload) {
      // eslint-disable-next-line no-console
      console.warn(
        `[pdf-export] Post-reload stale-cache recovery: using extended retry schedule (${
          retryDelaysMs.reduce((acc, ms) => acc + ms, 0) / 1000
        }s total) while vite re-bundles pdfmake.`,
      );
    }
    for (let attempt = 0; attempt < retryDelaysMs.length; attempt += 1) {
      if (retryDelaysMs[attempt] > 0) {
        await this.sleep(retryDelaysMs[attempt]);
      }
      try {
        const pdfMakeModule = await this.dynamicImportPdfMake();
        const vfsFontsModule = await this.dynamicImportVfsFonts();
        return [pdfMakeModule, vfsFontsModule];
      } catch (err) {
        if (!isStaleViteDepsError(err)) {
          throw err;
        }
        if (typeof console !== 'undefined') {
          // eslint-disable-next-line no-console
          console.warn(
            `[pdf-export] Stale vite optimizeDeps cache detected (attempt ${attempt + 1}/${retryDelaysMs.length}). Retrying so vite can re-bundle.`,
          );
        }
      }
    }
    if (this.shouldReloadForStaleCache()) {
      this.triggerStaleCacheReload();
      return new Promise<
        [{ default?: PdfMakeModule } & PdfMakeModule, { default?: Record<string, string> } & Record<string, string>]
      >(() => {
        // never resolves — page is reloading
      });
    }
    throw new PdfExportReloadRequested();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private applyVfsFonts(
    pdfMakeModule: { default?: PdfMakeModule } & PdfMakeModule,
    vfsFontsModule: { default?: Record<string, string> } & Record<string, string>,
  ): void {
    const candidateVfs =
      (vfsFontsModule as { default?: Record<string, string> }).default ??
      (vfsFontsModule as { vfs?: Record<string, string> }).vfs ??
      (vfsFontsModule as { pdfMake?: { vfs?: Record<string, string> } }).pdfMake?.vfs ??
      vfsFontsModule;

    if (!candidateVfs || typeof candidateVfs !== 'object' || !('Roboto-Medium.ttf' in candidateVfs)) {
      return;
    }
    const vfs = candidateVfs as Record<string, string>;
    const pdfMake: PdfMakeModule =
      (pdfMakeModule as { default?: PdfMakeModule }).default ?? (pdfMakeModule as PdfMakeModule);
    const pmAny = pdfMake as unknown as {
      addVirtualFileSystem?: (v: Record<string, string>) => void;
    };
    if (typeof pmAny.addVirtualFileSystem === 'function') {
      pmAny.addVirtualFileSystem(vfs);
    } else {
      pdfMake.vfs = vfs;
    }
  }

  private async dynamicImportPdfMake(): Promise<
    { default?: PdfMakeModule } & PdfMakeModule
  > {
    return (await import('pdfmake/build/pdfmake.min.js' as string)) as {
      default?: PdfMakeModule;
    } & PdfMakeModule;
  }

  private async dynamicImportVfsFonts(): Promise<
    { default?: Record<string, string> } & Record<string, string>
  > {
    return (await import('pdfmake/build/vfs_fonts.js' as string)) as {
      default?: Record<string, string>;
    } & Record<string, string>;
  }

  private shouldReloadForStaleCache(): boolean {
    if (typeof sessionStorage === 'undefined') return true;
    return sessionStorage.getItem(PDF_EXPORT_RELOAD_FLAG_KEY) !== '1';
  }

  private triggerStaleCacheReload(): void {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(PDF_EXPORT_RELOAD_FLAG_KEY, '1');
    }
    if (typeof console !== 'undefined') {
      // eslint-disable-next-line no-console
      console.warn(
        '[pdf-export] Stale vite optimizeDeps cache detected for pdfmake. Triggering one-shot reload to refresh the module map.',
      );
    }
    if (typeof window !== 'undefined' && typeof window.location?.reload === 'function') {
      window.location.reload();
    }
  }

  static clearLoadPdfMakeCache(): void {
    PdfExportService.cachedLoadPromise = null;
  }
}
