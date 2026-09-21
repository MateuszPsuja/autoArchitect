import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import {
  PdfCreatorService,
  PDF_PER_CALL_MAX_TOKENS_FLOOR,
  PDF_PREFLIGHT_THRESHOLD,
} from './pdf-creator.service';
import { LLM_FACTORY, LLM_PROVIDERS } from './llm-provider';
import { ProjectStore, PlannerConfigState } from './project.store';
import { PdfExportService } from './pdf-export.service';
import { PlanSchemaService } from './plan-schema.service';
import { AgentsStore } from './agents.store';
import { minimalPlanFixture } from '../testing/fixtures';
import { PdfDocument } from './pdf-document.schema';
import { PdfSectionOrchestrator } from './pdf-section-orchestrator';

function buildPdfDocument(): PdfDocument {
  return {
    title: 'Plan Spec',
    subtitle: 'A concise distillation of the active plan.',
    generatedAt: '2026-08-18T00:00:00.000Z',
    executiveSummary:
      'This PDF distils the active Plan into a single readable spec. It covers system context, bounded contexts, per-layer architecture, key domains, and key ADRs.',
    sections: [
      {
        heading: 'Executive Summary',
        blocks: [
          {
            kind: 'paragraph',
            text: 'This plan covers the core domain ' + 'a'.repeat(40),
          },
        ],
      },
      {
        heading: 'System Overview',
        blocks: [
          { kind: 'paragraph', text: 'The system provides... ' + 'b'.repeat(40) },
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
        heading: 'Architecture Layers',
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

function buildConfig(defaultMaxTokens: number): PlannerConfigState {
  return {
    provider: 'openrouter',
    providerConfigs: {
      ...Object.fromEntries(
        Object.keys(LLM_PROVIDERS).map((id) => [
          id,
          {
            selectedModel: id === 'openrouter' ? 'openrouter/test-model' : '',
            customBaseUrl: LLM_PROVIDERS[id as keyof typeof LLM_PROVIDERS].baseUrl,
            defaultTemperature: 0.2,
            defaultMaxTokens,
          },
        ]),
      ),
    } as PlannerConfigState['providerConfigs'],
    auditRepairMaxAttempts: 1,
    parallelSectionConcurrency: 6,
    plannerMaxAttempts: 75,
    requestTimeoutMs: 90_000,
  };
}

function buildChunkStream(chunks: string[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const content of chunks) {
        yield { content, response_metadata: {} };
      }
    },
  };
}

describe('PdfCreatorService — per-call maxTokens floor', () => {
  let service: PdfCreatorService;
  let llmFactoryMock: ReturnType<typeof vi.fn>;
  let buildPdfMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    llmFactoryMock = vi.fn();
    buildPdfMock = vi.fn(async () => new Blob(['pdf-bytes'], { type: 'application/pdf' }));

    TestBed.configureTestingModule({
      providers: [
        { provide: LLM_FACTORY, useValue: llmFactoryMock },
        { provide: PdfExportService, useValue: { buildPdf: buildPdfMock } },
      ],
    });
    service = TestBed.inject(PdfCreatorService);
  });

  it('floors defaultMaxTokens upward to PDF_PER_CALL_MAX_TOKENS_FLOOR (4_096) when the user has lowered it', async () => {
    const config = buildConfig(2_048);
    const store = TestBed.inject(ProjectStore);
    store.setConfig(config);
    store.setApiKey('test-key', 'openrouter');

    const json = JSON.stringify(buildPdfDocument());
    llmFactoryMock.mockImplementation(() => ({
      stream: vi.fn(async () => buildChunkStream([json])),
    }));

    await service.generate(minimalPlanFixture);

    const options = llmFactoryMock.mock.calls[0][2] as { maxTokens: number; streaming: boolean };
    expect(options.streaming).toBe(true);
    expect(options.maxTokens).toBe(PDF_PER_CALL_MAX_TOKENS_FLOOR);
  });

  it('keeps the user-selected defaultMaxTokens when it is already above the per-call floor', async () => {
    const config = buildConfig(16_384);
    const store = TestBed.inject(ProjectStore);
    store.setConfig(config);
    store.setApiKey('test-key', 'openrouter');

    const json = JSON.stringify(buildPdfDocument());
    llmFactoryMock.mockImplementation(() => ({
      stream: vi.fn(async () => buildChunkStream([json])),
    }));

    await service.generate(minimalPlanFixture);

    const options = llmFactoryMock.mock.calls[0][2] as { maxTokens: number };
    expect(options.maxTokens).toBe(16_384);
  });

  it('triggers a pre-flight warning when defaultMaxTokens is below PDF_PREFLIGHT_THRESHOLD (8_192)', async () => {
    const config = buildConfig(2_048);
    const store = TestBed.inject(ProjectStore);
    store.setConfig(config);
    store.setApiKey('test-key', 'openrouter');

    const json = JSON.stringify(buildPdfDocument());
    llmFactoryMock.mockImplementation(() => ({
      stream: vi.fn(async () => buildChunkStream([json])),
    }));

    const result = await service.generate(minimalPlanFixture);
    expect(result.preflightWarning).toMatch(new RegExp(PDF_PREFLIGHT_THRESHOLD.toLocaleString()));
  });
});

describe('PdfCreatorService — section-stitching pipeline (orchestrator delegation)', () => {
  let service: PdfCreatorService;
  let llmFactoryMock: ReturnType<typeof vi.fn>;
  let buildPdfMock: ReturnType<typeof vi.fn>;
  let orchestratorStub: {
    run: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    llmFactoryMock = vi.fn();
    buildPdfMock = vi.fn(async () => new Blob(['pdf-bytes'], { type: 'application/pdf' }));
    orchestratorStub = {
      run: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: LLM_FACTORY, useValue: llmFactoryMock },
        { provide: PdfExportService, useValue: { buildPdf: buildPdfMock } },
        { provide: PdfSectionOrchestrator, useValue: orchestratorStub },
      ],
    });
    service = TestBed.inject(PdfCreatorService);

    TestBed.inject(ProjectStore).setApiKey('test-key', 'openrouter');
    TestBed.inject(ProjectStore).setConfig(buildConfig(16_384));
  });

  it('returns ok=true and a Blob when the orchestrator produces a valid document', async () => {
    const doc = buildPdfDocument();
    orchestratorStub.run.mockResolvedValue({
      document: doc,
      error: null,
      repair: null,
      placeholders: 0,
      attempts: 4,
      callCount: 4,
      perCallPrompts: ['p1', 'p2', 'p3', 'p4'],
    });
    llmFactoryMock.mockImplementation(() => ({
      stream: vi.fn(async () => buildChunkStream(['unused'])),
    }));

    const result = await service.generate(minimalPlanFixture);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.title).toBe('Plan Spec');
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.placeholders).toBe(0);
    }
    expect(orchestratorStub.run).toHaveBeenCalledTimes(1);
    expect(buildPdfMock).toHaveBeenCalledWith(minimalPlanFixture, doc);
  });

  it('surfaces placeholders count from the orchestrator result', async () => {
    const doc = buildPdfDocument();
    orchestratorStub.run.mockResolvedValue({
      document: doc,
      error: null,
      repair: null,
      placeholders: 2,
      attempts: 6,
      callCount: 4,
      perCallPrompts: [],
    });
    llmFactoryMock.mockImplementation(() => ({
      stream: vi.fn(async () => buildChunkStream(['unused'])),
    }));

    const result = await service.generate(minimalPlanFixture);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.placeholders).toBe(2);
    }
  });

  it('returns ok=false with the orchestrator error when the orchestrator fails', async () => {
    const error = { type: 'provider_error' as const, message: 'all 4 calls failed' };
    orchestratorStub.run.mockResolvedValue({
      document: null,
      error,
      repair: null,
      placeholders: 0,
      attempts: 1,
      callCount: 1,
      perCallPrompts: [],
    });
    llmFactoryMock.mockImplementation(() => ({
      stream: vi.fn(async () => buildChunkStream(['unused'])),
    }));

    const result = await service.generate(minimalPlanFixture);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('all 4 calls failed');
    }
  });
});

