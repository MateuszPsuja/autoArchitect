import { TestBed } from '@angular/core/testing';
import { AuditRepairRunner } from './audit-repair-runner.service';
import { AuditRunner } from './audit-runner.service';
import { ProjectStore } from './project.store';
import { minimalPlanFixture } from '../testing/fixtures';
import { SectionRepairRunner } from './section-repair-runner.service';

describe('AuditRepairRunner', () => {
  let repair: AuditRepairRunner;
  let audits: AuditRunner;
  let project: InstanceType<typeof ProjectStore>;
  let sectionRepair: SectionRepairRunner;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    repair = TestBed.inject(AuditRepairRunner);
    audits = TestBed.inject(AuditRunner);
    project = TestBed.inject(ProjectStore);
    sectionRepair = TestBed.inject(SectionRepairRunner);
  });

  it('returns the plan unchanged when auditRepairMaxAttempts is 0', async () => {
    project.setConfig({ ...project.config(), auditRepairMaxAttempts: 0 });
    const findings = audits.run(minimalPlanFixture);

    const bad = structuredClone(minimalPlanFixture);
    bad.domains[0].components[0].tddSpec.unitTests = bad.domains[0].components[0].tddSpec.unitTests.slice(0, 1);
    const dirtyFindings = audits.run(bad);
    const result = await repair.invoke(bad, dirtyFindings, async () => ({ text: 'never-called' }));
    expect(result.attempts).toBe(0);
    expect(result.residualFindings.length).toBeGreaterThan(0);
    expect(result.plan).toEqual(bad);
  });

  it('regenerates the offending domain via a per-id job and resolves the unitTests minimum error', async () => {
    const bad = structuredClone(minimalPlanFixture);
    bad.domains[0].components[0].tddSpec.unitTests = bad.domains[0].components[0].tddSpec.unitTests.slice(0, 1);



    const fixedDomain = structuredClone(bad.domains[0]);
    fixedDomain.components[0].tddSpec.unitTests.push({
      description: 'extra test',
      given: ['x'],
      when: 'y',
      then: ['z'],
    });

    const promptTexts: string[] = [];
    const result = await repair.invoke(
      bad,
      audits.run(bad),
      async (promptText) => {
        promptTexts.push(promptText);
        return { text: JSON.stringify(fixedDomain) };
      },
      { title: 'T', idea: 'I', technicalConstraints: '', nfrs: '', hints: '' },
    );
    expect(result.attempts).toBeGreaterThanOrEqual(1);
    expect(result.plan.domains[0].components[0].tddSpec.unitTests.length).toBe(2);

    const tddError = result.residualFindings.find(
      (f) => f.severity === 'error' && f.path.includes('unitTests'),
    );
    expect(tddError).toBeUndefined();



    const usesFullPlanPayload = promptTexts.some((p) => p.includes('planner-service'));
    expect(usesFullPlanPayload).toBe(false);
  });

  it('returns the original plan + residual findings when the model fails to repair', async () => {
    const bad = structuredClone(minimalPlanFixture);
    bad.domains[0].components[0].tddSpec.unitTests = bad.domains[0].components[0].tddSpec.unitTests.slice(0, 1);
    const result = await repair.invoke(bad, audits.run(bad), async () => {
      throw new Error('model down');
    });
    expect(result.residualFindings.length).toBeGreaterThan(0);
    expect(result.plan).toEqual(bad);
  });

  it('bails after one pass when repair swaps one finding for another (zero overlap)', async () => {







    project.setConfig({ ...project.config(), auditRepairMaxAttempts: 2 });
    const bad = structuredClone(minimalPlanFixture);
    bad.domains[0].components[0].tddSpec.unitTests = bad.domains[0].components[0].tddSpec.unitTests.slice(0, 1);
    const initialFindings = audits.run(bad);
    const tddPath = initialFindings.find((f) => f.path.includes('unitTests'))?.path;
    expect(tddPath).toBeDefined();

    let calls = 0;
    const result = await repair.invoke(
      bad,
      initialFindings,
      async () => {
        calls += 1;



        const swapped = structuredClone(bad.domains[0]);
        swapped.components[0].tddSpec.unitTests.push({
          description: 'extra test',
          given: ['x'],
          when: 'y',
          then: ['z'],
        });
        return { text: JSON.stringify(swapped) };
      },
      { title: 'T', idea: 'I', technicalConstraints: '', nfrs: '', hints: '' },
    );





    expect(calls).toBeLessThanOrEqual(4);
    expect(result.attempts).toBeGreaterThanOrEqual(1);
  });

  it('delegates to SectionRepairRunner for the LLM-bearing work', async () => {
    const spy = vi.spyOn(sectionRepair, 'invokeSectionScoped');
    const bad = structuredClone(minimalPlanFixture);
    bad.domains[0].components[0].tddSpec.unitTests = bad.domains[0].components[0].tddSpec.unitTests.slice(0, 1);
    const fixedDomain = structuredClone(bad.domains[0]);
    fixedDomain.components[0].tddSpec.unitTests.push({
      description: 'extra test',
      given: ['x'],
      when: 'y',
      then: ['z'],
    });
    const input = { title: 'T', idea: 'I', technicalConstraints: '', nfrs: '', hints: '' };
    await repair.invoke(bad, audits.run(bad), async () => ({ text: JSON.stringify(fixedDomain) }), input);
    expect(spy).toHaveBeenCalled();



    const [, , passedInput] = spy.mock.calls[0];
    expect(passedInput).toBe(input);
  });
});
