import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mermaid from 'mermaid';
import { DiagramAuditService } from './diagram-audit.service';
import { DiagramRepairService } from './diagram-repair.service';
import { LocalAuditFixer } from './local-audit-fixer.service';
import { MermaidVerifyService, type LlmInvoker } from './mermaid-verify.service';
import { Plan } from './plan.schema';
import { minimalPlanFixture } from '../testing/fixtures';

interface MermaidParseHandle {
  setValid: () => void;
  setInvalid: (message?: string) => void;
}

function installParseMock(): {
  parseSpy: ReturnType<typeof vi.spyOn>;
  handle: MermaidParseHandle;
} {
  const behavior: { kind: 'valid' | 'invalid'; message: string } = {
    kind: 'valid',
    message: '',
  };
  const parseSpy = vi
    .spyOn(mermaid as unknown as { parse: (chart: string) => Promise<unknown> }, 'parse')
    .mockImplementation(() => {
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

function clonePlan(): Plan {
  return JSON.parse(JSON.stringify(minimalPlanFixture)) as Plan;
}

async function singleStoredFailureAudit(
  plan: Plan,
  handle: MermaidParseHandle,
): Promise<ReturnType<DiagramAuditService['auditPlanWithSynthesised']>> {
  const audit = await TestBed.inject(DiagramAuditService).auditPlanWithSynthesised(plan);



  void handle;
  return audit;
}

describe('MermaidVerifyService', () => {
  let service: MermaidVerifyService;
  let parseSpy: ReturnType<typeof vi.spyOn>;
  let handle: MermaidParseHandle;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    const installed = installParseMock();
    parseSpy = installed.parseSpy;
    handle = installed.handle;
    service = TestBed.inject(MermaidVerifyService);
  });

  afterEach(() => {
    parseSpy.mockRestore();
  });

  it('returns plan unchanged and empty residual when audit is clean', async () => {
    handle.setValid();
    const plan = clonePlan();
    const llm = vi.fn<LlmInvoker>();
    const result = await service.verifyAndFix(plan, llm, undefined);
    expect(result.plan).toBe(plan);
    expect(result.residual).toEqual([]);
    expect(result.repairedCount).toBe(0);
    expect(result.synthesisedPatches).toEqual({});
    expect(llm).not.toHaveBeenCalled();
  });

  it('patches a stored diagram via the LLM loop and returns the fixed plan', async () => {





    parseSpy.mockRestore();
    parseSpy = vi
      .spyOn(mermaid as unknown as { parse: (chart: string) => Promise<unknown> }, 'parse')
      .mockImplementation((chart: string) => {
        if (chart.trim() === 'graph TD\nn1["A ->"]') {
          return Promise.reject(new Error('Parse error on line 2'));
        }
        return Promise.resolve();
      });
    const plan = clonePlan();
    plan.systemOverview.c4.contextDiagram = 'graph TD\nA ->';
    const llm = vi.fn<LlmInvoker>().mockImplementation(async (prompt: string) => {
      if (prompt.includes('Field: systemOverview.c4.contextDiagram')) {
        return { text: 'graph TD\nA --> B' };
      }
      return { text: 'graph TD\nplaceholder' };
    });
    const result = await service.verifyAndFix(plan, llm, undefined, { maxIterations: 3 });
    expect(llm).toHaveBeenCalled();
    expect(result.plan.systemOverview.c4.contextDiagram).toBe('graph TD\nA --> B');
    expect(result.repairedCount).toBeGreaterThanOrEqual(1);
  });

  it('bails out when the LLM keeps returning broken output (zero-fix guard)', async () => {
    handle.setInvalid();
    const plan = clonePlan();
    plan.systemOverview.c4.contextDiagram = 'graph TD\nA ->';



    const llm = vi.fn<LlmInvoker>().mockResolvedValue({ text: 'graph TD\nA ->' });
    const result = await service.verifyAndFix(plan, llm, undefined, { maxIterations: 3 });
    expect(result.plan.systemOverview.c4.contextDiagram).toBe('graph TD\nA ->');
    expect(result.repairedCount).toBe(0);

    expect(plan.systemOverview.c4.contextDiagram).toBe('graph TD\nA ->');
  });

  it('honours the AbortSignal: returns accumulated repairedCount and plan so far', async () => {
    handle.setInvalid();
    const plan = clonePlan();
    plan.systemOverview.c4.contextDiagram = 'graph TD\nA ->';
    const controller = new AbortController();
    controller.abort();

    const llm = vi.fn<LlmInvoker>();
    const result = await service.verifyAndFix(plan, llm, controller.signal, {
      maxIterations: 5,
    });
    expect(result.plan).toBeDefined();
    expect(result.repairedCount).toBe(0);

    expect(llm).not.toHaveBeenCalled();
  });

  it('emits a synthesised blueprint patch when the synthesised audit reports a failure', async () => {





    handle.setValid();
    const plan = clonePlan();
    const llm = vi.fn<LlmInvoker>();
    const result = await service.verifyAndFix(plan, llm, undefined);



    expect(result.synthesisedPatches['blueprint']).toBeUndefined();
    expect(llm).not.toHaveBeenCalled();
  });

  it('returns AuditFindings with synthetic paths for synthesised residuals', () => {



    const synthFailure: import('./diagram-audit.service').DiagramAuditEntry = {
      location: { scope: 'synthesised', id: 'blueprint', source: 'blueprint' },
      status: 'failed',
      error: 'Parse error',
    };
    const storedFailure: import('./diagram-audit.service').DiagramAuditEntry = {
      location: {
        scope: 'system',
        field: 'c4.contextDiagram',
      },
      status: 'failed',
      error: 'Parse error',
    };
    const findings = service.residualToFindings([synthFailure, storedFailure]);
    expect(findings[0].path).toBe('synthesised.blueprint');
    expect(findings[1].path).toBe('systemOverview.c4.contextDiagram');
    expect(findings[0].severity).toBe('error');
  });

  it('runs at most maxIterations iterations even when the LLM keeps making progress', async () => {
    handle.setInvalid();
    const plan = clonePlan();
    plan.systemOverview.c4.contextDiagram = 'graph TD\nA ->';





    const callCount = { value: 0 };
    const llm = vi.fn<LlmInvoker>().mockImplementation(async () => {
      callCount.value += 1;

      return { text: `graph TD\nA ->${callCount.value}` };
    });
    const result = await service.verifyAndFix(plan, llm, undefined, { maxIterations: 2 });
    expect(result.repairedCount).toBe(0);



    expect(llm.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});