describe('PdfCreatorService — wall-clock bailout (per-attempt fresh controller)', () => {
  let llmFactoryMock: ReturnType<typeof vi.fn>;
  let buildPdfMock: ReturnType<typeof vi.fn>;
  let orchestratorStub: { run: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    llmFactoryMock = vi.fn();
    buildPdfMock = vi.fn(async () => new Blob(['pdf-bytes'], { type: 'application/pdf' }));
    orchestratorStub = { run: vi.fn() };
  });

  it('allocates a fresh AbortController per attempt so the first cap does not abort later attempts', async () => {
    vi.useFakeTimers({ now: 0 });
    try {
      const captured: Array<{ signal: AbortSignal; abortedAtCapture: boolean }> = [];
      let callIndex = 0;
      const validJson = JSON.stringify(buildPdfDocument());

      llmFactoryMock.mockImplementation(() => ({
        stream: vi.fn(async (_p: string, opts: { signal?: AbortSignal }) => {
          const sig = opts.signal as AbortSignal;
          captured.push({ signal: sig, abortedAtCapture: sig.aborted });
          callIndex += 1;
          if (callIndex === 1) {
            return {
              async *[Symbol.asyncIterator]() {
                for (let i = 0; i < 5; i += 1) {
                  await Promise.resolve();
                  yield { content: 'partial ', response_metadata: {} };
                }
                vi.setSystemTime(Date.now() + 1_300_000);
                await Promise.resolve();
                yield { content: 'first-bailout', response_metadata: {} };
                await Promise.resolve();
                yield { content: ' after-cap', response_metadata: {} };
              },
            };
          }
          return buildChunkStream([validJson]);
        }),
      }));

      orchestratorStub.run.mockImplementation(
        async (
          _plan: typeof minimalPlanFixture,
          opts: { llmInvoker: (p: string) => Promise<unknown> },
        ) => {
          await opts.llmInvoker('p1');
          await opts.llmInvoker('p2');
          await opts.llmInvoker('p3');
          return {
            document: buildPdfDocument(),
            error: null,
            repair: null,
            placeholders: 0,
            attempts: 3,
            callCount: 3,
            perCallPrompts: ['p1', 'p2', 'p3'],
          };
        },
      );

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          { provide: LLM_FACTORY, useValue: llmFactoryMock },
          { provide: PdfExportService, useValue: { buildPdf: buildPdfMock } },
          { provide: PdfSectionOrchestrator, useValue: orchestratorStub },
        ],
      });
      const service = TestBed.inject(PdfCreatorService);
      TestBed.inject(ProjectStore).setApiKey('test-key', 'openrouter');
      TestBed.inject(ProjectStore).setConfig(buildConfig(16_384));

      const result = await service.generate(minimalPlanFixture);
      expect(result.ok).toBe(true);

      expect(captured).toHaveLength(3);
      for (const { abortedAtCapture } of captured) {
        expect(abortedAtCapture).toBe(false);
      }
      expect(new Set(captured.map((c) => c.signal)).size).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
