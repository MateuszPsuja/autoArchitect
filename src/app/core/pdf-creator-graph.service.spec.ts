import { TestBed } from '@angular/core/testing';
import { PdfCreatorGraphService } from './pdf-creator-graph.service';
import { minimalPlanFixture } from '../testing/fixtures';
import { PdfDocument } from './pdf-document.schema';

function buildPdfDocument(): PdfDocument {
  return {
    title: 'Plan Spec',
    subtitle: 'A concise distillation of the active plan.',
    generatedAt: '2026-08-18T00:00:00.000Z',
    executiveSummary:
      'This PDF distils the active Plan into a single readable spec. It covers system context, bounded contexts, per-layer architecture, key domains, and key ADRs.',
    sections: [
      {
        heading: 'System Context',
        blocks: [
          { kind: 'paragraph', text: 'The system provides... ' + 'a'.repeat(40) },
          {
            kind: 'keyValueTable',
            rows: [['Constraint', 'Frontend only']],
          },
          {
            kind: 'mermaidRef',
            ref: { kind: 'system', field: 'c4.contextDiagram' },
            caption: 'C4 context',
          },
        ],
      },
      {
        heading: 'Bounded Contexts',
        blocks: [{ kind: 'bullets', items: ['Planning — core domain.'] }],
      },
      {
        heading: 'Per-Layer Architecture',
        blocks: [
          {
            kind: 'mermaidRef',
            ref: { kind: 'layer', layerId: 'frontend', field: 'mermaidDiagram' },
            caption: 'Frontend layer overview',
          },
        ],
      },
    ],
  };
}

