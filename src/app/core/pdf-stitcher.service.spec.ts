import { TestBed } from '@angular/core/testing';
import { PdfStitcherService } from './pdf-stitcher.service';
import { PdfDocument, PdfSection } from './pdf-document.schema';

function section(heading: string, body: string): PdfSection {
  return {
    heading,
    blocks: [{ kind: 'paragraph', text: body }],
  };
}

function header(sections: readonly PdfSection[]): {
  title: string;
  subtitle: string | null | undefined;
  generatedAt: string;
  executiveSummary: string;
  sections: readonly PdfSection[];
} {
  return {
    title: 'Plan Spec',
    subtitle: 'sub',
    generatedAt: '2026-08-18T00:00:00.000Z',
    executiveSummary:
      'This PDF distils the active Plan into a single readable spec. It covers system context, bounded contexts, per-layer architecture, key domains, and key ADRs.',
    sections,
  };
}

describe('PdfStitcherService', () => {
  let service: PdfStitcherService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PdfStitcherService);
  });

  it('assembles header + all batches in canonical order (happy path)', () => {
    const headerSections = [section('Executive Summary', 'es-body'), section('System Overview', 'so-body')];
    const batches = [
      { targetKinds: ['Bounded Contexts', 'Architecture Layers'] as const, sections: [section('Bounded Contexts', 'bc-body'), section('Architecture Layers', 'al-body')], usedFallback: false },
      { targetKinds: ['Domain Deep Dive', 'Key Workflows'] as const, sections: [section('Domain Deep Dive', 'dd-body'), section('Key Workflows', 'kw-body')], usedFallback: false },
    ];
    const result = service.stitchSections(header(headerSections), batches);
    expect(result.placeholders).toBe(0);
    expect(result.document.sections.map((s) => s.heading)).toEqual([
      'Executive Summary',
      'System Overview',
      'Bounded Contexts',
      'Architecture Layers',
      'Domain Deep Dive',
      'Key Workflows',
    ]);
    expect(result.document.title).toBe('Plan Spec');
    expect(result.document.executiveSummary).toContain('distils');
  });

  it('marks a failed batch as placeholders but still emits the document with header + other batches', () => {
    const headerSections = [section('Executive Summary', 'es-body'), section('System Overview', 'so-body')];
    const batches = [
      {
        targetKinds: ['Bounded Contexts', 'Architecture Layers'] as const,
        sections: [],
        usedFallback: true,
      },
      {
        targetKinds: ['Domain Deep Dive'] as const,
        sections: [section('Domain Deep Dive', 'dd-body')],
        usedFallback: false,
      },
    ];
    const result = service.stitchSections(header(headerSections), batches);
    expect(result.placeholders).toBe(2);
    expect(result.document.sections.map((s) => s.heading)).toEqual([
      'Executive Summary',
      'System Overview',
      'Domain Deep Dive',
    ]);
  });

  it('handles full failure (all batches fallback) by still producing a document with header sections only', () => {
    const headerSections = [section('Executive Summary', 'es-body'), section('System Overview', 'so-body')];
    const batches = [
      { targetKinds: ['Bounded Contexts'] as const, sections: [], usedFallback: true },
      { targetKinds: ['Architecture Layers'] as const, sections: [], usedFallback: true },
    ];
    const result = service.stitchSections(header(headerSections), batches);
    expect(result.placeholders).toBe(2);
    expect(result.document.sections).toHaveLength(2);
  });

  it('handles empty batches array', () => {
    const headerSections = [section('Executive Summary', 'es-body')];
    const result = service.stitchSections(header(headerSections), []);
    expect(result.placeholders).toBe(0);
    expect(result.document.sections).toHaveLength(1);
  });

  it('propagates null subtitle as undefined on the document', () => {
    const headerSections = [section('Executive Summary', 'es-body')];
    const result = service.stitchSections(
      { ...header(headerSections), subtitle: null },
      [],
    );
    expect(result.document.subtitle).toBeUndefined();
  });

  it('treats an empty sections array from a successful batch as a failed batch (usedFallback undefined → placeholder)', () => {
    const headerSections = [section('Executive Summary', 'es-body')];
    const batches = [
      { targetKinds: ['System Overview'] as const, sections: [], usedFallback: false },
    ];
    const result = service.stitchSections(header(headerSections), batches);
    expect(result.placeholders).toBe(1);
  });
});
