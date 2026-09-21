import { TestBed } from '@angular/core/testing';
import { ArchitectureLayer, Plan } from './plan.schema';
import { AuditFinding } from './audit-runner.service';
import { LocalAuditFixer } from './local-audit-fixer.service';
import { minimalPlanFixture } from '../testing/fixtures';

function finding(
  path: string,
  message = 'test',
  severity: 'error' | 'warning' = 'error',
): AuditFinding {
  return { path, message, fix: 'fix-me', severity };
}

describe('LocalAuditFixer', () => {
  let fixer: LocalAuditFixer;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    fixer = TestBed.inject(LocalAuditFixer);
  });

  it('rewrites an unsupported Mermaid diagram type to a safe fallback', () => {
    const plan: Plan = {
      ...minimalPlanFixture,
      architectureLayers: minimalPlanFixture.architectureLayers.map((layer: ArchitectureLayer) => ({
        ...layer,
        mermaidDiagram: 'stateDiagram\n  [*] --> idle',
      })),
    };
    const findings = [
      finding(
        `architectureLayers[${minimalPlanFixture.architectureLayers[0].id}].mermaidDiagram`,
        "Diagram uses unsupported type 'statediagram'.",
      ),
    ];
    const result = fixer.tryFixInPlace(plan, findings);
    expect(result.fixedPaths).toEqual(findings.map((f) => f.path));
    const patchedDiagram = result.plan.architectureLayers[0].mermaidDiagram.split('\n', 1)[0];
    expect(patchedDiagram).toMatch(/flowchart|graph/);
  });

  it('rewrites an unsupported diagram in systemOverview.boundedContextMap', () => {
    const plan: Plan = {
      ...minimalPlanFixture,
      systemOverview: {
        ...minimalPlanFixture.systemOverview,
        boundedContextMap: 'C4Context\n  Person(a)',
      },
    };
    const result = fixer.tryFixInPlace(plan, [
      finding('systemOverview.boundedContextMap', "Diagram uses unsupported type 'c4context'."),
    ]);
    expect(result.fixedPaths).toEqual(['systemOverview.boundedContextMap']);
    const firstLine = result.plan.systemOverview.boundedContextMap?.split('\n', 1)[0] ?? '';
    expect(firstLine).toMatch(/flowchart|graph/);
  });

  it('strips %%{init:}%% directives and keeps the rest of the diagram', () => {
    const plan: Plan = {
      ...minimalPlanFixture,
      architectureLayers: minimalPlanFixture.architectureLayers.map((layer: ArchitectureLayer) => ({
        ...layer,
        mermaidDiagram: '%%{init: {"theme": "dark"}}%%\nflowchart TD\n  A-->B',
      })),
    };
    const result = fixer.tryFixInPlace(plan, [
      finding(
        `architectureLayers[${minimalPlanFixture.architectureLayers[0].id}].mermaidDiagram`,
        'Diagram begins with a theme override directive.',
      ),
    ]);
    expect(result.fixedPaths).toEqual([
      `architectureLayers[${minimalPlanFixture.architectureLayers[0].id}].mermaidDiagram`,
    ]);
    expect(result.plan.architectureLayers[0].mermaidDiagram).not.toContain('%%{init');
  });

  it('returns {changed: false} without throwing for an architectureLayer id that does not exist in the plan', () => {





    const result = fixer.tryFixInPlace(minimalPlanFixture, [
      finding('architectureLayers[does-not-exist].mermaidDiagram', 'irrelevant'),
    ]);
    expect(result.fixedPaths).toEqual([]);
    expect(result.plan).toBe(minimalPlanFixture);
  });

  it('returns the original plan when no findings match known paths', () => {
    const result = fixer.tryFixInPlace(minimalPlanFixture, [finding('unknown.path', 'irrelevant')]);
    expect(result.fixedPaths).toEqual([]);
    expect(result.plan).toBe(minimalPlanFixture);
  });

  it('is idempotent — applying twice produces the same result as once', () => {
    const plan: Plan = {
      ...minimalPlanFixture,
      architectureLayers: minimalPlanFixture.architectureLayers.map((layer: ArchitectureLayer) => ({
        ...layer,
        mermaidDiagram: 'stateDiagram\n  [*] --> idle',
      })),
    };
    const findings = [
      finding(`architectureLayers[${minimalPlanFixture.architectureLayers[0].id}].mermaidDiagram`),
    ];
    const first = fixer.tryFixInPlace(plan, findings);
    const second = fixer.tryFixInPlace(first.plan, findings);



    expect(second.fixedPaths).toEqual([]);
    expect(second.plan).toBe(first.plan);
  });

  it('passes common sequenceDiagram chars through without an LLM call', () => {





    const unsafeDiagram = 'sequenceDiagram\n  participant A\n  A->>B: GET /users/{id}?active=true';
    const plan: Plan = {
      ...minimalPlanFixture,
      architectureLayers: minimalPlanFixture.architectureLayers.map((layer: ArchitectureLayer) => ({
        ...layer,
        dataFlowDiagram: unsafeDiagram,
      })),
    };
    const findings = [
      finding(
        `architectureLayers[${minimalPlanFixture.architectureLayers[0].id}].dataFlowDiagram`,
        'Parse error on line 3',
      ),
    ];
    const result = fixer.tryFixInPlace(plan, findings);
    expect(result.fixedPaths).toEqual(findings.map((f) => f.path));
    const patched = result.plan.architectureLayers[0].dataFlowDiagram ?? '';
    expect(patched).toContain('GET /users/{id}?active=true');
  });

  it('skips the unsafe-char patch when the diagram has no unsafe chars', () => {







    const safeDiagram = 'sequenceDiagram\nA->>B: hello world';
    const plan: Plan = {
      ...minimalPlanFixture,
      architectureLayers: minimalPlanFixture.architectureLayers.map((layer: ArchitectureLayer) => ({
        ...layer,
        dataFlowDiagram: safeDiagram,
      })),
    };
    const result = fixer.tryFixInPlace(plan, [
      finding(
        `architectureLayers[${minimalPlanFixture.architectureLayers[0].id}].dataFlowDiagram`,
        'irrelevant',
      ),
    ]);
    expect(result.plan.architectureLayers[0].dataFlowDiagram).toBe(safeDiagram);
  });
});

