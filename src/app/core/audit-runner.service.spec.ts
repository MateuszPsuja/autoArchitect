import { TestBed } from '@angular/core/testing';
import { AuditRunner } from './audit-runner.service';
import { minimalPlanFixture } from '../testing/fixtures';

describe('AuditRunner', () => {
  let runner: AuditRunner;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    runner = TestBed.inject(AuditRunner);
  });

  it('returns no error findings for the minimal fixture plan', () => {
    const findings = runner.run(minimalPlanFixture);
    const errors = findings.filter((f) => f.severity === 'error');
    expect(errors).toEqual([]);
  });

  it('flags unsupported Mermaid diagram types (stateDiagram vs stateDiagram-v2)', () => {
    const bad = structuredClone(minimalPlanFixture);
    bad.architectureLayers[0].stateManagementDiagram = 'stateDiagram-v2\n  [*] --> Ready\n  Ready --> [*]';

    bad.architectureLayers[0].componentTreeDiagram = 'stateDiagram\n  [*] --> A';
    const findings = runner.run(bad);
    const unsupported = findings.filter((f) => f.path.endsWith('componentTreeDiagram'));
    expect(unsupported.length).toBeGreaterThan(0);
    expect(unsupported[0].severity).toBe('error');
    expect(unsupported[0].message).toMatch(/unsupported type/i);
  });

  it('flags TDD minimum violations', () => {
    const bad = structuredClone(minimalPlanFixture);
    bad.domains[0].components[0].tddSpec.unitTests = bad.domains[0].components[0].tddSpec.unitTests.slice(0, 1);
    const findings = runner.run(bad);
    const tdd = findings.find((f) => f.path.includes('unitTests'));
    expect(tdd).toBeTruthy();
    expect(tdd?.severity).toBe('error');
    expect(tdd?.message).toMatch(/minimum is 2/i);
  });

  it('flags unknown layer references', () => {
    const bad = structuredClone(minimalPlanFixture);
    bad.domains[0].layer = 'does-not-exist';
    const findings = runner.run(bad);
    const ref = findings.find((f) => f.path.includes('domains[') && f.path.includes('.layer'));
    expect(ref).toBeTruthy();
    expect(ref?.severity).toBe('error');
  });

  it('flags init directive on first line', () => {
    const bad = structuredClone(minimalPlanFixture);
    bad.systemOverview.c4.contextDiagram = '%%{init: {"theme": "dark"}}%%\nflowchart TD\nA-->B';
    const findings = runner.run(bad);
    const init = findings.find((f) => f.message.includes('theme override'));
    expect(init).toBeTruthy();
  });
});
