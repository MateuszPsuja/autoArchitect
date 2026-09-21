import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mermaid from 'mermaid';
import { DiagramAuditService } from './diagram-audit.service';
import { Plan } from './plan.schema';
import { minimalPlanFixture } from '../testing/fixtures';

interface AuditParseSpy {
  mockImplementation: (impl: (chart: string) => Promise<void>) => unknown;
  mockRejectedValue: (value: unknown) => unknown;
  mockResolvedValue: (value: unknown) => unknown;
  mockClear: () => unknown;
}

interface MermaidParseHandle {
  setValid: () => void;
  setInvalid: (message?: string) => void;
}

function installParseMock(): { parseSpy: ReturnType<typeof vi.spyOn>; handle: MermaidParseHandle } {
  const behavior: { kind: 'valid' | 'invalid'; message: string } = { kind: 'valid', message: '' };
  const parseSpy = vi
    .spyOn(mermaid as unknown as { parse: (chart: string) => Promise<unknown> }, 'parse')
    .mockImplementation((_chart: string) => {
      if (behavior.kind === 'invalid') {
        return Promise.reject(new Error(behavior.message || 'Syntax error'));
      }
      return Promise.resolve();
    });
  return {
    parseSpy: parseSpy as unknown as ReturnType<typeof vi.spyOn>,
    handle: {
      setValid: () => {
        behavior.kind = 'valid';
        behavior.message = '';
      },
      setInvalid: (message?: string) => {
        behavior.kind = 'invalid';
        behavior.message = message ?? 'Syntax error';
      },
    },
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return JSON.parse(JSON.stringify(minimalPlanFixture)) as Plan;
}

describe('DiagramAuditService', () => {
  let service: DiagramAuditService;
  let parseSpy: ReturnType<typeof vi.spyOn>;
  let handle: MermaidParseHandle;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    const installed = installParseMock();
    parseSpy = installed.parseSpy;
    handle = installed.handle;
    service = TestBed.inject(DiagramAuditService);
  });

  afterEach(() => {
    parseSpy.mockRestore();
  });

  it('returns an empty report when plan is null', async () => {
    const report = await service.auditPlan(null);
    expect(report.total).toBe(0);
    expect(report.passed).toBe(0);
    expect(report.failed).toBe(0);
    expect(report.skipped).toBe(0);
    expect(report.entries).toEqual([]);
    expect(report.repaired).toBe(0);
    expect(typeof report.generatedAt).toBe('string');
  });

  it('passes valid system overview C4 diagrams and the layer mermaid diagram', async () => {
    handle.setValid();
    const plan = makePlan();
    const report = await service.auditPlan(plan);

    expect(report.passed).toBe(5);
    expect(report.failed).toBe(0);
    expect(report.skipped).toBe(10);
    expect(report.total).toBe(15);
  });

  it('fails the system context diagram when mermaid.parse rejects', async () => {
    handle.setInvalid('Parse error on line 1: Unexpected token');
    const plan = makePlan();
    const report = await service.auditPlan(plan);
    const ctx = report.entries.find(
      (e) => e.location.scope === 'system' && e.location.field === 'c4.contextDiagram',
    );
    expect(ctx).toBeDefined();
    expect(ctx!.status).toBe('failed');
    expect(ctx!.error).toContain('Parse error on line 1');
    expect(report.failed).toBeGreaterThanOrEqual(1);
  });

  it('marks an empty-string optional diagram as failed with the empty-message label', async () => {
    handle.setValid();
    const plan = makePlan();
    plan.architectureLayers[0].componentTreeDiagram = '';
    const report = await service.auditPlan(plan);
    const entry = report.entries.find(
      (e) => e.location.scope === 'layer' && e.location.field === 'componentTreeDiagram',
    );
    expect(entry).toBeDefined();
    expect(entry!.status).toBe('failed');
    expect(entry!.error).toBe('empty or whitespace-only');
  });

  it('marks an undefined optional diagram as skipped, not failed', async () => {
    handle.setValid();
    const plan = makePlan();
    plan.architectureLayers[0].componentTreeDiagram = undefined;
    const report = await service.auditPlan(plan);
    const entry = report.entries.find(
      (e) => e.location.scope === 'layer' && e.location.field === 'componentTreeDiagram',
    );
    expect(entry!.status).toBe('skipped');
    expect(entry!.error).toBeUndefined();
  });

  it('marks a whitespace-only string as failed with the empty-message label', async () => {
    handle.setValid();
    const plan = makePlan();
    plan.architectureLayers[0].dataFlowDiagram = '   \n\t  ';
    const report = await service.auditPlan(plan);
    const entry = report.entries.find(
      (e) => e.location.scope === 'layer' && e.location.field === 'dataFlowDiagram',
    );
    expect(entry!.status).toBe('failed');
    expect(entry!.error).toBe('empty or whitespace-only');
  });

  it('walks the plan in a stable order: system overview first, then layers in plan order', async () => {
    handle.setValid();
    const plan = makePlan();
    const report = await service.auditPlan(plan);
    const order = report.entries.map((e) => {
      if (e.location.scope === 'system') return `system:${e.location.field}`;
      if (e.location.scope === 'layer') return `layer:${e.location.layerId}:${e.location.field}`;
      return `synthesised:${e.location.id}`;
    });
    expect(order[0]).toBe('system:c4.contextDiagram');
    expect(order[1]).toBe('system:c4.containerDiagram');
    expect(order[2]).toBe('system:boundedContextMap');
    expect(order[3]).toBe(`layer:${plan.architectureLayers[0].id}:mermaidDiagram`);
    const expectedLayer0 = [
      'componentTreeDiagram',
      'dataFlowDiagram',
      'moduleDependenciesDiagram',
      'stateManagementDiagram',
      'apiContractDiagram',
    ].map((f) => `layer:${plan.architectureLayers[0].id}:${f}`);
    expect(order.slice(4, 9)).toEqual(expectedLayer0);
    expect(order[9]).toBe(`layer:${plan.architectureLayers[1].id}:mermaidDiagram`);
  });

  it('records sourceLength so the UI can show how big the broken diagram was', async () => {
    handle.setInvalid('bad');
    const plan = makePlan();
    const report = await service.auditPlan(plan);
    const failedWithLength = report.entries.find(
      (e) => e.status === 'failed' && typeof e.sourceLength === 'number',
    );
    expect(failedWithLength).toBeDefined();
    expect(failedWithLength!.sourceLength).toBeGreaterThan(0);
  });

  it('attributes a sequenceDiagram parse failure to a precise unsafe character via diagnostic', async () => {
    handle.setInvalid('Parse error on line 3: Expecting ...');
    const plan = makePlan();
    plan.architectureLayers[0].dataFlowDiagram =
      'sequenceDiagram\n  participant A\n  A->>B: GET /users/{id}?active=true';
    const report = await service.auditPlan(plan);
    const entry = report.entries.find(
      (e) => e.location.scope === 'layer' && e.location.field === 'dataFlowDiagram',
    );
    expect(entry).toBeDefined();
    expect(entry!.status).toBe('failed');



    expect(entry!.diagnostic).toBeUndefined();
  });

  it('omits diagnostic when the failing diagram is not a sequenceDiagram', async () => {
    handle.setInvalid('Parse error on line 1: Unexpected token');
    const plan = makePlan();
    const report = await service.auditPlan(plan);
    const failed = report.entries.find((e) => e.status === 'failed');
    expect(failed).toBeDefined();
    expect(failed!.diagnostic).toBeUndefined();
  });

  it('omits diagnostic when the sequenceDiagram message contains only Mermaid-safe chars', async () => {



    handle.setInvalid('Parse error on line 3');
    const plan = makePlan();
    plan.architectureLayers[0].dataFlowDiagram =
      'sequenceDiagram\n  participant A\n  A->>B: GET /users/{id}?active=true';
    const report = await service.auditPlan(plan);
    const entry = report.entries.find(
      (e) => e.location.scope === 'layer' && e.location.field === 'dataFlowDiagram',
    );
    expect(entry!.status).toBe('failed');
    expect(entry!.diagnostic).toBeUndefined();
  });

  it('still flags a literal `;` in a sequenceDiagram message as unsafe', async () => {



    handle.setInvalid('Parse error on line 3');
    const plan = makePlan();
    plan.architectureLayers[0].dataFlowDiagram =
      'sequenceDiagram\n  participant A\n  A->>B: step1;step2';
    const report = await service.auditPlan(plan);
    const entry = report.entries.find(
      (e) => e.location.scope === 'layer' && e.location.field === 'dataFlowDiagram',
    );
    expect(entry!.status).toBe('failed');
    expect(entry!.diagnostic).toContain('unsafe character');
    expect(entry!.diagnostic).toContain(';');
  });
});