describe('LocalAuditFixer.tryFixSynthesised', () => {
  let fixer: LocalAuditFixer;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    fixer = TestBed.inject(LocalAuditFixer);
  });

  function synthAudit(
    entries: Array<{
      id: 'blueprint' | `techStack:${string}`;
      source: 'blueprint' | 'techStack';
      status: 'failed' | 'passed';
    }>,
  ): import('./diagram-audit.service').DiagramAuditReport {
    return {
      generatedAt: '2026-08-28T00:00:00.000Z',
      total: entries.length,
      passed: entries.filter((e) => e.status === 'passed').length,
      failed: entries.filter((e) => e.status === 'failed').length,
      skipped: 0,
      entries: entries.map((e) => ({
        location: { scope: 'synthesised', id: e.id, source: e.source },
        status: e.status,
      })),
      repaired: 0,
    };
  }

  it('returns no patches when the synthesised audit has no failures', async () => {
    const plan = minimalPlanFixture;
    const audit = synthAudit([{ id: 'blueprint', source: 'blueprint', status: 'passed' }]);
    const result = await fixer.tryFixSynthesised(plan, audit);
    expect(result.patches).toEqual([]);
  });

  it('does not emit a patch for the synthesised blueprint when normalisation is a no-op', async () => {







    const plan = minimalPlanFixture;
    const audit = synthAudit([{ id: 'blueprint', source: 'blueprint', status: 'failed' }]);
    const result = await fixer.tryFixSynthesised(plan, audit);
    expect(result.patches).toEqual([]);
  });

  it('does not emit a patch for a synthesised tech-stack entry when normalisation is a no-op', async () => {
    const plan = minimalPlanFixture;
    const layerId = plan.architectureLayers[0].id;
    const audit = synthAudit([
      { id: `techStack:${layerId}`, source: 'techStack', status: 'failed' },
    ]);
    const result = await fixer.tryFixSynthesised(plan, audit);
    expect(result.patches).toEqual([]);
  });

  it('returns a `patches` array even when no synthesised failures are reported', async () => {



    const plan = minimalPlanFixture;
    const nonSynthAudit: import('./diagram-audit.service').DiagramAuditReport = {
      generatedAt: '2026-08-28T00:00:00.000Z',
      total: 1,
      passed: 0,
      failed: 1,
      skipped: 0,
      entries: [
        {
          location: { scope: 'system', field: 'c4.contextDiagram' },
          status: 'failed',
        },
      ],
      repaired: 0,
    };
    const result = await fixer.tryFixSynthesised(plan, nonSynthAudit);
    expect(result.patches).toEqual([]);
  });

  it('skips synthesised entries whose layer id is not in the plan', async () => {
    const plan = minimalPlanFixture;
    const audit = synthAudit([
      { id: 'techStack:does-not-exist', source: 'techStack', status: 'failed' },
    ]);
    const result = await fixer.tryFixSynthesised(plan, audit);



    expect(result.patches).toEqual([]);
  });

  it('only emits patches whose re-normalised source actually parses', async () => {





    const plan = minimalPlanFixture;
    const audit = synthAudit([{ id: 'blueprint', source: 'blueprint', status: 'failed' }]);
    const result = await fixer.tryFixSynthesised(plan, audit);



    for (const patch of result.patches) {
      expect(patch.source.length).toBeGreaterThan(0);
    }
  });
});