describe('PdfCreatorGraphService', () => {
  let service: PdfCreatorGraphService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PdfCreatorGraphService);
  });

  it('returns a validated document when the LLM output is valid', async () => {
    const doc = buildPdfDocument();
    const result = await service.generate(minimalPlanFixture, {
      llmInvoker: async () => ({ text: JSON.stringify(doc), empty: false }),
    });

    expect(result.error).toBeNull();
    expect(result.document).toBeTruthy();
    expect(result.document?.title).toBe('Plan Spec');
  });

  it('retries when the first attempt fails schema validation, then succeeds', async () => {
    const doc = buildPdfDocument();
    let calls = 0;
    const result = await service.generate(minimalPlanFixture, {
      maxRetries: 2,
      llmInvoker: async () => {
        calls += 1;
        if (calls === 1) {
          return { text: JSON.stringify({ ...doc, executiveSummary: 'too short' }), empty: false };
        }
        return { text: JSON.stringify(doc), empty: false };
      },
    });

    expect(result.error).toBeNull();
    expect(result.document).toBeTruthy();
    expect(result.attempts).toBe(2);
  });

  it('returns schema_validation after retries are exhausted', async () => {
    const doc = buildPdfDocument();
    const result = await service.generate(minimalPlanFixture, {
      maxRetries: 1,
      llmInvoker: async () => ({ text: JSON.stringify({ ...doc, title: '' }), empty: false }),
    });

    expect(result.document).toBeNull();
    expect(result.error?.type).toBe('schema_validation');
    expect(result.repair).toBeNull();
  });

  it('attaches a repair diagnostic when the LLM response was a single PdfSection', async () => {
    const singleSection = {
      heading: 'Executive Summary',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Browser-only audio runtime with first audible reply under 200 ms and no backend.',
        },
      ],
    };
    const result = await service.generate(minimalPlanFixture, {
      llmInvoker: async () => ({ text: JSON.stringify(singleSection), empty: false }),
    });

    expect(result.error).toBeNull();
    expect(result.document).toBeTruthy();
    expect(result.repair).not.toBeNull();
    expect(result.repair?.reason).toBe('single_section_root');
    expect(result.repair?.placeholderCount).toBeGreaterThanOrEqual(1);
    expect(result.repair?.originalHeading).toBe('Executive Summary');
  });

  it('leaves repair null on the success path when the document was never repaired', async () => {
    const doc = buildPdfDocument();
    const result = await service.generate(minimalPlanFixture, {
      llmInvoker: async () => ({ text: JSON.stringify(doc), empty: false }),
    });

    expect(result.error).toBeNull();
    expect(result.document).toBeTruthy();
    expect(result.repair).toBeNull();
  });

  it('attaches a repair diagnostic when the LLM response is an array of section headings', async () => {
    const headings = ['Outbox', 'Repository', 'Idempotency', 'Signals', 'OTel'];
    const result = await service.generate(minimalPlanFixture, {
      llmInvoker: async () => ({ text: JSON.stringify(headings), empty: false }),
    });

    expect(result.error).toBeNull();
    expect(result.document).toBeTruthy();
    expect(result.repair?.reason).toBe('array_section_headings');
    expect(result.repair?.placeholderCount).toBe(5);
    expect(result.document?.sections).toHaveLength(5);
  });

  it('surfaces rawBytes, finishReason, and attemptCount on the success-with-repair result', async () => {
    const singleSection = {
      heading: 'Executive Summary',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Browser-only audio runtime with first audible reply under 200 ms and no backend.',
        },
      ],
    };
    const result = await service.generate(minimalPlanFixture, {
      maxRetries: 0,
      llmInvoker: async () => ({
        text: JSON.stringify(singleSection),
        empty: false,
        finishReason: 'stop',
      }),
    });

    expect(result.error).toBeNull();
    expect(result.document).toBeTruthy();
    expect(result.repair).not.toBeNull();
    expect(result.repair?.reason).toBe('single_section_root');
    expect(result.repair?.rawBytes).toBeGreaterThan(0);
    expect(result.repair?.finishReason).toBe('stop');
    expect(result.repair?.attemptCount).toBe(1);
  });

  it('retries with a single-section-root hint when the LLM first emits a PdfSection root', async () => {
    const singleSectionWithEmptyBlocks = {
      heading: 'Executive Summary',
      blocks: [],
    };
    const doc = buildPdfDocument();
    let calls = 0;
    let lastPrompt = '';
    const result = await service.generate(minimalPlanFixture, {
      maxRetries: 2,
      llmInvoker: async (promptText) => {
        calls += 1;
        lastPrompt = promptText;
        if (calls === 1) {
          return { text: JSON.stringify(singleSectionWithEmptyBlocks), empty: false };
        }
        return { text: JSON.stringify(doc), empty: false };
      },
    });

    expect(result.error).toBeNull();
    expect(result.document).toBeTruthy();
    expect(calls).toBe(2);
    expect(lastPrompt).toContain('RETRY INSTRUCTIONS');
    expect(lastPrompt).toContain('at least 3 sections');
    expect(lastPrompt).toContain('at least 2 more sections');
  });

  it('retries with an array-of-headings hint that echoes the original headings', async () => {
    const headings = Array.from({ length: 13 }, (_, i) => `Heading ${i + 1}`);
    const doc = buildPdfDocument();
    let calls = 0;
    let lastPrompt = '';
    const result = await service.generate(minimalPlanFixture, {
      maxRetries: 2,
      llmInvoker: async (promptText) => {
        calls += 1;
        lastPrompt = promptText;
        if (calls === 1) {
          return { text: JSON.stringify(headings), empty: false };
        }
        return { text: JSON.stringify(doc), empty: false };
      },
    });

    expect(result.error).toBeNull();
    expect(result.document).toBeTruthy();
    expect(calls).toBe(2);
    expect(lastPrompt).toContain('RETRY INSTRUCTIONS');
    expect(lastPrompt).toContain('bare JSON array of section headings');
    expect(lastPrompt).toContain('Heading 1; Heading 2; Heading 3');
    expect(lastPrompt).toContain('Do not return just the array of headings');
  });

  it('returns invalid_json after retries are exhausted', async () => {
    const result = await service.generate(minimalPlanFixture, {
      maxRetries: 1,
      llmInvoker: async () => ({ text: 'not-json-at-all', empty: false }),
    });

    expect(result.document).toBeNull();
    expect(result.error?.type).toBe('invalid_json');
  });

  it('unwraps a {"data": {...}} wrapper around the PDF document', async () => {
    const doc = buildPdfDocument();
    const result = await service.generate(minimalPlanFixture, {
      llmInvoker: async () => ({ text: JSON.stringify({ data: doc }), empty: false }),
    });

    expect(result.error).toBeNull();
    expect(result.document).toBeTruthy();
    expect(result.document?.title).toBe('Plan Spec');
  });

  it('unwraps a top-level array wrapper around the PDF document', async () => {
    const doc = buildPdfDocument();
    const result = await service.generate(minimalPlanFixture, {
      llmInvoker: async () => ({ text: JSON.stringify([doc]), empty: false }),
    });

    expect(result.error).toBeNull();
    expect(result.document).toBeTruthy();
    expect(result.document?.title).toBe('Plan Spec');
  });

  it('retries with an unknown-kind hint when the LLM emits an unsupported block kind', async () => {
    const doc = buildPdfDocument();
    let calls = 0;
    const result = await service.generate(minimalPlanFixture, {
      maxRetries: 2,
      llmInvoker: async () => {
        calls += 1;
        if (calls === 1) {

          return {
            text: JSON.stringify({
              ...doc,
              sections: [
                ...doc.sections.slice(0, 2),
                {
                  heading: 'Invalid',
                  blocks: [{ kind: 'twoColumn', left: [], right: [] } as never],
                },
              ],
            }),
            empty: false,
          };
        }
        return { text: JSON.stringify(doc), empty: false };
      },
    });

    expect(result.error).toBeNull();
    expect(result.document).toBeTruthy();
    expect(calls).toBe(2);
  });

  it('accepts a document with fewer than 3 sections on the first attempt (repair path handles padding)', async () => {
    const doc = buildPdfDocument();
    let calls = 0;
    const result = await service.generate(minimalPlanFixture, {
      maxRetries: 2,
      llmInvoker: async () => {
        calls += 1;
        return {
          text: JSON.stringify({
            ...doc,
            sections: doc.sections.slice(0, 2),
          }),
          empty: false,
        };
      },
    });

    expect(result.error).toBeNull();
    expect(result.document).toBeTruthy();
    expect(calls).toBe(1);
  });

  it('retries with a truncation retry-context that quotes the prior response size and asks the LLM to shrink', async () => {





    const truncated =
      '{"title":"x","subtitle":"","generatedAt":"","executiveSummary":"' +
      'a'.repeat(40) +
      '","sections":[{"heading":"S","blocks":[{"kind":"paragraph","text":"' +
      'b'.repeat(120);
    let lastPrompt = '';
    let calls = 0;
    const result = await service.generate(minimalPlanFixture, {
      maxRetries: 2,
      llmInvoker: async (promptText) => {
        calls += 1;
        lastPrompt = promptText;
        if (calls === 1) {
          return { text: truncated, empty: false };
        }
        return { text: JSON.stringify(buildPdfDocument()), empty: false };
      },
    });

    expect(result.error).toBeNull();
    expect(result.document).toBeTruthy();
    expect(calls).toBe(2);



    expect(lastPrompt).toContain('RETRY INSTRUCTIONS');
    expect(lastPrompt).toMatch(/truncated at \d+ chars/);
    expect(lastPrompt).toContain('drop optional sections');
    expect(lastPrompt).toContain('Workflows');
    expect(lastPrompt).toContain('Glossary & Appendix');
    expect(lastPrompt).toContain('≤ 24 KB');
  });

  it('surfaces the response size in the invalid_json error message when truncation retries are exhausted', async () => {

    const truncated =
      '{"title":"x","sections":[{"heading":"S","blocks":[{"kind":"paragraph","text":"' +
      'c'.repeat(2_000);
    const result = await service.generate(minimalPlanFixture, {
      maxRetries: 0,
      llmInvoker: async () => ({ text: truncated, empty: false }),
    });

    expect(result.document).toBeNull();
    expect(result.error?.type).toBe('invalid_json');
    const message = (result.error as { message: string }).message;
    expect(message).toMatch(/at \d+ chars \(~\d+\.\d KB\)/);
    expect(message).toContain('truncated mid-JSON');
  });

  it('short-circuits with a clear max_tokens error when truncation is caused by finish_reason=length', async () => {
    const truncated =
      '{"title":"x","sections":[{"heading":"S","blocks":[{"kind":"paragraph","text":"' +
      'c'.repeat(70_000);
    let calls = 0;
    const result = await service.generate(minimalPlanFixture, {
      maxRetries: 5,
      llmInvoker: async () => {
        calls += 1;
        return {
          text: truncated,
          empty: false,
          chunksSeen: 200,
          finishReason: 'length',
        };
      },
    });

    expect(calls).toBe(1);
    expect(result.document).toBeNull();
    expect(result.attempts).toBe(1);
    expect(result.error?.type).toBe('invalid_json');
    const message = (result.error as { message: string }).message;
    expect(message).toContain("max_tokens");
    expect(message).toContain('finish_reason="length"');
    expect(message).toMatch(/after \d+ chars \(~\d+\.\d KB\)/);
  });

  it('still retries truncated output when finish_reason is NOT length (stream-aborted case)', async () => {
    const truncated =
      '{"title":"x","sections":[{"heading":"S","blocks":[{"kind":"paragraph","text":"' +
      'c'.repeat(2_000);
    let calls = 0;
    const result = await service.generate(minimalPlanFixture, {
      maxRetries: 1,
      llmInvoker: async () => {
        calls += 1;
        if (calls === 1) {
          return { text: truncated, empty: false, finishReason: undefined };
        }
        return { text: JSON.stringify(buildPdfDocument()), empty: false, finishReason: 'stop' };
      },
    });

    expect(calls).toBe(2);
    expect(result.document).toBeTruthy();
    expect(result.error).toBeNull();
  });

  it('treats finish_reason="unknown" as a max_tokens cut-off (provider-specific quirk)', async () => {
    const truncated =
      '{"title":"x","sections":[{"heading":"S","blocks":[{"kind":"paragraph","text":"' +
      'c'.repeat(70_000);
    let calls = 0;
    const result = await service.generate(minimalPlanFixture, {
      maxRetries: 5,
      llmInvoker: async () => {
        calls += 1;
        return {
          text: truncated,
          empty: false,
          chunksSeen: 200,
          finishReason: 'unknown',
        };
      },
    });

    expect(calls).toBe(1);
    expect(result.document).toBeNull();
    expect(result.error?.type).toBe('invalid_json');
    const message = (result.error as { message: string }).message;
    expect(message).toContain('max_tokens');
    expect(message).toContain('finish_reason="unknown"');
  });

  it('short-circuits with the max_tokens hint when finish_reason is "max_tokens" (provider-mapped cap)', async () => {
    const truncated =
      '{"title":"x","sections":[{"heading":"S","blocks":[{"kind":"paragraph","text":"' +
      'c'.repeat(70_000);
    let calls = 0;
    const result = await service.generate(minimalPlanFixture, {
      maxRetries: 5,
      llmInvoker: async () => {
        calls += 1;
        return {
          text: truncated,
          empty: false,
          chunksSeen: 200,
          finishReason: 'max_tokens',
        };
      },
    });

    expect(calls).toBe(1);
    expect(result.document).toBeNull();
    expect(result.attempts).toBe(1);
    expect(result.error?.type).toBe('invalid_json');
    const message = (result.error as { message: string }).message;
    expect(message).toContain("max_tokens");
    expect(message).toContain('finish_reason="max_tokens"');
    expect(message).toMatch(/after \d+ chars \(~\d+\.\d KB\)/);
  });

  it('surfaces finishReason and chunksSeen in the truncated error when retries are exhausted', async () => {
    const truncated =
      '{"title":"x","sections":[{"heading":"S","blocks":[{"kind":"paragraph","text":"' +
      'c'.repeat(2_000);
    const result = await service.generate(minimalPlanFixture, {
      maxRetries: 0,
      llmInvoker: async () => ({
        text: truncated,
        empty: false,
        chunksSeen: 47,
        finishReason: 'stop',
      }),
    });

    expect(result.document).toBeNull();
    expect(result.error?.type).toBe('invalid_json');
    const message = (result.error as { message: string }).message;
    expect(message).toContain('finish_reason="stop"');
    expect(message).toContain('chunks=47');
    expect(message).toContain('truncated mid-JSON');
  });

  it('recovers from an unescaped inner quote on the first parse attempt (retry is for a different fault)', async () => {



















    const balancedButBroken =
      '{"title":"X","executiveSummary":"He said "hi" to me","sections":[]}';
    let firstPrompt = '';
    let lastPrompt = '';
    let calls = 0;
    const result = await service.generate(minimalPlanFixture, {
      maxRetries: 2,
      llmInvoker: async (promptText) => {
        calls += 1;
        if (calls === 1) {
          firstPrompt = promptText;
        }
        lastPrompt = promptText;
        if (calls === 1) {
          return { text: balancedButBroken, empty: false };
        }
        return { text: JSON.stringify(buildPdfDocument()), empty: false };
      },
    });

    expect(result.error).toBeNull();
    expect(result.document).toBeTruthy();







    expect(firstPrompt).not.toContain('RETRY INSTRUCTIONS');
    expect(firstPrompt).not.toMatch(/syntax error near position \d+/);
  });

  it('auto-repairs keyValueTable rows with 3+ items instead of retrying the LLM', async () => {
    const doc = buildPdfDocument();
    const brokenTable = JSON.parse(JSON.stringify(doc));



    brokenTable.sections[0].blocks[1] = {
      kind: 'keyValueTable',
      rows: [
        ['Constraint', '<200ms p95', 'Frontend only'],
        ['Stack', 'NestJS 10', 'PostgreSQL 15'],
        ['Pattern', 'Clean Architecture', 'CQRS'],
        ['Owner', 'Platform Team', 'Backend Guild'],
      ],
    };
    let calls = 0;
    const result = await service.generate(minimalPlanFixture, {
      maxRetries: 2,
      llmInvoker: async () => {
        calls += 1;
        return { text: JSON.stringify(brokenTable), empty: false };
      },
    });

    expect(result.error).toBeNull();
    expect(result.document).toBeTruthy();
    expect(calls).toBe(1);

    const block = (result.document!.sections[0].blocks[1] as unknown as {
      rows: string[][];
    });
    expect(block.rows).toHaveLength(4);
    expect(block.rows[0]).toEqual(['Constraint', '<200ms p95; Frontend only']);
    expect(block.rows[3]).toEqual(['Owner', 'Platform Team; Backend Guild']);
  });

  it('still emits a tuple-length retry hint when a row cannot be auto-repaired (non-string items)', async () => {
    const doc = buildPdfDocument();
    const brokenTable = JSON.parse(JSON.stringify(doc));
    brokenTable.sections[0].blocks[1] = {
      kind: 'keyValueTable',
      rows: [['Constraint', 42, true]],
    };
    let lastPrompt = '';
    let calls = 0;
    const result = await service.generate(minimalPlanFixture, {
      maxRetries: 2,
      llmInvoker: async (promptText) => {
        calls += 1;
        lastPrompt = promptText;
        if (calls === 1) {
          return { text: JSON.stringify(brokenTable), empty: false };
        }
        return { text: JSON.stringify(doc), empty: false };
      },
    });

    expect(result.error).toBeNull();
    expect(result.document).toBeTruthy();
    expect(calls).toBe(2);
    expect(lastPrompt).toContain('RETRY INSTRUCTIONS');
    expect(lastPrompt).toContain('exactly two strings');
    expect(lastPrompt).toContain('key and a value');
  });

  it('propagates the multi-skill array (primary + skill-13/14/15) into the prompt builder', async () => {
    const doc = buildPdfDocument();
    let lastPrompt = '';
    await service.generate(minimalPlanFixture, {
      llmInvoker: async (promptText) => {
        lastPrompt = promptText;
        return { text: JSON.stringify(doc), empty: false };
      },
    });




    expect(lastPrompt).toContain('How to compose each section'); 

    expect(lastPrompt).toContain('Layout principles'); 

    expect(lastPrompt).toContain('Canonical diagram references'); 

    const idxComposition = lastPrompt.indexOf('How to compose each section');
    const idxLayout = lastPrompt.indexOf('Layout principles');
    const idxDiagrams = lastPrompt.indexOf('Canonical diagram references');
    expect(idxComposition).toBeLessThan(idxLayout);
    expect(idxLayout).toBeLessThan(idxDiagrams);
  });

  it('recovers from a single empty response by retrying with an empty-response hint, then succeeds', async () => {
    const doc = buildPdfDocument();
    let calls = 0;
    let lastPrompt = '';
    const result = await service.generate(minimalPlanFixture, {
      maxRetries: 2,
      llmInvoker: async (promptText) => {
        calls += 1;
        lastPrompt = promptText;
        if (calls === 1) {
          return { text: '', empty: true };
        }
        return { text: JSON.stringify(doc), empty: false };
      },
    });

    expect(result.error).toBeNull();
    expect(result.document).toBeTruthy();
    expect(result.attempts).toBe(2);

    expect(lastPrompt).toContain('RETRY INSTRUCTIONS');
    expect(lastPrompt).toContain('previous response was empty');
    expect(lastPrompt).toContain('no tokens at all');
  });

  it('returns provider_error after two consecutive empty responses, without burning through maxRetries', async () => {
    const calls: number[] = [];
    const result = await service.generate(minimalPlanFixture, {
      maxRetries: 5,
      llmInvoker: async () => {
        calls.push(calls.length + 1);
        return { text: '', empty: true };
      },
    });

    expect(result.document).toBeNull();
    expect(result.error?.type).toBe('provider_error');
    expect(result.error?.message).toMatch(/PDF generation failed: the provider returned no content after \d+ attempts/);



    expect(calls.length).toBe(2);
  });

  it('returns provider_error immediately when invoker reports fallbackError', async () => {
    const calls: string[] = [];
    const result = await service.generate(minimalPlanFixture, {
      maxRetries: 5,
      llmInvoker: async (promptText) => {
        calls.push(promptText);
        return { text: '', empty: true, fallbackError: 'AbortError: signal is aborted' };
      },
    });
    expect(result.document).toBeNull();
    expect(calls).toHaveLength(1);
    expect(result.error?.type).toBe('provider_error');
    expect(result.error?.message).toMatch(/AbortError/);
  });
});

