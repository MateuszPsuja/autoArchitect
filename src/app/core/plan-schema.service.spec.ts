import { TestBed } from '@angular/core/testing';
import { PlanSchemaService } from './plan-schema.service';
import { minimalPlanFixture } from '../testing/fixtures';
import { UserEditSummary } from './diff/user-edit-summary';

describe('PlanSchemaService', () => {
  let service: PlanSchemaService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PlanSchemaService);
  });

  it('validates the updated minimal plan fixture', () => {
    const result = service.validate(minimalPlanFixture);

    expect(result.success).toBe(true);
  });

  it('fails when domains array is empty', () => {
    const invalidPlan = { ...minimalPlanFixture, domains: [] };
    const result = service.validate(invalidPlan);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.fields.length).toBeGreaterThan(0);
    }
  });

  it('fails when a domain is missing the required layer field', () => {
    const domainWithoutLayer = { ...minimalPlanFixture.domains[0] } as Record<string, unknown>;
    delete domainWithoutLayer['layer'];

    const invalidPlan = {
      ...minimalPlanFixture,
      domains: [domainWithoutLayer],
    };

    const result = service.validate(invalidPlan);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.fields.some((f) => f.includes('layer'))).toBe(true);
    }
  });

  it('fails when a domain layer value is not valid kebab-case', () => {
    const invalidPlan = {
      ...minimalPlanFixture,
      domains: [{ ...minimalPlanFixture.domains[0], layer: 'not a layer' }],
    };

    const result = service.validate(invalidPlan);

    expect(result.success).toBe(false);
  });

  it('accepts domains with the legacy three layer values', () => {
    for (const layer of ['frontend', 'backend', 'shared'] as const) {
      const plan = {
        ...minimalPlanFixture,
        domains: [{ ...minimalPlanFixture.domains[0], layer }],
      };
      const result = service.validate(plan);

      expect(result.success).toBe(true);
    }
  });

  it('accepts domains with a free-form kebab-case layer id (e.g. "cli", "ingest")', () => {
    for (const layer of ['cli', 'ingest', 'transform', 'sink', 'worker', 'core']) {
      const plan = {
        ...minimalPlanFixture,
        domains: [{ ...minimalPlanFixture.domains[0], layer }],
      };
      const result = service.validate(plan);

      expect(result.success).toBe(true);
    }
  });

  it('accepts a plan with an empty boundedContexts array', () => {
    const plan = { ...minimalPlanFixture, boundedContexts: [] };
    const result = service.validate(plan);

    expect(result.success).toBe(false);
  });

  it('accepts a plan with an empty architectureLayers array', () => {
    const plan = { ...minimalPlanFixture, architectureLayers: [] };
    const result = service.validate(plan);

    expect(result.success).toBe(false);
  });

  it('fails when a component is missing mandatory SDD test specifications', () => {
    const componentWithoutTdd = { ...minimalPlanFixture.domains[0].components[0] } as Record<
      string,
      unknown
    >;
    delete componentWithoutTdd['tddSpec'];

    const result = service.validate({
      ...minimalPlanFixture,
      domains: [
        {
          ...minimalPlanFixture.domains[0],
          components: [componentWithoutTdd],
        },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.fields.some((field) => field.includes('tddSpec'))).toBe(true);
    }
  });

  it('validates a component tddSpec with unitTests and integrationTests', () => {
    const result = service.validate(minimalPlanFixture);

    expect(result.success).toBe(true);
    if (result.success) {
      const component = result.plan.domains[0].components[0];
      expect(component.tddSpec?.unitTests.length).toBeGreaterThan(0);
      expect(component.tddSpec?.integrationTests.length).toBeGreaterThan(0);
    }
  });

  it('exports JSON schema object with properties key', () => {
    const schema = service.toJsonSchema() as Record<string, unknown>;

    expect(schema).toBeTruthy();
    expect(schema['properties']).toBeTruthy();
  });

  it('exports JSON schema that exposes userStories, functionalRequirements, successCriteria, constitution, and branchName', () => {
    const schema = service.toJsonSchema() as Record<string, unknown>;
    const properties = (schema['properties'] ?? {}) as Record<string, Record<string, unknown>>;

    expect(properties['userStories']).toBeTruthy();
    expect(properties['functionalRequirements']).toBeTruthy();
    expect(properties['successCriteria']).toBeTruthy();
    expect(properties['constitution']).toBeTruthy();

    const metaProperties = ((properties['meta'] ?? {})['properties'] ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    expect(metaProperties['branchName']).toBeTruthy();
  });

  it('accepts a plan without branchName, userStories, or constitution (legacy v2)', () => {
    const legacy = { ...minimalPlanFixture };
    const metaCopy: Record<string, unknown> = { ...legacy.meta };
    delete metaCopy['branchName'];
    const candidate = {
      ...legacy,
      meta: metaCopy,
    } as unknown as typeof minimalPlanFixture;
    delete (candidate as Partial<typeof candidate>).userStories;
    delete (candidate as Partial<typeof candidate>).functionalRequirements;
    delete (candidate as Partial<typeof candidate>).successCriteria;
    delete (candidate as Partial<typeof candidate>).constitution;

    const result = service.validate(candidate);
    expect(result.success).toBe(true);
  });

  it('accepts a legacy architectureLayer without spec-kit fields (all optional)', () => {



    const layerWithoutSpeckit = { ...minimalPlanFixture.architectureLayers[0] } as Record<
      string,
      unknown
    >;
    delete layerWithoutSpeckit['summary'];
    delete layerWithoutSpeckit['technicalContext'];
    delete layerWithoutSpeckit['constitutionCheck'];
    delete layerWithoutSpeckit['projectStructureTree'];
    delete layerWithoutSpeckit['complexityTracking'];
    delete layerWithoutSpeckit['componentTreeDiagram'];
    delete layerWithoutSpeckit['dataFlowDiagram'];
    delete layerWithoutSpeckit['moduleDependenciesDiagram'];
    delete layerWithoutSpeckit['stateManagementDiagram'];
    delete layerWithoutSpeckit['apiContractDiagram'];

    const result = service.validate({
      ...minimalPlanFixture,
      architectureLayers: [layerWithoutSpeckit],
    });

    expect(result.success).toBe(true);
  });

  it('accepts a fully-populated spec-kit architectureLayer', () => {
    const layerWithSpeckit = {
      ...minimalPlanFixture.architectureLayers[0],
      summary: 'Layer summary.',
      technicalContext: {
        storage: 'N/A',
        targetPlatform: 'Browser',
        performanceGoals: 'TTI < 3s',
        constraints: 'Signals only',
        scaleScope: '50k MAU',
      },
      constitutionCheck: ['Strict TypeScript'],
      projectStructureTree: 'src/app/',
      complexityTracking: [
        {
          violation: 'Repository pattern',
          whyNeeded: 'Testability',
          simplerAlternativeRejected: 'Direct ORM',
        },
      ],
      componentTreeDiagram: 'graph TD\nA-->B',
      dataFlowDiagram: 'flowchart LR\nX-->Y',
      moduleDependenciesDiagram: 'graph LR\nF-->C',
      stateManagementDiagram: 'stateDiagram-v2\n[*] --> idle',
      apiContractDiagram: 'sequenceDiagram\nClient->>API: GET',
    };

    const result = service.validate({
      ...minimalPlanFixture,
      architectureLayers: [layerWithSpeckit],
    });

    expect(result.success).toBe(true);
  });

  it('rejects an architectureLayer whose technicalContext is missing a required row', () => {
    const invalidLayer = {
      ...minimalPlanFixture.architectureLayers[0],
      technicalContext: {
        targetPlatform: 'Browser',

      },
    };

    const result = service.validate({
      ...minimalPlanFixture,
      architectureLayers: [invalidLayer],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.fields.some((f) => f.includes('technicalContext'))).toBe(true);
    }
  });

  it('validatePlan accepts a {"plan": {...}} wrapper around the minimal fixture', () => {
    const wrapped = { plan: minimalPlanFixture };
    const result = service.validatePlan(wrapped);

    expect(result.success).toBe(true);
  });

  it('validatePlan accepts each known wrapper key (plan, result, output, response, data)', () => {
    for (const key of ['plan', 'result', 'output', 'response', 'data'] as const) {
      const wrapped = { [key]: minimalPlanFixture };
      const result = service.validatePlan(wrapped);

      expect(result.success).toBe(true);
    }
  });

  it('validatePlan rejects a one-key wrapper whose key is not in the allow-list', () => {
    const wrapped = { foo: minimalPlanFixture };
    const result = service.validatePlan(wrapped);

    expect(result.success).toBe(false);
  });

  it('validatePlan returns the rewritten wrapper-detected message when the inner object still fails', () => {
    const wrapped = { plan: {} };
    const result = service.validatePlan(wrapped, '{"plan":...');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.message).toContain('wrapped the plan');
      expect(result.message).toContain('Raw output begins with:');
      expect(result.message).toContain('{"plan":...');
    }
  });

  it('validatePlan preserves the generic message when only some required keys are missing', () => {
    const partial = { ...minimalPlanFixture, boundedContexts: [], domains: [] };
    const result = service.validatePlan(partial, 'irrelevant');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.message).toBe('Plan schema validation failed.');
    }
  });

  it('unwrapPlanCandidate does not unwrap arrays or primitives', () => {
    expect(service.unwrapPlanCandidate([1, 2, 3])).toEqual([1, 2, 3]);
    expect(service.unwrapPlanCandidate('hello')).toBe('hello');
    expect(service.unwrapPlanCandidate(null)).toBe(null);
    expect(service.unwrapPlanCandidate(undefined)).toBe(undefined);
  });

  it('unwrapPlanCandidate returns the input unchanged for objects with multiple keys', () => {
    const candidate = { plan: minimalPlanFixture, extra: 1 };
    expect(service.unwrapPlanCandidate(candidate)).toBe(candidate);
  });

  describe('validatePdfDocumentWithUnwrap', () => {
    const validPdf = {
      title: 'Plan Spec',
      subtitle: 'A concise distillation.',
      generatedAt: '2026-08-18T00:00:00.000Z',
      executiveSummary:
        'This PDF distils the active Plan into a single readable spec covering context, layers, and decisions.',
      sections: [
        {
          heading: 'System Context',
          blocks: [{ kind: 'paragraph', text: 'The system provides a planner surface.' }],
        },
        {
          heading: 'Bounded Contexts',
          blocks: [{ kind: 'bullets', items: ['Planning — core domain.'] }],
        },
        {
          heading: 'Workflows',
          blocks: [{ kind: 'numbered', items: ['Capture input', 'Generate plan'] }],
        },
      ],
    };

    it('accepts a bare PdfDocument payload', () => {
      const result = service.validatePdfDocumentWithUnwrap(validPdf);
      expect(result.success).toBe(true);
    });

    it('unwraps a single-key {"document": {...}} wrapper and accepts the inner PdfDocument', () => {
      const result = service.validatePdfDocumentWithUnwrap({ document: validPdf });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.document.title).toBe('Plan Spec');
      }
    });

    it('unwraps a single-key {"pdf": {...}} wrapper whose key is not in the allow-list', () => {
      const result = service.validatePdfDocumentWithUnwrap({ pdf: validPdf });
      expect(result.success).toBe(true);
    });

    it('unwraps a single-key {"spec": {...}} wrapper', () => {
      const result = service.validatePdfDocumentWithUnwrap({ spec: validPdf });
      expect(result.success).toBe(true);
    });

    it('reports the missing top-level fields when neither the wrapper nor its inner match the schema', () => {
      const result = service.validatePdfDocumentWithUnwrap({ document: { unrelated: 1 } });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.fields).toEqual(
          expect.arrayContaining([
            'title: Invalid input: expected string, received undefined',
            'generatedAt: Invalid input: expected string, received undefined',
            'executiveSummary: Invalid input: expected string, received undefined',
            'sections: Invalid input: expected array, received undefined',
          ]),
        );
      }
    });

    it('includes a candidate-shape probe in the failure message when root fields are missing', () => {
      const candidate = {
        meta: {
          title: 'Spec',
          summary: 'Plan summary text',
          generatedAt: '2026-09-20T07:00:00Z',
        },
        body: {
          executiveSummary:
            'Browser-only runtime. Audio playback with timing. No backend.',
          sections: [
            { heading: 'S1', blocks: [{ kind: 'paragraph', text: 'x'.repeat(60) }] },
            { heading: 'S2', blocks: [{ kind: 'paragraph', text: 'y'.repeat(60) }] },
            { heading: 'S3', blocks: [{ kind: 'paragraph', text: 'z'.repeat(60) }] },
          ],
        },
        sections: [
          { heading: 'S1', blocks: [{ kind: 'paragraph', text: 'x'.repeat(60) }] },
        ],
      };
      const result = service.validatePdfDocumentWithUnwrap(candidate);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.message).toContain('Candidate shape');
        expect(result.message).toContain('object keys: [meta, body, sections]');
        expect(result.message).toMatch(/meta=object\{title, summary, generatedAt\}/);
        expect(result.message).toMatch(/body=object\{executiveSummary, sections/);
        expect(result.message).toMatch(/sections=array\(len=1\)/);
      }
    });

    it('wraps a single PdfSection-shaped root into a PdfDocument', () => {
      const candidate = {
        heading: 'Executive Summary',
        blocks: [
          {
            kind: 'paragraph',
            text: 'Browser-only audio runtime with first audible reply under 200 ms and no backend.',
          },
        ],
      };
      const result = service.validatePdfDocumentWithUnwrap(candidate);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.document.title).toBe('Executive Summary');
        expect(result.document.executiveSummary).toContain('Browser-only audio runtime');
        expect(result.document.sections.length).toBeGreaterThanOrEqual(3);
        expect(result.document.sections[0].heading).toBe('Executive Summary');
        expect(result.document.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }
    });

    it('reports a repair diagnostic when wrapping a single-section root', () => {
      const candidate = {
        heading: 'Executive Summary',
        blocks: [
          {
            kind: 'paragraph',
            text: 'Browser-only audio runtime with first audible reply under 200 ms and no backend.',
          },
        ],
      };
      const result = service.validatePdfDocumentWithUnwrap(candidate, {
        title: 'Browser-only Audio Runtime',
        summary: 'A browser-based audio generation tool with sub-200ms first-reply latency.',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.repair).toBeDefined();
        expect(result.repair?.reason).toBe('single_section_root');
        expect(result.repair?.placeholderCount).toBeGreaterThanOrEqual(1);
        expect(result.repair?.originalHeading).toBe('Executive Summary');
        expect(result.repair?.originalHeadings).toBeUndefined();
        expect(result.repair?.rawBytes).toBeUndefined();
        expect(result.repair?.finishReason).toBeUndefined();
        expect(result.repair?.attemptCount).toBeUndefined();
        if (result.repair) {
          const placeholders = result.document.sections
            .map((s) => s.heading)
            .filter((h) => h.toLowerCase().includes('additional context'));
          expect(placeholders.length).toBe(result.repair.placeholderCount);
          expect(result.document.sections.some((s) => s.heading.includes('omitted by LLM'))).toBe(false);
          const padded = result.document.sections.filter((s) => /Section \d+ — additional context/.test(s.heading));
          for (const section of padded) {
            const firstBlock = section.blocks[0] as { kind: string; text?: string };
            expect(firstBlock.kind).toBe('paragraph');
            expect(firstBlock.text).not.toMatch(/omitted in the original LLM response/i);
            expect(firstBlock.text).not.toMatch(/Regenerate the PDF/i);
          }
        }
      }
    });

    it('omits the repair diagnostic for a valid full PdfDocument', () => {
      const result = service.validatePdfDocumentWithUnwrap(validPdf);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.repair).toBeUndefined();
      }
    });

    it('omits the repair diagnostic when a wrapper key like {document: {...}} already holds a full PdfDocument', () => {
      const result = service.validatePdfDocumentWithUnwrap({ document: validPdf });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.repair).toBeUndefined();
      }
    });

    it('repairs an array-of-strings root into a PdfDocument with a placeholder block per heading', () => {
      const candidate = [
        'Outbox/At-least-once',
        'Repository/UoW',
        'Idempotency',
        'Signal/Zod',
        'OTel/Digest',
      ];
      const result = service.validatePdfDocumentWithUnwrap(candidate, {
        title: 'Resilient Async Platform',
        summary: 'A back-end reliability layer for durable, idempotent message processing.',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.repair).toBeDefined();
        expect(result.repair?.reason).toBe('array_section_headings');
        expect(result.repair?.placeholderCount).toBe(5);
        expect(result.repair?.originalHeadings).toEqual([
          'Outbox/At-least-once',
          'Repository/UoW',
          'Idempotency',
          'Signal/Zod',
          'OTel/Digest',
        ]);
        expect(result.document.sections).toHaveLength(5);
        expect(result.document.sections.map((s) => s.heading)).toEqual([
          'Outbox/At-least-once',
          'Repository/UoW',
          'Idempotency',
          'Signal/Zod',
          'OTel/Digest',
        ]);
        expect(result.document.sections[0].blocks[0].kind).toBe('paragraph');
        expect(result.document.executiveSummary).toContain('back-end reliability layer');
        expect(result.document.executiveSummary).not.toMatch(/5 headings/);
        expect(result.document.title).toBe('Outbox/At-least-once');
        for (const section of result.document.sections) {
          const text = (section.blocks[0] as { text: string }).text;
          expect(text).not.toMatch(/omitted in the original LLM response/i);
          expect(text).not.toMatch(/Regenerate the PDF/i);
          expect(text).not.toMatch(/^Content for /);
        }
      }
    });

    it('pads an array-of-strings root to 3 sections when fewer than 3 headings are provided', () => {
      const candidate = ['Only Heading'];
      const result = service.validatePdfDocumentWithUnwrap(candidate, {
        title: 'Tiny Plan',
        summary: 'A small plan with one section heading.',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.repair?.reason).toBe('array_section_headings');
        expect(result.document.sections).toHaveLength(3);
        expect(result.document.sections[0].heading).toBe('Only Heading');
        expect(result.document.sections[1].heading).toMatch(/Section 2 — additional context/);
        expect(result.document.sections[2].heading).toMatch(/Section 3 — additional context/);
        expect(result.document.sections.every((s) => !s.heading.includes('omitted by LLM'))).toBe(true);
        expect(result.repair?.placeholderCount).toBe(3);
      }
    });

    it('falls back to a generic placeholder paragraph when no plan context is supplied', () => {
      const candidate = ['Alpha', 'Beta'];
      const result = service.validatePdfDocumentWithUnwrap(candidate);
      expect(result.success).toBe(true);
      if (result.success) {
        const first = (result.document.sections[0].blocks[0] as { text: string }).text;
        expect(first).not.toMatch(/omitted in the original LLM response/i);
        expect(first).not.toMatch(/Regenerate the PDF/i);
        expect(first.length).toBeGreaterThan(0);
      }
    });

    it('synthesises padding content from the LLM\'s real blocks when available (single_section_root)', () => {
      const candidate = {
        heading: 'Executive Summary',
        blocks: [
          {
            kind: 'paragraph',
            text: 'Browser-only audio runtime with first audible reply under 200 ms and no backend.',
          },
          {
            kind: 'bullets',
            items: ['Sub-200ms p50 first audible reply', 'No backend dependency', 'Web Audio API only'],
          },
        ],
      };
      const result = service.validatePdfDocumentWithUnwrap(candidate, {
        title: 'Browser Audio',
        summary: 'A browser-only audio tool.',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        const padded = result.document.sections.filter((s) =>
          /Section \d+ — additional context/.test(s.heading),
        );
        expect(padded.length).toBe(2);
        const texts = padded.map((s) => (s.blocks[0] as { text: string }).text);
        expect(texts.some((t) => t.includes('Sub-200ms p50'))).toBe(true);
      }
    });

    it('reports unrecoverable when the array contains no usable string headings', () => {
      const result = service.validatePdfDocumentWithUnwrap(['', '   ', null, 42, {}]);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.fields.length).toBeGreaterThan(0);
      }
    });

    it('includes item-type probes when the candidate is an array at the root with no usable headings', () => {
      const candidate = [null, 42, {}, [], false];
      const result = service.validatePdfDocumentWithUnwrap(candidate);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.message).toContain('array length=5');
        expect(result.message).toContain('item types:');
        expect(result.message).toMatch(/\[0\] null/);
        expect(result.message).toMatch(/\[4\] boolean/);
      }
    });

    it('auto-repairs keyValueTable rows that have 3+ items by collapsing extras into the value', () => {
      const docWithFatRows = {
        ...validPdf,
        sections: [
          ...validPdf.sections,
          {
            heading: 'Tech stack',
            blocks: [
              {
                kind: 'keyValueTable',
                rows: [
                  ['Frontend', 'Angular 17', 'standalone+signals', 'TypeScript 5.4'],
                  ['Backend', 'FastAPI', 'SQLAlchemy 2', 'Pydantic v2'],
                ],
              },
            ],
          },
        ],
      };
      const result = service.validatePdfDocumentWithUnwrap(docWithFatRows);
      expect(result.success).toBe(true);
      if (result.success) {
        const block = result.document.sections[3].blocks[0] as {
          kind: string;
          rows: string[][];
        };
        expect(block.kind).toBe('keyValueTable');
        expect(block.rows).toHaveLength(2);
        expect(block.rows[0]).toEqual(['Frontend', 'Angular 17; standalone+signals; TypeScript 5.4']);
        expect(block.rows[1]).toEqual(['Backend', 'FastAPI; SQLAlchemy 2; Pydantic v2']);
      }
    });

    it('auto-repairs glossary entries that have 3+ items', () => {
      const docWithFatGlossary = {
        ...validPdf,
        sections: [
          ...validPdf.sections,
          {
            heading: 'Glossary',
            blocks: [
              {
                kind: 'glossary',
                entries: [['Plan', 'structured doc', 'for architecture'], ['Foo', 'bar']],
              },
            ],
          },
        ],
      };
      const result = service.validatePdfDocumentWithUnwrap(docWithFatGlossary);
      expect(result.success).toBe(true);
      if (result.success) {
        const block = result.document.sections[3].blocks[0] as {
          kind: string;
          entries: string[][];
        };
        expect(block.entries[0]).toEqual(['Plan', 'structured doc; for architecture']);
        expect(block.entries[1]).toEqual(['Foo', 'bar']);
      }
    });

    it('leaves 2-item rows unchanged', () => {
      const result = service.validatePdfDocumentWithUnwrap(validPdf);
      expect(result.success).toBe(true);
      if (result.success) {
        const firstSection = result.document.sections[0];
        expect(firstSection.blocks[0].kind).toBe('paragraph');
      }
    });
  });

  it('validate() still rejects a wrapper (regression guard)', () => {
    const wrapped = { plan: minimalPlanFixture };
    const result = service.validate(wrapped);

    expect(result.success).toBe(false);
  });

  describe('sectioned sub-schemas', () => {
    const validScaffold = {
      meta: minimalPlanFixture.meta,
      systemOverview: {
        ...minimalPlanFixture.systemOverview,
        boundedContextMap: minimalPlanFixture.systemOverview.boundedContextMap ?? 'graph LR\nA-->B',
      },
      boundedContexts: minimalPlanFixture.boundedContexts,
      architectureLayerIds: ['frontend', 'backend'] as ('frontend' | 'backend')[],
      domainIds: minimalPlanFixture.domains.map((d) => d.id),
      includeTail: true,
    };

    it('validateScaffold accepts a scaffold with at least one layerId and one domainId', () => {
      const result = service.validateScaffold(validScaffold);
      expect(result.success).toBe(true);
    });

    it('validateScaffold accepts a scaffold without boundedContextMap', () => {
      const { boundedContextMap: _omitted, ...systemOverview } = validScaffold.systemOverview;
      void _omitted;
      const without = { ...validScaffold, systemOverview };
      const result = service.validateScaffold(without);
      expect(result.success).toBe(true);
    });

    it('validateScaffold rejects a scaffold missing architectureLayerIds', () => {
      const invalid = { ...validScaffold, architectureLayerIds: [] };
      const result = service.validateScaffold(invalid);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.fields.some((f) => f.includes('architectureLayerIds'))).toBe(true);
      }
    });

    it('validateScaffold rejects a scaffold missing domainIds', () => {
      const invalid = { ...validScaffold, domainIds: [] };
      const result = service.validateScaffold(invalid);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.fields.some((f) => f.includes('domainIds'))).toBe(true);
      }
    });

    it('validateLayerChunk accepts a single ArchitectureLayer object', () => {
      const result = service.validateLayerChunk(minimalPlanFixture.architectureLayers[0]);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBe(1);
      }
    });

    it('validateLayerChunk accepts an array of ArchitectureLayer objects', () => {
      const result = service.validateLayerChunk(minimalPlanFixture.architectureLayers);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBe(minimalPlanFixture.architectureLayers.length);
      }
    });

    it('validateLayerChunk rejects malformed layer objects', () => {
      const result = service.validateLayerChunk({ id: 'frontend' });
      expect(result.success).toBe(false);
    });

    it('validateScaffold unwraps a single-element array wrapper', () => {
      const result = service.validateScaffold([validScaffold]);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.meta.title).toBe(minimalPlanFixture.meta.title);
      }
    });

    it('validateScaffold unwraps a single-key {plan: ...} object wrapper', () => {
      const result = service.validateScaffold({ plan: validScaffold });
      expect(result.success).toBe(true);
    });

    it('validateScaffold unwraps `[schema, scaffold]` form', () => {
      const wrapped = [
        { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' },
        validScaffold,
      ];
      const result = service.validateScaffold(wrapped);
      expect(result.success).toBe(true);
    });

    it('validateScaffold still rejects genuinely-bad candidates', () => {
      const result = service.validateScaffold({ meta: { title: 't' } });
      expect(result.success).toBe(false);
    });

    it('validateScaffold accepts an array-of-array wrapper', () => {
      const result = service.validateScaffold([[validScaffold]]);
      expect(result.success).toBe(true);
    });

    it('validateScaffold accepts an object nested one level deep with a trailing note', () => {
      const result = service.validateScaffold([[{ id: 'frontend' }, validScaffold], 'note']);
      expect(result.success).toBe(true);
    });

    it('validateScaffold accepts a single-key wrapper whose value is an array', () => {
      const result = service.validateScaffold({ plan: [validScaffold] });
      expect(result.success).toBe(true);
    });

    const validTail = { workflows: [], adrs: [], agentTasks: [] };
    const validLayer = minimalPlanFixture.architectureLayers[0];
    const validDomain = minimalPlanFixture.domains[0];

    it('validateLayerChunk accepts an array-of-array wrapper', () => {
      const result = service.validateLayerChunk([[validLayer]]);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBe(1);
      }
    });

    it('validateDomainChunk accepts an object nested one level deep with a trailing note', () => {
      const result = service.validateDomainChunk([[{ id: 'frontend' }, validDomain], 'note']);
      expect(result.success).toBe(true);
    });

    it('validateTail accepts a single-key wrapper whose value is an array', () => {
      const result = service.validateTail({ plan: [validTail] });
      expect(result.success).toBe(true);
    });

    it('validateDomainChunk accepts a single Domain object', () => {
      const result = service.validateDomainChunk(minimalPlanFixture.domains[0]);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBe(1);
      }
    });

    it('validateDomainChunk accepts an array of Domain objects', () => {
      const result = service.validateDomainChunk(minimalPlanFixture.domains);
      expect(result.success).toBe(true);
    });

    it('validateTail accepts an empty-tail object', () => {
      const result = service.validateTail({ workflows: [], adrs: [], agentTasks: [] });
      expect(result.success).toBe(true);
    });

    it('validateTail accepts the fixture tail payload', () => {
      const result = service.validateTail({
        workflows: minimalPlanFixture.workflows,
        adrs: minimalPlanFixture.adrs,
        agentTasks: minimalPlanFixture.agentTasks,
      });
      expect(result.success).toBe(true);
    });

    it('mergeScaffold assembles a Plan that round-trips through the full schema', () => {
      const result = service.mergeScaffold({
        scaffold: validScaffold,
        layers: minimalPlanFixture.architectureLayers,
        domains: minimalPlanFixture.domains,
        tail: {
          workflows: minimalPlanFixture.workflows,
          adrs: minimalPlanFixture.adrs,
          agentTasks: minimalPlanFixture.agentTasks,
        },
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      const plan = result.value;

      const finalCheck = service.validate(plan);
      expect(finalCheck.success).toBe(true);
      expect(plan.meta.title).toBe(minimalPlanFixture.meta.title);
      expect(plan.boundedContexts.length).toBe(minimalPlanFixture.boundedContexts.length);
    });

    it('mergeScaffold returns a failure result with field=layers when a layer chunk is invalid', () => {
      const result = service.mergeScaffold({
        scaffold: validScaffold,
        layers: [{ id: 'frontend' }],
        domains: minimalPlanFixture.domains,
        tail: { workflows: [], adrs: [], agentTasks: [] },
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.field).toBe('layers');
      expect(result.error).toMatch(/ArchitectureLayer/);
    });

    it('mergeScaffold returns a failure result with field=domains when a domain chunk is invalid', () => {
      const result = service.mergeScaffold({
        scaffold: validScaffold,
        layers: minimalPlanFixture.architectureLayers,
        domains: [{ id: 'x' }],
        tail: { workflows: [], adrs: [], agentTasks: [] },
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.field).toBe('domains');
      expect(result.error).toMatch(/Domain/);
    });

    it('mergeScaffold normalises workflow.steps / workflow.domainIds when the LLM emits null', () => {





      const result = service.mergeScaffold({
        scaffold: validScaffold,
        layers: minimalPlanFixture.architectureLayers,
        domains: minimalPlanFixture.domains,
        tail: {
          workflows: [
            {
              id: 'wf-null',
              name: 'Null workflow',
              description: 'Has null steps + null domainIds.',
              steps: null,
              domainIds: null,
            } as unknown as typeof minimalPlanFixture.workflows[number],
          ],
          adrs: [],
          agentTasks: [],
        },
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      const plan = result.value;

      expect(plan.workflows).toHaveLength(1);
      expect(plan.workflows[0].steps).toEqual([]);
      expect(plan.workflows[0].domainIds).toEqual([]);



      const finalCheck = service.validate(plan);
      expect(finalCheck.success).toBe(true);
    });

    it('mergeScaffold surfaces a precise failure result when a layer chunk item fails the per-item schema', () => {







      const result = service.mergeScaffold({
        scaffold: validScaffold,
        layers: [{ notAnArray: true }],
        domains: minimalPlanFixture.domains,
        tail: { workflows: [], adrs: [], agentTasks: [] },
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.field).toBe('layers');
      expect(result.error).toMatch(/Layer chunk did not match ArchitectureLayer schema/);
    });

    it('boundedContextProject returns only id+name from each bounded context', () => {
      const projection = service.boundedContextProject(validScaffold);
      expect(projection).toEqual([
        {
          id: minimalPlanFixture.boundedContexts[0].id,
          name: minimalPlanFixture.boundedContexts[0].name,
        },
      ]);
    });
  });

  describe('auto-generated stubs (bulletproof fallback)', () => {
    it('buildLayerStub produces a schema-compliant ArchitectureLayer', () => {
      const stub = service.buildLayerStub('shared');

      expect(stub.id).toBe('shared');
      expect(stub.name).toBe('Shared');
      expect(stub.techStack.length).toBeGreaterThan(0);
      expect(stub.patterns.length).toBeGreaterThan(0);
      expect(stub.mermaidDiagram.length).toBeGreaterThan(0);
      expect(stub.directoryStructure.length).toBeGreaterThan(0);
      expect(stub.directoryStructure[0].agentInstructions.length).toBeGreaterThanOrEqual(3);

      const result = service.validateLayerChunk(stub);
      expect(result.success).toBe(true);
    });

    it('buildLayerStub sanitises non-kebab ids', () => {
      const stub = service.buildLayerStub('Mixed_Case ID!');
      expect(stub.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    });

    it('buildDomainStub produces a schema-compliant Domain', () => {
      const stub = service.buildDomainStub('core-planning', 'backend');

      expect(stub.id).toBe('core-planning');
      expect(stub.layer).toBe('backend');
      expect(stub.responsibilities.length).toBeGreaterThan(0);
      expect(stub.directoryPath.length).toBeGreaterThan(0);
      expect(stub.components.length).toBeGreaterThan(0);
      expect(stub.components[0].tddSpec.unitTests.length).toBeGreaterThanOrEqual(2);
      expect(stub.components[0].tddSpec.integrationTests.length).toBeGreaterThanOrEqual(1);

      const result = service.validateDomainChunk(stub);
      expect(result.success).toBe(true);
    });

    it('buildDomainStub uses the provided layerId for cross-reference integrity', () => {
      const stub = service.buildDomainStub('some-domain', 'my-layer');
      expect(stub.layer).toBe('my-layer');
      expect(stub.components[0].targetFile).toContain('my-layer');
    });
  });

  describe('id-pinned validators (regen path)', () => {
    it('validateLayerChunkForIds accepts a layer whose id matches an allowed id', () => {
      const layer = { ...minimalPlanFixture.architectureLayers[0], id: 'frontend' };
      const result = service.validateLayerChunkForIds([layer], ['frontend']);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].id).toBe('frontend');
      }
    });

    it('validateLayerChunkForIds rejects a layer whose id drifted from the allowed set', () => {
      const layer = { ...minimalPlanFixture.architectureLayers[0], id: 'frontend-app' };
      const result = service.validateLayerChunkForIds([layer], ['frontend']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.message).toContain('frontend-app');
        expect(result.message).toContain('frontend');
      }
    });

    it('validateLayerChunkForIds rejects an empty result array', () => {





      const result = service.validateLayerChunkForIds([], ['frontend']);
      expect(result.success).toBe(false);
    });

    it('validateLayerChunkForIds applies the same sanitisation as buildLayerStub', () => {





      const layer = { ...minimalPlanFixture.architectureLayers[0], id: 'frontend-app' };
      const result = service.validateLayerChunkForIds([layer], ['frontend']);
      expect(result.success).toBe(false);
    });

    it('validateDomainChunkForIds accepts a domain whose id matches an allowed id', () => {
      const domain = { ...minimalPlanFixture.domains[0], id: 'orders' };
      const result = service.validateDomainChunkForIds([domain], ['orders']);
      expect(result.success).toBe(true);
    });

    it('validateDomainChunkForIds rejects a domain whose id drifted from the allowed set', () => {
      const domain = { ...minimalPlanFixture.domains[0], id: 'orders-api' };
      const result = service.validateDomainChunkForIds([domain], ['orders']);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.message).toContain('orders-api');
        expect(result.message).toContain('orders');
      }
    });

    it('validateDomainChunkForIds rejects an empty result array', () => {
      const result = service.validateDomainChunkForIds([], ['orders']);
      expect(result.success).toBe(false);
    });
  });

  describe('size-cap backstop (.transform truncation)', () => {





    function makeLongString(prefix: string, count: number, char = 'x'): string[] {
      return Array.from({ length: count }, (_, i) => `${prefix}-${i}-${char.repeat(120)}`);
    }

    function makeLongMermaid(type: string, lines: number): string {
      return [type, ...Array.from({ length: lines - 1 }, (_, i) => `  N${i}-->M${i}`)].join('\n');
    }

    const oversizedPlan = {
      ...minimalPlanFixture,
      architectureLayers: minimalPlanFixture.architectureLayers.map((layer) => ({
        ...layer,
        techStack: makeLongString('tech', 50),
        patterns: makeLongString('pattern', 50),
        directoryStructure: Array.from({ length: 20 }, (_, i) => ({
          path: `extra/dir-${i}`,
          description: `Extra directory ${i}`,
          agentInstructions: makeLongString('step', 20),
        })),
        mermaidDiagram: makeLongMermaid('graph TD', 80),
        componentTreeDiagram: makeLongMermaid('graph TD', 80),
        dataFlowDiagram: makeLongMermaid('sequenceDiagram', 80),
        moduleDependenciesDiagram: makeLongMermaid('graph LR', 80),
        stateManagementDiagram: makeLongMermaid('stateDiagram-v2', 80),
        apiContractDiagram: makeLongMermaid('sequenceDiagram', 80),
        constitutionCheck: makeLongString('gate', 50),
        projectStructureTree: makeLongMermaid('text', 80),
        complexityTracking: Array.from({ length: 30 }, (_, i) => ({
          violation: `Violation ${i}`,
          whyNeeded: `Why ${i}`,
          simplerAlternativeRejected: `Simpler ${i}`,
        })),
      })),
      domains: minimalPlanFixture.domains.map((domain) => ({
        ...domain,
        responsibilities: makeLongString('responsibility', 30),
        aggregates: Array.from({ length: 10 }, (_, i) => ({
          id: `agg-${i}`,
          name: `Agg ${i}`,
          rootEntity: `Root ${i}`,
          description: `Desc ${i}`,
          invariants: makeLongString('invariant', 20),
          valueObjects: makeLongString('vo', 20),
          commands: makeLongString('cmd', 20),
          domainEvents: makeLongString('evt', 20),
        })),
        domainEvents: Array.from({ length: 10 }, (_, i) => ({
          id: `evt-${i}`,
          name: `Event ${i}`,
          description: `Desc ${i}`,
          payload: makeLongString('payload', 20),
          triggeredBy: `Trigger ${i}`,
          handledBy: makeLongString('handler', 20),
        })),
        components: Array.from({ length: 10 }, (_, i) => ({
          id: `comp-${i}`,
          name: `Comp ${i}`,
          description: `Desc ${i}`,
          type: 'service',
          layer: 'application',
          responsibilities: makeLongString('responsibility', 20),
          inputs: makeLongString('input', 20),
          outputs: makeLongString('output', 20),
          dependencies: makeLongString('dep', 20),
          publicApi: makeLongString('api', 20),
          errorHandling: 'throws DomainError',
          acceptanceCriteria: makeLongString('ac', 20),
          outOfScope: makeLongString('oos', 20),
          targetFile: `src/comp-${i}.ts`,
          tddSpec: {
            unitTests: Array.from({ length: 10 }, (_, j) => ({
              description: `Unit ${j}`,
              given: makeLongString('given', 10),
              when: 'when',
              then: makeLongString('then', 10),
            })),
            integrationTests: Array.from({ length: 10 }, (_, j) => ({
              description: `Int ${j}`,
              given: makeLongString('given', 10),
              when: 'when',
              then: makeLongString('then', 10),
            })),
          },
        })),
      })),
    };

    it('oversized arrays are truncated to the documented cap', () => {
      const result = service.validate(oversizedPlan);
      expect(result.success).toBe(true);
      if (!result.success) {
        return;
      }
      const layer = result.plan.architectureLayers[0];
      expect(layer.techStack.length).toBeLessThanOrEqual(8);
      expect(layer.patterns.length).toBeLessThanOrEqual(6);
      expect(layer.directoryStructure.length).toBeLessThanOrEqual(4);
      expect(layer.directoryStructure[0].agentInstructions.length).toBeLessThanOrEqual(6);
      expect(layer.constitutionCheck?.length).toBeLessThanOrEqual(8);
      expect(layer.complexityTracking?.length).toBeLessThanOrEqual(8);

      const domain = result.plan.domains[0];
      expect(domain.responsibilities.length).toBeLessThanOrEqual(6);
      expect(domain.aggregates.length).toBeLessThanOrEqual(3);
      expect(domain.domainEvents.length).toBeLessThanOrEqual(4);
      expect(domain.components.length).toBeLessThanOrEqual(4);

      const component = domain.components[0];
      expect(component.responsibilities.length).toBeLessThanOrEqual(4);
      expect(component.inputs.length).toBeLessThanOrEqual(6);
      expect(component.outputs.length).toBeLessThanOrEqual(6);
      expect(component.dependencies.length).toBeLessThanOrEqual(8);
      expect(component.publicApi.length).toBeLessThanOrEqual(6);
      expect(component.acceptanceCriteria.length).toBeLessThanOrEqual(5);
      expect(component.outOfScope.length).toBeLessThanOrEqual(4);
      expect(component.tddSpec.unitTests.length).toBeLessThanOrEqual(3);
      expect(component.tddSpec.integrationTests.length).toBeLessThanOrEqual(2);
      expect(component.tddSpec.unitTests[0].given.length).toBeLessThanOrEqual(3);
      expect(component.tddSpec.unitTests[0].then.length).toBeLessThanOrEqual(3);

      const aggregate = domain.aggregates[0];
      expect(aggregate.invariants.length).toBeLessThanOrEqual(4);
      expect(aggregate.valueObjects.length).toBeLessThanOrEqual(4);
      expect(aggregate.commands.length).toBeLessThanOrEqual(6);
      expect(aggregate.domainEvents.length).toBeLessThanOrEqual(6);

      const event = domain.domainEvents[0];
      expect(event.payload.length).toBeLessThanOrEqual(6);
      expect(event.handledBy.length).toBeLessThanOrEqual(4);
    });

    it('oversized Mermaid strings are truncated to the documented line cap', () => {
      const result = service.validate(oversizedPlan);
      expect(result.success).toBe(true);
      if (!result.success) {
        return;
      }
      const layer = result.plan.architectureLayers[0];
      const lineCounts = {
        mermaidDiagram: layer.mermaidDiagram.split('\n').length,
        componentTreeDiagram: layer.componentTreeDiagram?.split('\n').length ?? 0,
        dataFlowDiagram: layer.dataFlowDiagram?.split('\n').length ?? 0,
        moduleDependenciesDiagram: layer.moduleDependenciesDiagram?.split('\n').length ?? 0,
        stateManagementDiagram: layer.stateManagementDiagram?.split('\n').length ?? 0,
        apiContractDiagram: layer.apiContractDiagram?.split('\n').length ?? 0,
        projectStructureTree: layer.projectStructureTree?.split('\n').length ?? 0,
      };
      expect(lineCounts.mermaidDiagram).toBeLessThanOrEqual(15);
      expect(lineCounts.componentTreeDiagram).toBeLessThanOrEqual(15);
      expect(lineCounts.dataFlowDiagram).toBeLessThanOrEqual(15);
      expect(lineCounts.moduleDependenciesDiagram).toBeLessThanOrEqual(15);
      expect(lineCounts.stateManagementDiagram).toBeLessThanOrEqual(15);
      expect(lineCounts.apiContractDiagram).toBeLessThanOrEqual(15);
      expect(lineCounts.projectStructureTree).toBeLessThanOrEqual(30);
    });

    it('truncation shrinks a 9.5 MB-style oversized plan well below the 5 MB localStorage budget', () => {
      const result = service.validate(oversizedPlan);
      expect(result.success).toBe(true);
      if (!result.success) {
        return;
      }
      const bytes = JSON.stringify(result.plan).length;





      expect(bytes).toBeLessThan(1_500_000);
    });

    it('min(1) constraints still hold after truncation (no empty arrays produced)', () => {

      const result = service.validate({
        ...minimalPlanFixture,
        architectureLayers: minimalPlanFixture.architectureLayers.map((layer) => ({
          ...layer,
          responsibilities: makeLongString('r', 1),
          techStack: makeLongString('t', 1),
        })),
      });
      expect(result.success).toBe(true);
    });

    it('optional fields can be omitted without triggering truncation', () => {
      const result = service.validate({
        ...minimalPlanFixture,
        architectureLayers: minimalPlanFixture.architectureLayers.map((layer) => ({
          ...layer,
          componentTreeDiagram: undefined,
          dataFlowDiagram: undefined,
          moduleDependenciesDiagram: undefined,
          stateManagementDiagram: undefined,
          apiContractDiagram: undefined,
          constitutionCheck: undefined,
          projectStructureTree: undefined,
          complexityTracking: undefined,
        })),
      });
      expect(result.success).toBe(true);
    });
  });

  describe('mergeRegeneratedSectioned', () => {
    it('replaces matching layers in-place', () => {
      const base = minimalPlanFixture;
      const newLayer = {
        ...base.architectureLayers[0],
        name: 'Frontend regenerated',
        description: 'Regenerated description',
      };
      const result = service.mergeRegeneratedSectioned(base, {
        architectureLayers: [newLayer],
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        const replaced = result.plan.architectureLayers.find((l) => l.id === base.architectureLayers[0].id);
        expect(replaced?.name).toBe('Frontend regenerated');
      }
    });

    it('preserves the base plan when partial arrays are empty', () => {
      const result = service.mergeRegeneratedSectioned(minimalPlanFixture, {});
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.plan.architectureLayers).toEqual(minimalPlanFixture.architectureLayers);
      }
    });

    it('replaces tail arrays wholesale when provided', () => {
      const base = minimalPlanFixture;
      const newWorkflow = {
        id: 'workflow-x',
        name: 'Workflow X',
        description: 'New workflow',
        steps: ['a', 'b'],
        domainIds: [base.domains[0].id],
      };
      const result = service.mergeRegeneratedSectioned(base, {
        workflows: [newWorkflow],
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.plan.workflows).toHaveLength(1);
        expect(result.plan.workflows[0].id).toBe('workflow-x');
      }
    });

    it('normalizes non-array workflow steps and domainIds from the LLM (string→empty array)', () => {
      const base = minimalPlanFixture;
      const malformedWorkflow = {
        id: 'workflow-x',
        name: 'Workflow X',
        description: 'New workflow',
        steps: 'not-an-array',
        domainIds: { not: 'an array' },
      };
      const result = service.mergeRegeneratedSectioned(base, {
        workflows: [malformedWorkflow],
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.plan.workflows[0].steps).toEqual([]);
        expect(result.plan.workflows[0].domainIds).toEqual([]);
      }
    });

    it('normalizes non-array ADR consequences (string→empty array)', () => {
      const base = minimalPlanFixture;
      const malformedAdr = {
        id: 'adr-x',
        title: 'ADR X',
        status: 'proposed',
        context: 'ctx',
        decision: 'dec',
        consequences: 'oops',
      };
      const result = service.mergeRegeneratedSectioned(base, {
        adrs: [malformedAdr],
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.plan.adrs[0].consequences).toEqual([]);
      }
    });
  });

  describe('reconcileStructuralChanges', () => {
    it('re-injects a user-added element that the LLM dropped', () => {
      const base = minimalPlanFixture;
      const addedDomain = {
        id: 'payments',
        name: 'Payments',
        description: 'Payments domain',
        layer: base.domains[0].layer,
        responsibilities: ['Process payments'],
        aggregates: [],
        domainEvents: [],
        directoryPath: 'backend/payments/',
        components: [
          {
            id: 'payments-service',
            name: 'Payments Service',
            description: 'Service',
            type: 'service' as const,
            layer: 'application' as const,
            responsibilities: ['Process payments'],
            inputs: ['charge: ChargeRequest'],
            outputs: ['receipt: Receipt'],
            dependencies: [],
            publicApi: ['charge(req: ChargeRequest): Promise<Receipt>'],
            errorHandling: 'throws DomainError',
            acceptanceCriteria: ['charges a card'],
            tddSpec: {
              unitTests: [
                { description: 'charges a card', given: ['a valid card'], when: 'charge() is called', then: ['returns a receipt'] },
                { description: 'rejects an invalid card', given: ['an invalid card'], when: 'charge() is called', then: ['throws an error'] },
              ],
              integrationTests: [
                { description: 'end-to-end', given: ['a valid card'], when: 'charge() is called', then: ['returns a receipt'] },
              ],
            },
            targetFile: 'backend/payments/payments.service.ts',
            outOfScope: ['frontend integration'],
          },
        ],
      };
      const droppedByLLM: typeof base = {
        ...base,
        domains: base.domains.filter((d) => d.id !== 'payments'),
      };
      const summary: UserEditSummary = {
        capturedAt: new Date().toISOString(),
        preservedFilePaths: [],
        addedElements: [
          { kind: 'domain', id: 'payments', name: 'Payments', element: addedDomain },
        ],
        removedElements: [],
        fieldChanges: [],
        naturalLanguageDigest: 'test',
      };
      const result = service.reconcileStructuralChanges(droppedByLLM, summary);
      expect(result.adjustments).toBeGreaterThan(0);
      expect(result.plan.domains.find((d) => d.id === 'payments')).toBeDefined();
    });

    it('drops a user-removed element that the LLM re-added', () => {
      const base = minimalPlanFixture;
      const removedId = base.domains[0].id;
      const reAddedByLLM: typeof base = {
        ...base,
        domains: [...base.domains],
      };
      const summary: UserEditSummary = {
        capturedAt: new Date().toISOString(),
        preservedFilePaths: [],
        addedElements: [],
        removedElements: [{ kind: 'domain', id: removedId, name: 'removed' }],
        fieldChanges: [],
        naturalLanguageDigest: 'test',
      };
      const result = service.reconcileStructuralChanges(reAddedByLLM, summary);
      expect(result.adjustments).toBeGreaterThan(0);
      expect(result.plan.domains.find((d) => d.id === removedId)).toBeUndefined();
    });

    it('increments adjustments by the exact number of re-injections and removals', () => {
      const base = minimalPlanFixture;
      const addedDomain = {
        id: 'payments',
        name: 'Payments',
        description: 'Payments domain',
        layer: base.domains[0].layer,
        responsibilities: ['Process payments'],
        aggregates: [],
        domainEvents: [],
        directoryPath: 'backend/payments/',
        components: [],
      };
      const removedId = base.domains[1]?.id ?? base.domains[0].id;
      const droppedByLLM: typeof base = {
        ...base,
        domains: base.domains.filter((d) => d.id !== 'payments'),
      };
      const reAddedByLLM: typeof base = {
        ...droppedByLLM,
        domains: [droppedByLLM.domains[0], { ...base.domains.find((d) => d.id === removedId)! }],
      };
      const summary: UserEditSummary = {
        capturedAt: new Date().toISOString(),
        preservedFilePaths: [],
        addedElements: [
          { kind: 'domain', id: 'payments', name: 'Payments', element: addedDomain },
        ],
        removedElements: [{ kind: 'domain', id: removedId, name: 'rm' }],
        fieldChanges: [],
        naturalLanguageDigest: 'test',
      };
      const result = service.reconcileStructuralChanges(reAddedByLLM, summary);
      expect(result.adjustments).toBe(2);
    });
  });

  describe('replacePlanField array-element-field validation', () => {
    it('rejects a replacement that turns domainIds into an object', () => {
      const original = minimalPlanFixture.workflows[0].domainIds;
      const result = service.replacePlanField(
        minimalPlanFixture,
        'workflows[generate-flow].domainIds',
        { '0': 'core-domain', '1': 'content' },
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('invalid_replacement');
      }
      expect(minimalPlanFixture.workflows[0].domainIds).toEqual(original);
    });

    it('accepts a replacement that keeps domainIds as an array', () => {
      const result = service.replacePlanField(
        minimalPlanFixture,
        'workflows[generate-flow].domainIds',
        ['core-domain', 'content'],
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        const updated = result.plan.workflows.find((w) => w.id === 'generate-flow');
        expect(updated?.domainIds).toEqual(['core-domain', 'content']);
      }
    });

    it('rejects an empty context on an ADR (z.string().min(1))', () => {
      const original = minimalPlanFixture.adrs[0];
      const result = service.replacePlanField(
        minimalPlanFixture,
        'adrs[adr-001].context',
        '',
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('invalid_replacement');
      }
      expect(minimalPlanFixture.adrs[0]).toEqual(original);
    });
  });

  describe('mergeRegeneratedSectioned bounded-context handling', () => {
    it('appends a new bounded context while preserving the existing one', () => {
      const newBc = {
        id: 'admin-frontend',
        name: 'Admin Frontend',
        description: 'A separate admin UI bounded context.',
        layer: 'frontend',
        ubiquitousLanguage: { Admin: 'Operator-facing user.' },
      };
      const result = service.mergeRegeneratedSectioned(minimalPlanFixture, {
        boundedContexts: [...minimalPlanFixture.boundedContexts, newBc],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const ids = result.plan.boundedContexts.map((bc) => bc.id);
        expect(ids).toEqual(['planning', 'admin-frontend']);
      }
    });

    it('preserves base bounded contexts that the regenerated array omits', () => {
      const dropped = minimalPlanFixture.boundedContexts.filter((bc) => bc.id !== 'planning');
      const result = service.mergeRegeneratedSectioned(minimalPlanFixture, {
        boundedContexts: dropped,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const ids = result.plan.boundedContexts.map((bc) => bc.id);
        expect(ids).toEqual(['planning']);
      }
      expect(minimalPlanFixture.boundedContexts.map((bc) => bc.id)).toEqual(['planning']);
    });

    it('skips invalid entries without aborting the merge', () => {
      const newBc = {
        id: 'admin-frontend',
        name: 'Admin Frontend',
        description: 'A separate admin UI bounded context.',
        layer: 'frontend',
        ubiquitousLanguage: { Admin: 'Operator-facing user.' },
      };
      const invalid = { id: 'broken', name: 'Broken', description: 'x', layer: 'frontend', ubiquitousLanguage: {} };
      const result = service.mergeRegeneratedSectioned(minimalPlanFixture, {
        boundedContexts: [invalid, ...minimalPlanFixture.boundedContexts, newBc],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const ids = result.plan.boundedContexts.map((bc) => bc.id);
        expect(ids).toEqual(['planning', 'admin-frontend']);
        expect(ids).not.toContain('broken');
      }
    });

    it('allows dropping bounded contexts that the user marked as removed', () => {
      const replacementBc = {
        id: 'replacement-bc',
        name: 'Replacement Bounded Context',
        description: 'Replaces the removed planning context.',
        layer: 'backend',
        ubiquitousLanguage: { Replacement: 'A new bounded context.' },
      };
      const result = service.mergeRegeneratedSectioned(
        minimalPlanFixture,
        { boundedContexts: [replacementBc] },
        { removedBoundedContextIds: new Set(['planning']) },
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        const ids = result.plan.boundedContexts.map((bc) => bc.id);
        expect(ids).toEqual(['replacement-bc']);
        expect(ids).not.toContain('planning');
      }
    });

    it('preserves base bounded contexts even when the regenerated array is empty', () => {
      const result = service.mergeRegeneratedSectioned(
        minimalPlanFixture,
        { boundedContexts: [] },
        { removedBoundedContextIds: new Set(['some-other-id']) },
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        const ids = result.plan.boundedContexts.map((bc) => bc.id);
        expect(ids).toEqual(['planning']);
      }
    });
  });

  describe('validateBoundedContexts', () => {
    it('accepts a single bounded context object', () => {
      const result = service.validateBoundedContexts(minimalPlanFixture.boundedContexts[0]);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].id).toBe('planning');
      }
    });

    it('accepts an array of bounded contexts', () => {
      const result = service.validateBoundedContexts(minimalPlanFixture.boundedContexts);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.map((bc) => bc.id)).toEqual(['planning']);
      }
    });

    it('rejects when ubiquitousLanguage is empty', () => {
      const result = service.validateBoundedContexts({
        id: 'broken',
        name: 'Broken',
        description: 'x',
        layer: 'frontend',
        ubiquitousLanguage: {},
      });
      expect(result.success).toBe(false);
    });
  });

  describe('tryInjectElement for boundedContext', () => {
    it('appends a new bounded context via reconcileStructuralChanges', () => {
      const newBc = {
        id: 'admin-frontend',
        name: 'Admin Frontend',
        description: 'A separate admin UI bounded context.',
        layer: 'frontend',
        ubiquitousLanguage: { Admin: 'Operator-facing user.' },
      };
      const summary: UserEditSummary = {
        capturedAt: new Date().toISOString(),
        preservedFilePaths: [],
        addedElements: [{ kind: 'boundedContext', id: newBc.id, name: newBc.name, element: newBc }],
        removedElements: [],
        fieldChanges: [],
        naturalLanguageDigest: 'test',
      };
      const result = service.reconcileStructuralChanges(minimalPlanFixture, summary);
      expect(result.adjustments).toBe(1);
      expect(result.plan.boundedContexts.map((bc) => bc.id)).toEqual(['planning', 'admin-frontend']);
    });
  });

  describe('mermaid label sanitisation', () => {
    const scaffoldFixture = {
      meta: minimalPlanFixture.meta,
      systemOverview: {
        ...minimalPlanFixture.systemOverview,
        boundedContextMap:
          minimalPlanFixture.systemOverview.boundedContextMap ?? 'graph LR\nA-->B',
      },
      boundedContexts: minimalPlanFixture.boundedContexts,
      architectureLayerIds: ['frontend', 'backend'] as ('frontend' | 'backend')[],
      domainIds: minimalPlanFixture.domains.map((d) => d.id),
      includeTail: true,
    };

    it('quotes parens in a c4.contextDiagram during mergeScaffold', () => {
      const dirtyScaffold = {
        ...scaffoldFixture,
        systemOverview: {
          ...scaffoldFixture.systemOverview,
          c4: {
            contextDiagram: 'graph TD\nViewer[3D Viewer (Three.js)] --> Render',
            containerDiagram: 'graph TD\nA --> B',
          },
        },
      };
      const result = service.mergeScaffold({
        scaffold: dirtyScaffold,
        layers: minimalPlanFixture.architectureLayers,
        domains: minimalPlanFixture.domains,
        tail: { workflows: [], adrs: [], agentTasks: [] },
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.value.systemOverview.c4.contextDiagram).toBe(
        'graph TD\nViewer["3D Viewer (Three.js)"] --> Render',
      );
      expect(result.sanitisedCount).toBe(1);
    });

    it('mergeRegeneratedSectioned preserves an already-sanitised systemOverview', () => {
      const result = service.mergeRegeneratedSectioned(minimalPlanFixture, {});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.plan.systemOverview).toEqual(minimalPlanFixture.systemOverview);
      expect(result.sanitisedCount).toBe(0);
    });

    it('replacePlanField sanitises systemOverview.boundedContextMap and reports the count', () => {
      const result = service.replacePlanField(
        minimalPlanFixture,
        'systemOverview.boundedContextMap',
        'graph LR\nA[Foo (Bar)] --> B',
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.plan.systemOverview.boundedContextMap).toBe(
        'graph LR\nA["Foo (Bar)"] --> B',
      );
      expect(result.sanitisedCount).toBe(1);
    });

    it('replacePlanField does not increment sanitisedCount when the diagram is already safe', () => {
      const result = service.replacePlanField(
        minimalPlanFixture,
        'systemOverview.c4.contextDiagram',
        'graph TD\nA[Safe] --> B',
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.sanitisedCount).toBe(0);
    });

    it('replacePlanField sanitises systemOverview.c4.containerDiagram and reports the count', () => {
      const result = service.replacePlanField(
        minimalPlanFixture,
        'systemOverview.c4.containerDiagram',
        'graph TD\nAPI[/api/v1 (HTTP)/] --> DB',
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.plan.systemOverview.c4.containerDiagram).toBe(
        'graph TD\nAPI[/"api/v1 (HTTP)"/] --> DB',
      );
      expect(result.sanitisedCount).toBe(1);
    });

    it('Zod transform sanitises layer mermaidDiagram fields on validate', () => {
      const dirtyLayer = {
        ...minimalPlanFixture.architectureLayers[0],
        mermaidDiagram: 'graph TD\nViewer[3D Viewer (Three.js)]',
      };
      const dirtyPlan = {
        ...minimalPlanFixture,
        architectureLayers: [dirtyLayer, minimalPlanFixture.architectureLayers[1]],
      };
      const result = service.validate(dirtyPlan);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.plan.architectureLayers[0].mermaidDiagram).toBe(
        'graph TD\nViewer["3D Viewer (Three.js)"]',
      );
    });
  });

  describe('mergeRegeneratedSectioned additions normalisation', () => {
    it('drops an addition whose aggregate is missing id and cannot be derived', () => {
      const newDomain = {
        id: 'shipping',
        name: 'Shipping',
        description: 'Shipping domain for fulfillment.',
        layer: 'backend',
        responsibilities: ['Dispatch orders'],
        aggregates: [
          {
            // id omitted AND name missing — deriveId fallback used
            invariants: ['OrderId must be set'],
            valueObjects: ['TrackingNumber'],
            commands: ['CreateShipment'],
            domainEvents: ['ShipmentCreated'],
          },
        ],
        domainEvents: [],
        directoryPath: 'src/app/shipping/',
        components: minimalPlanFixture.domains[0]!.components,
      };
      const result = service.mergeRegeneratedSectioned(minimalPlanFixture, {
        additionalDomains: [newDomain],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const ids = result.plan.domains.map((d) => d.id);
        expect(ids).not.toContain('shipping');
      }
    });

    it('drops additions that still fail validation after normalisation', () => {
      const newDomain = {
        id: 'broken',
        name: 'Broken',
        // layer missing — cannot be normalised
        description: 'Broken domain.',
        responsibilities: [],
        // components missing — required (no default)
      };
      const result = service.mergeRegeneratedSectioned(minimalPlanFixture, {
        additionalDomains: [newDomain],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const ids = result.plan.domains.map((d) => d.id);
        expect(ids).not.toContain('broken');
      }
    });
  });
});