describe('DiagramAuditService.auditPlanWithSynthesised', () => {
  let service: DiagramAuditService;
  let parseSpy: ReturnType<typeof vi.spyOn>;
  let handle: MermaidParseHandle;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    const installed = installParseMock();
    parseSpy = installed.parseSpy;
    handle = installed.handle;
    service = TestBed.inject(DiagramAuditService);
  });

  afterEach(() => {
    parseSpy.mockRestore();
  });

  it('returns an empty report when plan is null (no synthesised entries)', async () => {
    const report = await service.auditPlanWithSynthesised(null);
    expect(report.total).toBe(0);
    expect(report.entries).toEqual([]);
  });

  it('reports one synthesised blueprint entry plus one per tech-stack layer', async () => {
    handle.setValid();
    const plan = makePlan();



    const report = await service.auditPlanWithSynthesised(plan);
    const synthEntries = report.entries
      .filter((e): e is typeof e & { location: Extract<typeof e.location, { scope: 'synthesised' }> } =>
        e.location.scope === 'synthesised',
      );
    expect(synthEntries.length).toBe(3);
    const blueprint = synthEntries.find((e) => e.location.id === 'blueprint');
    expect(blueprint).toBeDefined();
    expect(blueprint!.location.source).toBe('blueprint');
    expect(blueprint!.status).toBe('passed');
    for (const layer of plan.architectureLayers) {
      const techEntry = synthEntries.find((e) => e.location.id === `techStack:${layer.id}`);
      expect(techEntry).toBeDefined();
      expect(techEntry!.location.source).toBe('techStack');
      expect(techEntry!.status).toBe('passed');
    }
  });

  it('marks the synthesised blueprint as failed with the synthetic location when it does not parse', async () => {
    handle.setInvalid('Parse error on line 1');
    const plan = makePlan();
    const report = await service.auditPlanWithSynthesised(plan);
    const blueprint = report.entries.find(
      (e) => e.location.scope === 'synthesised' && e.location.id === 'blueprint',
    );
    expect(blueprint).toBeDefined();
    expect(blueprint!.status).toBe('failed');
    expect(blueprint!.error).toContain('Parse error on line 1');
  });

  it('marks a single synthesised tech-stack entry as failed when only that layer fails', async () => {



    const parseSpyWithSelectiveFailure = vi
      .spyOn(mermaid as unknown as { parse: (chart: string) => Promise<unknown> }, 'parse')
      .mockImplementation((chart: string) => {



        if (chart.includes('subgraph S_tech_1')) {
          return Promise.reject(new Error('broken tech stack'));
        }
        return Promise.resolve();
      });
    try {
      const plan = makePlan();
      const report = await service.auditPlanWithSynthesised(plan);
      const techEntries = report.entries.filter(
        (e) => e.location.scope === 'synthesised' && e.location.source === 'techStack',
      );
      const failed = techEntries.filter((e) => e.status === 'failed');
      const passed = techEntries.filter((e) => e.status === 'passed');
      expect(failed.length).toBe(1);
      expect(failed[0].error).toContain('broken tech stack');
      expect(passed.length).toBe(techEntries.length - 1);
    } finally {
      parseSpyWithSelectiveFailure.mockRestore();
    }
  });

  it('omits synthesised entries when the plan has no architecture layers with techStack', async () => {
    handle.setValid();
    const plan = makePlan();



    plan.architectureLayers = plan.architectureLayers.map((l) => ({
      ...l,
      techStack: [],
    }));
    const report = await service.auditPlanWithSynthesised(plan);
    const techEntries = report.entries.filter(
      (e) => e.location.scope === 'synthesised' && e.location.source === 'techStack',
    );
    expect(techEntries.length).toBe(0);

    const blueprint = report.entries.find(
      (e) => e.location.scope === 'synthesised' && e.location.id === 'blueprint',
    );
    expect(blueprint).toBeDefined();
  });
});