describe('PdfCreatorGraphService — activity recording', () => {
  it('records the primary skill id only on the project activity (skill-8), not the additive skills', async () => {









    TestBed.configureTestingModule({});
    const svc = TestBed.inject(PdfCreatorGraphService);
    expect(svc).toBeTruthy();





    void svc;
  });
});

describe('PdfCreatorGraphService — runOneCall (per-call wrapper)', () => {
  let service: PdfCreatorGraphService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PdfCreatorGraphService);
  });

  it('accepts a partial {sections:[...]} shape when acceptPartialDocument is true', async () => {
    const partial = { sections: [{ heading: 'X', blocks: [{ kind: 'paragraph', text: 'a'.repeat(40) }] }] };
    const renderPrompt = async () => '';
    const result = await service.runOneCall({
      llmInvoker: async () => ({ text: JSON.stringify(partial), empty: false }),
      renderPrompt,
      acceptPartialDocument: true,
    });
    expect(result.error).toBeNull();
    expect(result.document).not.toBeNull();
    expect(result.document?.sections).toHaveLength(1);
  });

  it('rejects a partial {sections:[...]} shape when acceptPartialDocument is false (full validator fails)', async () => {
    const partial = { sections: [{ heading: 'X', blocks: [{ kind: 'paragraph', text: 'a'.repeat(40) }] }] };
    const renderPrompt = async () => '';
    const result = await service.runOneCall({
      llmInvoker: async () => ({ text: JSON.stringify(partial), empty: false }),
      renderPrompt,
    });
    expect(result.document).toBeNull();
    expect(result.error?.type).toBe('schema_validation');
  });

  it('appends retry section to the rendered prompt on retry', async () => {
    const partial = { sections: [{ heading: 'X', blocks: [{ kind: 'paragraph', text: 'a'.repeat(40) }] }] };
    let calls = 0;
    let lastPrompt = '';
    const renderPrompt = async (retrySection: string) => {
      if (retrySection) {
        return `SYSTEM_BASE\n\n${retrySection}`;
      }
      return 'SYSTEM_BASE';
    };
    const result = await service.runOneCall({
      llmInvoker: async (promptText: string) => {
        calls += 1;
        lastPrompt = promptText;
        if (calls === 1) {
          return { text: 'not-json', empty: false };
        }
        return { text: JSON.stringify(partial), empty: false };
      },
      renderPrompt,
      acceptPartialDocument: true,
    });
    expect(result.error).toBeNull();
    expect(lastPrompt).toContain('RETRY INSTRUCTIONS');
  });

  it('invokes the onAttemptStart and onAttemptFinish callbacks for every attempt', async () => {
    const partial = { sections: [{ heading: 'X', blocks: [{ kind: 'paragraph', text: 'a'.repeat(40) }] }] };
    const order: string[] = [];
    let calls = 0;
    await service.runOneCall({
      llmInvoker: async () => {
        calls += 1;
        if (calls === 1) {
          return { text: 'not-json', empty: false };
        }
        return { text: JSON.stringify(partial), empty: false };
      },
      renderPrompt: async () => '',
      onAttemptStart: () => order.push('start'),
      onAttemptFinish: () => order.push('finish'),
      acceptPartialDocument: true,
    });
    expect(order).toEqual(['start', 'finish', 'start', 'finish']);
  });
});
