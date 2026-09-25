import { TestBed } from '@angular/core/testing';
import { RemediatorService } from './remediator.service';
import { basePlanFixture } from './__fixtures__/plan-fixture';

describe('RemediatorService', () => {
  let svc: RemediatorService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(RemediatorService);
  });

  it('runs all generation stages in order §1 → §7', () => {
    const plan = basePlanFixture({
      successCriteria: [
        { id: 'SC-001', text: 'p95 latency under 200ms', kind: 'latency', latencyTargetMs: 200 },
      ],
      functionalRequirements: [
        { id: 'FR-SEC-001', text: 'Secrets are stored in an encrypted vault.', needsClarification: false },
      ],
    });
    const report = svc.runGenerationPass(plan);
    expect(report.findings.length).toBeGreaterThan(0);
    const ids = report.findings.map((f) => f.id);
    expect(ids.some((id) => id.startsWith('STAGE-1.1'))).toBe(true);
    expect(ids.some((id) => id.startsWith('STAGE-1.2'))).toBe(true);
    expect(ids.some((id) => id.startsWith('STAGE-3.1'))).toBe(true);
    expect(ids.some((id) => id.startsWith('STAGE-3.2'))).toBe(true);
  });

  it('applies plan patches via applyGenerationPatches', () => {
    const plan = basePlanFixture();
    const fakeFinding = {
      id: 'TEST-1',
      severity: 'MEDIUM' as const,
      message: 'synth',
      fix: {
        kind: 'plan-patch' as const,
        payload: {
          functionalRequirements: [
            { id: 'FR-NEW-001', text: 'New requirement', needsClarification: true },
          ],
        },
      },
    };
    const report = { findings: [fakeFinding], applied: [fakeFinding], skipped: [] };
    const mutated = svc.applyGenerationPatches(plan, report);
    expect(mutated).not.toBe(plan);
    expect(mutated.functionalRequirements.length).toBe(plan.functionalRequirements.length + 1);
  });

  it('runs an export pass that rewrites provider variants in the draft', () => {
    const plan = basePlanFixture();
    const draft = [{ path: 'spec.md', content: 'claude handles the chat.' }];
    const result = svc.runExportPass(plan, draft);
    expect(result.files[0].content).toContain('Anthropic');
  });
});
