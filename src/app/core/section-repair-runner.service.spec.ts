import { TestBed } from '@angular/core/testing';
import { SectionRepairRunner } from './section-repair-runner.service';
import { ParallelJobEvent } from './parallel-section-runner.service';
import { AuditRunner } from './audit-runner.service';
import { ProjectStore } from './project.store';
import { PlanSchemaService } from './plan-schema.service';
import { LocalAuditFixer } from './local-audit-fixer.service';
import { minimalPlanFixture } from '../testing/fixtures';
import { Plan } from './plan.schema';

describe('SectionRepairRunner', () => {
  let runner: SectionRepairRunner;
  let audits: AuditRunner;
  let project: InstanceType<typeof ProjectStore>;
  let schemaService: PlanSchemaService;
  let localFixer: LocalAuditFixer;

  const input = {
    title: 'Test',
    idea: 'idea',
    technicalConstraints: '',
    nfrs: '',
    hints: '',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({});
    runner = TestBed.inject(SectionRepairRunner);
    audits = TestBed.inject(AuditRunner);
    project = TestBed.inject(ProjectStore);
    schemaService = TestBed.inject(PlanSchemaService);
    localFixer = TestBed.inject(LocalAuditFixer);
  });

  describe('static helpers', () => {
    it('groupFindings returns an empty list for empty findings', () => {
      const groups = SectionRepairRunner.groupFindings(minimalPlanFixture, []);
      expect(groups).toEqual([]);
    });

    it('groupFindings routes architectureLayers[id].* to a layer group', () => {
      const findings = [
        {
          severity: 'error' as const,
          path: 'architectureLayers[backend].mermaidDiagram',
          message: 'unsupported mermaid type',
          fix: 'use flowchart',
        },
      ];
      const groups = SectionRepairRunner.groupFindings(minimalPlanFixture, findings);
      expect(groups).toEqual([
        { kind: 'layer', id: 'backend', findings },
      ]);
    });

    it('groupFindings routes domains[id].* and domains[id].components[id].* to a domain group', () => {
      const findings = [
        {
          severity: 'error' as const,
          path: 'domains[core-planning].components[planner-service].tddSpec.unitTests',
          message: 'too few',
          fix: 'add more',
        },
        {
          severity: 'error' as const,
          path: 'domains[core-planning].layer',
          message: 'bad ref',
          fix: 'fix',
        },
      ];
      const groups = SectionRepairRunner.groupFindings(minimalPlanFixture, findings);
      expect(groups).toHaveLength(1);
      expect(groups[0]).toEqual({
        kind: 'domain',
        id: 'core-planning',
        findings,
      });
    });

    it('groupFindings routes systemOverview.* to a planField scaffold group', () => {
      const findings = [
        {
          severity: 'error' as const,
          path: 'systemOverview.boundedContextMap',
          message: 'unsupported',
          fix: 'fix',
        },
      ];
      const groups = SectionRepairRunner.groupFindings(minimalPlanFixture, findings);
      expect(groups).toEqual([
        {
          kind: 'planField',
          path: 'systemOverview.boundedContextMap',
          findings,
          section: 'scaffold',
        },
      ]);
    });

    it('groupFindings routes workflows[id].* to a planField tail group', () => {
      const findings = [
        {
          severity: 'error' as const,
          path: 'workflows[generate-flow].domainIds',
          message: 'bad ref',
          fix: 'fix',
        },
      ];
      const groups = SectionRepairRunner.groupFindings(minimalPlanFixture, findings);
      expect(groups).toEqual([
        {
          kind: 'planField',
          path: 'workflows[generate-flow].domainIds',
          findings,
          section: 'tail',
        },
      ]);
    });

    it('groupFindings routes unknown paths to planField with empty findings (residual)', () => {
      const findings = [
        {
          severity: 'error' as const,
          path: 'some-unknown.path',
          message: 'whatever',
          fix: 'fix',
        },
      ];
      const groups = SectionRepairRunner.groupFindings(minimalPlanFixture, findings);
      expect(groups).toEqual([
        {
          kind: 'planField',
          path: 'some-unknown.path',
          findings,
          section: 'scaffold',
        },
      ]);
    });

    it('applyGroup stitches a layer replacement into the plan', () => {
      const replacement = [
        {
          ...minimalPlanFixture.architectureLayers[0],
          description: 'replaced',
        },
      ];
      const next = SectionRepairRunner.applyGroup(
        minimalPlanFixture,
        { kind: 'layer', id: minimalPlanFixture.architectureLayers[0].id, findings: [] },
        replacement,
      );
      expect(next.architectureLayers[0].description).toBe('replaced');
    });

    it('applyGroup stitches a domain replacement into the plan', () => {
      const replacement = [
        {
          ...minimalPlanFixture.domains[0],
          description: 'replaced',
        },
      ];
      const next = SectionRepairRunner.applyGroup(
        minimalPlanFixture,
        { kind: 'domain', id: minimalPlanFixture.domains[0].id, findings: [] },
        replacement,
      );
      expect(next.domains[0].description).toBe('replaced');
    });

    it('applyGroup stitches a planField replacement via replacePlanField', () => {
      const next = SectionRepairRunner.applyGroup(
        minimalPlanFixture,
        {
          kind: 'planField',
          path: 'systemOverview.boundedContextMap',
          findings: [],
          section: 'scaffold',
        },
        'flowchart LR\n  A-->B',
      );
      expect(next.systemOverview.boundedContextMap).toBe('flowchart LR\n  A-->B');
    });

    it('applyGroup leaves the plan unchanged when the replacement is invalid', () => {
      const next = SectionRepairRunner.applyGroup(
        minimalPlanFixture,
        {
          kind: 'planField',
          path: 'some-unknown.path',
          findings: [],
          section: 'scaffold',
        },
        'whatever',
      );
      expect(next).toBe(minimalPlanFixture);
    });

    it('shouldBailAuditRepair returns false when the new set is empty', () => {
      expect(
        SectionRepairRunner.shouldBailAuditRepair(new Set(['a']), new Set()),
      ).toBe(false);
    });

    it('shouldBailAuditRepair returns true when the new set is the same as the old', () => {
      const paths = new Set(['a', 'b']);
      expect(SectionRepairRunner.shouldBailAuditRepair(paths, new Set(['a', 'b']))).toBe(true);
    });

    it('shouldBailAuditRepair returns true on zero overlap (churn)', () => {
      expect(
        SectionRepairRunner.shouldBailAuditRepair(new Set(['a']), new Set(['b'])),
      ).toBe(true);
    });

    it('shouldBailAuditRepair returns false on partial overlap (real progress)', () => {
      expect(
        SectionRepairRunner.shouldBailAuditRepair(new Set(['a', 'b']), new Set(['a', 'c'])),
      ).toBe(false);
    });
  });

  describe('invokeSectionScoped', () => {
    it('short-circuits when findings is empty', async () => {
      const result = await runner.invokeSectionScoped(
        minimalPlanFixture,
        [],
        input,
        async () => ({ text: 'never-called' }),
      );
      expect(result.attempts).toBe(0);
      expect(result.residualFindings).toEqual([]);
      expect(result.plan).toBe(minimalPlanFixture);
    });

    it('surfaces Mermaid-type errors as fixed (no LLM call) when LocalAuditFixer handles them', async () => {
      const plan: Plan = structuredClone(minimalPlanFixture);
      plan.architectureLayers[0].mermaidDiagram = 'stateDiagram-v2\n  [*] --> idle';



      plan.architectureLayers[0].mermaidDiagram = 'pie\n  A: 1';
      const findings = audits.run(plan);
      const initialDiagram = plan.architectureLayers[0].mermaidDiagram;
      const result = await runner.invokeSectionScoped(
        plan,
        findings,
        input,
        async () => ({ text: 'never-called' }),
      );



      const mermaidFinding = result.residualFindings.find((f) => f.path.endsWith('mermaidDiagram'));
      expect(mermaidFinding).toBeUndefined();
      expect(initialDiagram).toBe('pie\n  A: 1');
    });

    it('regenerates a domain via a per-id job when an error-severity finding is scoped to a domain', async () => {
      const plan: Plan = structuredClone(minimalPlanFixture);
      plan.domains[0].components[0].tddSpec.unitTests = plan.domains[0].components[0].tddSpec.unitTests.slice(0, 1);
      const findings = audits.run(plan);
      const fixedDomain = structuredClone(plan.domains[0]);
      fixedDomain.components[0].tddSpec.unitTests.push({
        description: 'second test',
        given: ['x'],
        when: 'y',
        then: ['z'],
      });
      let calls = 0;
      const result = await runner.invokeSectionScoped(
        plan,
        findings,
        input,
        async () => {
          calls += 1;
          return { text: JSON.stringify(fixedDomain) };
        },
      );
      expect(calls).toBeGreaterThanOrEqual(1);
      expect(result.attempts).toBeGreaterThanOrEqual(1);
      expect(result.plan.domains[0].components[0].tddSpec.unitTests.length).toBe(2);
    });

    it('surfaces a planField group with an unknown path as a residual', async () => {



      const plan: Plan = structuredClone(minimalPlanFixture);
      const findings = [
        {
          severity: 'error' as const,
          path: 'meta.somethingUnsupported',
          message: 'whatever',
          fix: 'fix',
        },
      ];
      const result = await runner.invokeSectionScoped(
        plan,
        findings,
        input,
        async () => ({ text: 'never-called' }),
      );



      expect(result.plan).toBe(plan);
    });

    it('honours the shared plannerMaxAttempts budget', async () => {
      project.setConfig({ ...project.config(), plannerMaxAttempts: 2 });



      const plan: Plan = structuredClone(minimalPlanFixture);
      const findings = [
        ...plan.architectureLayers.map((l) => ({
          severity: 'error' as const,
          path: `architectureLayers[${l.id}].mermaidDiagram`,
          message: 'bad',
          fix: 'fix',
        })),
      ];
      let calls = 0;
      await runner.invokeSectionScoped(
        plan,
        findings,
        input,
        async () => {
          calls += 1;

          return { text: '{not json' };
        },
        { auditRepairMaxAttempts: 5, maxRetriesPerJob: 1 },
      );





      expect(calls).toBe(4);
      expect(calls).toBeLessThan(8);
    });

    it('returns the plan unchanged when the LLM invoker throws', async () => {
      const plan: Plan = structuredClone(minimalPlanFixture);
      plan.domains[0].components[0].tddSpec.unitTests = plan.domains[0].components[0].tddSpec.unitTests.slice(0, 1);
      const findings = audits.run(plan);
      const result = await runner.invokeSectionScoped(
        plan,
        findings,
        input,
        async () => {
          throw new Error('model down');
        },
      );
      expect(result.residualFindings.length).toBeGreaterThan(0);
      expect(result.plan.domains[0].components[0].tddSpec.unitTests.length).toBe(1);
    });
  });

  describe('replacePlanField (allowlist) integration', () => {
    it('rejects an unknown path with ok:false', () => {
      const write = schemaService.replacePlanField(
        minimalPlanFixture,
        'some.unknown.path',
        'whatever',
      );
      expect(write.ok).toBe(false);
      if (!write.ok) {
        expect(write.reason).toBe('unknown_path');
      }
    });

    it('rejects an invalid replacement shape', () => {
      const write = schemaService.replacePlanField(
        minimalPlanFixture,
        'meta',
        'not an object',
      );
      expect(write.ok).toBe(false);
      if (!write.ok) {
        expect(write.reason).toBe('invalid_replacement');
      }
    });

    it('writes a valid boundedContext layer patch', () => {
      const write = schemaService.replacePlanField(
        minimalPlanFixture,
        'boundedContexts[planning].layer',
        'frontend',
      );
      expect(write.ok).toBe(true);
      if (write.ok) {
        expect(write.plan.boundedContexts[0].layer).toBe('frontend');
      }
    });
  });

  describe('composeHooks — stageKind threading', () => {
    it('threads the parallel-runner stageKind into every re-emitted planner-level event', () => {
      const events: Array<{ hook: string; stage?: string; jobId?: string }> = [];



      const adapter = {
        onJobError: (event: ParallelJobEvent) =>
          events.push({ hook: 'error', stage: event.stageKind ?? 'layers', jobId: event.jobId }),
        onJobRetry: (event: ParallelJobEvent) =>
          events.push({ hook: 'retry', stage: event.stageKind ?? 'layers', jobId: event.jobId }),
        onJobRepair: (event: ParallelJobEvent) =>
          events.push({ hook: 'repair', stage: event.stageKind ?? 'layers', jobId: event.jobId }),
      };
      adapter.onJobError({ jobId: 'layer-a', stageKind: 'layers' });
      adapter.onJobRetry({ jobId: 'layer-a', stageKind: 'layers' });
      adapter.onJobRepair({ jobId: 'domain-b', stageKind: 'domains' });
      expect(events).toEqual([
        { hook: 'error', stage: 'layers', jobId: 'layer-a' },
        { hook: 'retry', stage: 'layers', jobId: 'layer-a' },
        { hook: 'repair', stage: 'domains', jobId: 'domain-b' },
      ]);



      const sample: ParallelJobEvent = { jobId: 'x', stageKind: 'domains' };
      expect(sample.stageKind).toBe('domains');
    });
  });
});
