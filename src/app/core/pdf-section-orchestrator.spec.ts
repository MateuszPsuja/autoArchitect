import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { PdfSectionOrchestrator } from './pdf-section-orchestrator';
import { PdfCreatorGraphService } from './pdf-creator-graph.service';
import { PdfStitcherService } from './pdf-stitcher.service';
import { PlanSchemaService } from './plan-schema.service';
import { PromptBuilderService } from './prompt-builder.service';
import { AgentsStore } from './agents.store';
import { PdfCreatorInvokerResult, RunOneCallOptions } from './pdf-creator-graph.service';
import { PdfDocument, PdfSection } from './pdf-document.schema';
import { Plan } from './plan.schema';
import { minimalPlanFixture } from '../testing/fixtures';

beforeEach(() => {
  TestBed.resetTestingModule();
});
afterEach(() => {
  TestBed.resetTestingModule();
});

function section(heading: string, body: string): PdfSection {
  return {
    heading,
    blocks: [{ kind: 'paragraph', text: body }],
  };
}

function headerDoc(sections: readonly PdfSection[]): PdfDocument {
  return {
    title: 'Plan Spec',
    subtitle: 'sub',
    generatedAt: '2026-08-18T00:00:00.000Z',
    executiveSummary:
      'This PDF distils the active Plan into a single readable spec. It covers system context, bounded contexts, per-layer architecture, key domains, and key ADRs.',
    sections: [...sections],
  };
}

function partialDoc(sections: readonly PdfSection[]): PdfDocument {
  return headerDoc(sections);
}

function buildPlan(): Plan {
  return {
    ...minimalPlanFixture,
    workflows: [{ id: 'w1', name: 'W1', description: 'd', steps: [], domainIds: [] }],
    adrs: [{ id: 'a1', title: 'A1', status: 'accepted', context: 'c', decision: 'd', consequences: [] }],
    architectureLayers: [
      {
        id: 'frontend',
        name: 'Frontend',
        description: 'd',
        techStack: ['Angular'],
        patterns: [],
        mermaidDiagram: 'graph TD\nA-->B',
        directoryStructure: [{ path: 'frontend/src', description: 'root', agentInstructions: ['step 1'] }],
        technicalContext: {
          storage: 'browser',
          targetPlatform: 'browser',
          performanceGoals: '<200ms',
          constraints: 'none',
          scaleScope: '50k',
        },
        constitutionCheck: [],
        complexityTracking: [],
      },
    ],
  } as Plan;
}

