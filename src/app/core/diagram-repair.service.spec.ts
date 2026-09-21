import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mermaid from 'mermaid';
import { DiagramAuditService } from './diagram-audit.service';
import { DiagramRepairService } from './diagram-repair.service';
import { Plan } from './plan.schema';
import { minimalPlanFixture } from '../testing/fixtures';

interface MermaidParseHandle {
  setValid: () => void;
  setInvalid: () => void;
}

function installParseMock(): {
  parseSpy: ReturnType<typeof vi.spyOn>;
  handle: MermaidParseHandle;
} {
  const behavior: { kind: 'valid' | 'invalid' } = { kind: 'valid' };
  const parseSpy = vi
    .spyOn(mermaid as unknown as { parse: (chart: string) => Promise<unknown> }, 'parse')
    .mockImplementation(() => {
      if (behavior.kind === 'invalid') return Promise.reject(new Error('Syntax error'));
      return Promise.resolve();
    });
  return {
    parseSpy: parseSpy as unknown as ReturnType<typeof vi.spyOn>,
    handle: {
      setValid: () => {
        behavior.kind = 'valid';
      },
      setInvalid: () => {
        behavior.kind = 'invalid';
      },
    },
  };
}

function clonePlan(): Plan {
  return JSON.parse(JSON.stringify(minimalPlanFixture)) as Plan;
}

describe('DiagramRepairService', () => {
  let service: DiagramRepairService;
  let parseSpy: ReturnType<typeof vi.spyOn>;
  let handle: MermaidParseHandle;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    const installed = installParseMock();
    parseSpy = installed.parseSpy;
    handle = installed.handle;
    service = TestBed.inject(DiagramRepairService);
  });

  afterEach(() => {
    parseSpy.mockRestore();
  });

  it('returns the plan unchanged when the audit has no failures', async () => {
    handle.setValid();
    const plan = clonePlan();
    const audit = await TestBed.inject(DiagramAuditService).auditPlan(plan);
    const llm = vi.fn();
    const result = await service.repairPlan(plan, audit, llm);
    expect(result.plan).toBe(plan);
    expect(result.repaired).toEqual([]);
    expect(result.residual).toEqual([]);
    expect(llm).not.toHaveBeenCalled();
  });

  it('patches a broken context diagram with the LLM-fixed source', async () => {
    handle.setInvalid();
    const plan = clonePlan();



    plan.systemOverview.c4.contextDiagram = 'graph TD\nA ->';
    plan.systemOverview.c4.containerDiagram = 'graph TD\nX ->';

    const audit = await TestBed.inject(DiagramAuditService).auditPlan(plan);
    const contextFailure = audit.entries.find(
      (e) =>
        e.status === 'failed' &&
        e.location.scope === 'system' &&
        e.location.field === 'c4.contextDiagram',
    );
    expect(contextFailure).toBeDefined();

    handle.setValid();





    const llm = vi.fn(async (prompt: string) => {
      if (prompt.includes('Field: systemOverview.c4.contextDiagram')) {
        return { text: 'graph TD\nA --> B' };
      }
      return { text: 'graph TD\nplaceholder' };
    });

    const result = await service.repairPlan(plan, audit, llm);
    expect(llm).toHaveBeenCalled();
    expect(result.repaired.length).toBeGreaterThan(0);
    expect(result.plan.systemOverview.c4.contextDiagram).toBe('graph TD\nA --> B');

    expect(plan.systemOverview.c4.contextDiagram).toBe('graph TD\nA ->');
  });

  it('strips markdown fences when the LLM returns fenced output', async () => {
    handle.setInvalid();
    const plan = clonePlan();
    plan.systemOverview.c4.contextDiagram = 'graph TD\nA ->';
    const audit = await TestBed.inject(DiagramAuditService).auditPlan(plan);

    handle.setValid();
    const llm = vi.fn().mockResolvedValue({
      text: '```mermaid\ngraph TD\nA --> B\n```',
    });
    const result = await service.repairPlan(plan, audit, llm);
    expect(result.plan.systemOverview.c4.contextDiagram).toBe('graph TD\nA --> B');
  });

  it('keeps the original (broken) diagram when the LLM fix still fails to parse', async () => {
    handle.setInvalid();
    const plan = clonePlan();
    plan.systemOverview.c4.contextDiagram = 'graph TD\nA ->';
    const audit = await TestBed.inject(DiagramAuditService).auditPlan(plan);





    const llm = vi.fn().mockResolvedValue({ text: 'graph TD\nA ->' });
    const result = await service.repairPlan(plan, audit, llm);
    expect(result.repaired).toEqual([]);
    expect(result.residual.length).toBeGreaterThan(0);



    expect(result.plan.systemOverview.c4.contextDiagram).toBe('graph TD\nA ->');

    expect(plan.systemOverview.c4.contextDiagram).toBe('graph TD\nA ->');
  });

  it('isolates per-diagram failures: one broken repair does not block the others', async () => {
    handle.setInvalid();
    const plan = clonePlan();
    plan.systemOverview.c4.contextDiagram = 'graph TD\nA ->';
    plan.systemOverview.c4.containerDiagram = 'graph TD\nX ->';
    const audit = await TestBed.inject(DiagramAuditService).auditPlan(plan);
    expect(audit.failed).toBeGreaterThanOrEqual(2);

    handle.setValid();
    const llm = vi
      .fn()

      .mockResolvedValueOnce({ text: '' })

      .mockResolvedValueOnce({ text: 'graph TD\nX --> Y' });

    const result = await service.repairPlan(plan, audit, llm);



    expect(result.plan.systemOverview.c4.containerDiagram).toBe('graph TD\nX --> Y');
  });

  it('preserves layer.id when patching a layer diagram', async () => {
    handle.setInvalid();
    const plan = clonePlan();
    const layerId = plan.architectureLayers[0].id;
    plan.architectureLayers[0].componentTreeDiagram = 'classDiagram\nBroken ->';
    const audit = await TestBed.inject(DiagramAuditService).auditPlan(plan);

    handle.setValid();
    const llm = vi.fn().mockResolvedValue({
      text: 'classDiagram\n  class A\n  class B\n  A --> B',
    });
    const result = await service.repairPlan(plan, audit, llm);
    expect(result.plan.architectureLayers[0].id).toBe(layerId);
    expect(result.plan.architectureLayers[0].componentTreeDiagram).toContain('class A');
  });
});
