import { TestBed } from '@angular/core/testing';
import { AuditRunner } from './audit-runner.service';
import { minimalPlanFixture } from '../testing/fixtures';

describe('AuditRunner — Stage + Citation audits (Phase 4)', () => {
  let runner: AuditRunner;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    runner = TestBed.inject(AuditRunner);
  });

  it('runs Stage Audit against the merged plan and flags missing layer references', () => {
    const bad = structuredClone(minimalPlanFixture);
    bad.domains[0].layer = 'unknown-layer';
    const findings = runner.runStageAudit(bad);
    expect(findings.some((f) => f.path.includes('domains[core-planning].layer'))).toBe(true);
  });

  it('runs Citation Audit and flags broken workflow→domain refs', () => {
    const bad = structuredClone(minimalPlanFixture);
    bad.workflows[0].domainIds = ['does-not-exist'];
    const findings = runner.runCitationAudit(bad);
    expect(findings.some((f) => f.path.includes('workflows[') && f.path.includes('.domainIds'))).toBe(true);
  });

  it('the combined run() includes stage + citation findings', () => {
    const bad = structuredClone(minimalPlanFixture);
    bad.workflows[0].domainIds = ['does-not-exist'];
    const findings = runner.run(bad);
    expect(findings.some((f) => f.path.includes('workflows'))).toBe(true);
  });
});