describe('PdfSectionOrchestrator — 7-call pipeline (one section per chunk)', () => {
  let orchestrator: PdfSectionOrchestrator;
  let graphStub: { runOneCall: ReturnType<typeof vi.fn> };
  let stitcherStub: { stitchSections: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    graphStub = { runOneCall: vi.fn() };
    stitcherStub = { stitchSections: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        PdfSectionOrchestrator,
        { provide: PdfCreatorGraphService, useValue: graphStub },
        { provide: PdfStitcherService, useValue: stitcherStub },
        PlanSchemaService,
        PromptBuilderService,
        {
          provide: AgentsStore,
          useValue: {
            resolveSkill: () => null,
          },
        },
      ],
    });

    orchestrator = TestBed.inject(PdfSectionOrchestrator);

    const planSchema = TestBed.inject(PlanSchemaService);
    const stitcherSpy = vi.spyOn(planSchema, 'validatePdfDocumentWithUnwrap');
    stitcherSpy.mockImplementation((candidate) => {
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        const sections = (candidate as Record<string, unknown>)['sections'];
        if (Array.isArray(sections)) {
          return { success: true, document: candidate as PdfDocument };
        }
      }
      return { success: false, fields: ['(root)'], message: 'unmocked' };
    });

    stitcherStub.stitchSections.mockImplementation(
      (headerArg: { title: string; executiveSummary: string; sections: readonly PdfSection[]; subtitle?: string | null; generatedAt: string }, batches: ReadonlyArray<{ sections: readonly PdfSection[]; targetKinds: readonly string[]; usedFallback: boolean }>) => {
        const merged: PdfSection[] = [...headerArg.sections];
        let placeholders = 0;
        for (const b of batches) {
          if (b.usedFallback || b.sections.length === 0) {
            placeholders += b.targetKinds.length;
            continue;
          }
          merged.push(...b.sections);
        }
        return {
          document: {
            title: headerArg.title,
            subtitle: headerArg.subtitle ?? undefined,
            generatedAt: headerArg.generatedAt,
            executiveSummary: headerArg.executiveSummary,
            sections: merged,
          },
          placeholders,
        };
      },
    );
  });

  it('makes 7 LLM calls: header + 6 single-section calls with target kinds piped into each call', async () => {
    const plan = buildPlan();
    graphStub.runOneCall.mockImplementation(async (_opts: RunOneCallOptions) => {
      const calls = graphStub.runOneCall.mock.calls.length;
      if (calls === 1) {
        return { document: headerDoc([section('Executive Summary', 'es'), section('System Overview', 'so')]), error: null, attempts: 1, repair: null };
      }
      if (calls === 2) {
        return { document: partialDoc([section('Bounded Contexts', 'bc')]), error: null, attempts: 1, repair: null };
      }
      if (calls === 3) {
        return { document: partialDoc([section('Architecture Layers', 'al')]), error: null, attempts: 1, repair: null };
      }
      if (calls === 4) {
        return { document: partialDoc([section('Per-Layer Spec Kit Highlights', 'pls')]), error: null, attempts: 1, repair: null };
      }
      if (calls === 5) {
        return { document: partialDoc([section('Domain Deep Dive', 'dd')]), error: null, attempts: 1, repair: null };
      }
      if (calls === 6) {
        return { document: partialDoc([section('Key Workflows', 'kw')]), error: null, attempts: 1, repair: null };
      }
      return { document: partialDoc([section('Architecture Decisions (ADRs)', 'adrs')]), error: null, attempts: 1, repair: null };
    });

    const invoker = vi.fn(async (_p: string): Promise<PdfCreatorInvokerResult> => ({ text: '', empty: false }));
    const result = await orchestrator.run(plan, { llmInvoker: invoker });

    expect(result.document).not.toBeNull();
    expect(result.callCount).toBe(7);
    expect(graphStub.runOneCall).toHaveBeenCalledTimes(7);

    const headerOpts = graphStub.runOneCall.mock.calls[0][0] as RunOneCallOptions;
    const call2Opts = graphStub.runOneCall.mock.calls[1][0] as RunOneCallOptions;
    const call3Opts = graphStub.runOneCall.mock.calls[2][0] as RunOneCallOptions;
    const call4Opts = graphStub.runOneCall.mock.calls[3][0] as RunOneCallOptions;
    const call5Opts = graphStub.runOneCall.mock.calls[4][0] as RunOneCallOptions;
    const call6Opts = graphStub.runOneCall.mock.calls[5][0] as RunOneCallOptions;
    const call7Opts = graphStub.runOneCall.mock.calls[6][0] as RunOneCallOptions;

    expect(headerOpts.acceptPartialDocument).toBeUndefined();
    expect(call2Opts.acceptPartialDocument).toBe(true);
    expect(call3Opts.acceptPartialDocument).toBe(true);
    expect(call4Opts.acceptPartialDocument).toBe(true);
    expect(call5Opts.acceptPartialDocument).toBe(true);
    expect(call6Opts.acceptPartialDocument).toBe(true);
    expect(call7Opts.acceptPartialDocument).toBe(true);

    const headerPrompt = await headerOpts.renderPrompt('');
    expect(headerPrompt).toContain('Executive Summary');
    expect(headerPrompt).toContain('System Overview');

    const call2Prompt = await call2Opts.renderPrompt('');
    expect(call2Prompt).toContain('Bounded Contexts');
    expect(call2Prompt).toContain('Executive Summary');
    expect(call2Prompt).toContain('System Overview');
    expect(call2Prompt).toContain('Target sections for THIS call');
    expect(call2Prompt).toContain('"Bounded Contexts"');

    const call3Prompt = await call3Opts.renderPrompt('');
    expect(call3Prompt).toContain('Architecture Layers');
    expect(call3Prompt).toContain('Bounded Contexts');
    expect(call3Prompt).toContain('Target sections for THIS call');
    expect(call3Prompt).toContain('"Architecture Layers"');

    const call4Prompt = await call4Opts.renderPrompt('');
    expect(call4Prompt).toContain('Per-Layer Spec Kit Highlights');
    expect(call4Prompt).toContain('Architecture Layers');
    expect(call4Prompt).toContain('"Per-Layer Spec Kit Highlights"');

    const call5Prompt = await call5Opts.renderPrompt('');
    expect(call5Prompt).toContain('Domain Deep Dive');
    expect(call5Prompt).toContain('"Domain Deep Dive"');

    const call6Prompt = await call6Opts.renderPrompt('');
    expect(call6Prompt).toContain('Key Workflows');
    expect(call6Prompt).toContain('"Key Workflows"');

    const call7Prompt = await call7Opts.renderPrompt('');
    expect(call7Prompt).toContain('Architecture Decisions (ADRs)');
    expect(call7Prompt).toContain('"Architecture Decisions (ADRs)"');

    expect(result.placeholders).toBe(0);
  });

  it('marks the batch as placeholder when its call fails twice and surfaces placeholders count', async () => {
    const plan = buildPlan();
    const callResponses: Array<{ document: PdfDocument | null; error: { type: 'provider_error'; message: string } | null; attempts: number; repair: null }> = [
      { document: headerDoc([section('Executive Summary', 'es'), section('System Overview', 'so')]), error: null, attempts: 1, repair: null },
      { document: null, error: { type: 'provider_error', message: 'call 2 failed' }, attempts: 3, repair: null },
      { document: partialDoc([section('Architecture Layers', 'al')]), error: null, attempts: 1, repair: null },
      { document: partialDoc([section('Per-Layer Spec Kit Highlights', 'pls')]), error: null, attempts: 1, repair: null },
      { document: partialDoc([section('Domain Deep Dive', 'dd')]), error: null, attempts: 1, repair: null },
      { document: partialDoc([section('Key Workflows', 'kw')]), error: null, attempts: 1, repair: null },
      { document: partialDoc([section('Architecture Decisions (ADRs)', 'adrs')]), error: null, attempts: 1, repair: null },
    ];
    let callIndex = 0;
    graphStub.runOneCall.mockImplementation(async () => callResponses[callIndex++]);

    const invoker = vi.fn(async () => ({ text: '', empty: false } as PdfCreatorInvokerResult));
    const result = await orchestrator.run(plan, { llmInvoker: invoker });

    expect(result.document).not.toBeNull();
    expect(result.placeholders).toBe(1);
    expect(result.document?.sections.map((s) => s.heading)).toContain('Executive Summary');
    expect(result.document?.sections.map((s) => s.heading)).not.toContain('Bounded Contexts');
  });

  it('returns ok=false and surfaces the error when the header call fails', async () => {
    const plan = buildPlan();
    graphStub.runOneCall.mockResolvedValue({
      document: null,
      error: { type: 'provider_error', message: 'header failed' },
      attempts: 3,
      repair: null,
    });

    const invoker = vi.fn(async () => ({ text: '', empty: false } as PdfCreatorInvokerResult));
    const result = await orchestrator.run(plan, { llmInvoker: invoker });

    expect(result.document).toBeNull();
    expect(result.error?.message).toBe('header failed');
    expect(result.callCount).toBe(1);
  });

  it('passes the header call an llmInvoker that is invoked at least once', async () => {
    const plan = buildPlan();
    let callIndex = 0;
    graphStub.runOneCall.mockImplementation(async (opts: RunOneCallOptions) => {
      callIndex += 1;
      if (callIndex === 1) {
        await opts.llmInvoker('p');
        return { document: headerDoc([section('Executive Summary', 'es'), section('System Overview', 'so')]), error: null, attempts: 1, repair: null };
      }
      return { document: partialDoc([section('Bounded Contexts', 'bc')]), error: null, attempts: 1, repair: null };
    });

    let count = 0;
    const invoker = async () => {
      count += 1;
      return { text: 'ok', empty: false };
    };

    await orchestrator.run(plan, { llmInvoker: invoker });
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
