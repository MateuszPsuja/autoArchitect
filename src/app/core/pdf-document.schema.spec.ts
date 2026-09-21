import { PdfBlockSchema, PdfDocumentSchema, MermaidRefSchema } from './pdf-document.schema';

describe('PdfDocumentSchema', () => {
  const validBlockParagraph = { kind: 'paragraph', text: 'A concise sentence.' };
  const validSection = { heading: 'System Context', blocks: [validBlockParagraph] };
  const validDoc = {
    title: 'News Portal — Architecture Spec',
    subtitle: 'A concise spec distilled from the active Plan.',
    generatedAt: '2026-08-18T00:00:00.000Z',
    executiveSummary:
      'This document distils the active Plan into a single readable spec. It covers system context, bounded contexts, per-layer architecture, key domains, and key ADRs.',
    sections: [validSection, validSection, validSection],
  };

  it('accepts a fully-populated valid document', () => {
    const result = PdfDocumentSchema.safeParse(validDoc);
    expect(result.success).toBe(true);
  });

  it('accepts a document with a single section (the repair path pads up to 3)', () => {
    const result = PdfDocumentSchema.safeParse({ ...validDoc, sections: [validSection] });
    expect(result.success).toBe(true);
  });

  it('rejects more than 12 sections', () => {
    const result = PdfDocumentSchema.safeParse({
      ...validDoc,
      sections: new Array(13).fill(validSection),
    });
    expect(result.success).toBe(false);
  });

  it('requires executiveSummary to be at least 20 characters', () => {
    const result = PdfDocumentSchema.safeParse({ ...validDoc, executiveSummary: 'short' });
    expect(result.success).toBe(false);
  });

  it('accepts every mermaidRef system kind', () => {
    for (const field of ['c4.contextDiagram', 'c4.containerDiagram', 'boundedContextMap']) {
      const ref = MermaidRefSchema.parse({ kind: 'system', field });
      expect(ref.kind).toBe('system');
    }
  });

  it('accepts every mermaidRef layer kind for every layerId', () => {
    const fields = [
      'mermaidDiagram',
      'componentTreeDiagram',
      'dataFlowDiagram',
      'moduleDependenciesDiagram',
      'stateManagementDiagram',
      'apiContractDiagram',
    ];
    for (const layerId of ['frontend', 'backend', 'shared', 'infrastructure']) {
      for (const field of fields) {
        const ref = MermaidRefSchema.parse({ kind: 'layer', layerId, field });
        expect(ref.kind).toBe('layer');
      }
    }
  });

  it('accepts a blueprint mermaidRef (no payload)', () => {
    const ref = MermaidRefSchema.parse({ kind: 'blueprint' });
    expect(ref.kind).toBe('blueprint');
  });

  it('accepts a tech-stack mermaidRef with any valid layerId', () => {
    for (const layerId of ['frontend', 'backend', 'shared', 'infrastructure']) {
      const ref = MermaidRefSchema.parse({ kind: 'tech-stack', layerId });
      expect(ref.kind).toBe('tech-stack');
    }
  });

  it('rejects a tech-stack mermaidRef with a malformed layerId', () => {
    for (const bad of ['Frontend', 'front_end', 'front end', '', 'front/end']) {
      expect(MermaidRefSchema.safeParse({ kind: 'tech-stack', layerId: bad }).success).toBe(false);
    }
  });

  it('rejects an unknown mermaidRef field', () => {
    const result = MermaidRefSchema.safeParse({
      kind: 'layer',
      layerId: 'frontend',
      field: 'totallyMadeUpDiagram',
    });
    expect(result.success).toBe(false);
  });

  it('accepts each PdfBlock kind', () => {
    const blocks = [
      { kind: 'paragraph', text: 'hello' },
      { kind: 'bullets', items: ['a', 'b'] },
      { kind: 'numbered', items: ['first', 'second'] },
      { kind: 'keyValueTable', rows: [['key', 'value']] },
      {
        kind: 'mermaidRef',
        ref: { kind: 'system', field: 'c4.contextDiagram' },
        caption: 'C4 context',
      },
      { kind: 'callout', tone: 'info', text: 'grounded in plan' },
      { kind: 'callout', tone: 'warning', title: 'Deprecated', text: 'use new model' },
      { kind: 'glossary', entries: [['Plan', 'A structured architecture document']] },
      {
        kind: 'matrix',
        columns: ['Frontend', 'Backend'],
        rows: [{ label: 'targetPlatform', cells: ['TypeScript 5.5', 'TypeScript 5.5'] }],
      },
    ];
    for (const block of blocks) {
      expect(PdfBlockSchema.safeParse(block).success).toBe(true);
    }
  });

  it('rejects a bullets block with no items', () => {
    expect(PdfBlockSchema.safeParse({ kind: 'bullets', items: [] }).success).toBe(false);
  });

  it('rejects an unknown block kind (no audience / twoColumn / kpiGrid allowed)', () => {
    expect(
      PdfBlockSchema.safeParse({ kind: 'audience', text: 'x' } as never).success,
    ).toBe(false);
    expect(
      PdfBlockSchema.safeParse({ kind: 'twoColumn', left: [], right: [] } as never).success,
    ).toBe(false);
    expect(
      PdfBlockSchema.safeParse({
        kind: 'kpiGrid',
        items: [{ label: 'L', value: '4' }],
      } as never).success,
    ).toBe(false);
  });

  it('defaults callout tone to info when omitted', () => {
    const parsed = PdfBlockSchema.parse({ kind: 'callout', text: 'plain' });
    expect(parsed.kind).toBe('callout');
    if (parsed.kind === 'callout') {
      expect(parsed.tone).toBeUndefined();
    }
  });

  it('rejects a callout with an unknown tone', () => {
    expect(
      PdfBlockSchema.safeParse({ kind: 'callout', tone: 'critical', text: 'x' } as never).success,
    ).toBe(false);
  });

  it('accepts a matrix with a single column (the repair path pads cells)', () => {
    expect(
      PdfBlockSchema.safeParse({
        kind: 'matrix',
        columns: ['only'],
        rows: [{ label: 'a', cells: ['v'] }],
      }).success,
    ).toBe(true);
  });

  it('rejects a glossary with an empty entries array', () => {
    expect(
      PdfBlockSchema.safeParse({ kind: 'glossary', entries: [] }).success,
    ).toBe(false);
  });
});
