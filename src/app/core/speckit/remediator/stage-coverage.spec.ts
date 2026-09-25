import { runCoverageStage } from './stage-coverage';
import { basePlanFixture } from './__fixtures__/plan-fixture';

describe('stage-coverage', () => {
  it('synthesises harness tasks for measurable SCs that lack them', () => {
    const plan = basePlanFixture({
      successCriteria: [
        {
          id: 'SC-001',
          text: 'p95 latency under 200ms',
          kind: 'latency',
          latencyTargetMs: 200,
        },
      ],
    });
    const out = runCoverageStage(plan);
    expect(out.some((f) => f.id === 'STAGE-3.1-SC-HARNESS-SC-001')).toBe(true);
  });

  it('emits cross-cutting findings for FR-SEC-*** without a task', () => {
    const plan = basePlanFixture({
      functionalRequirements: [
        { id: 'FR-SEC-001', text: 'Secrets are stored in an encrypted vault.', needsClarification: false },
      ],
    });
    const out = runCoverageStage(plan);
    expect(out.some((f) => f.id === 'STAGE-3.2-CROSSCUTTING-FR-SEC-001')).toBe(true);
  });

  it('replaces (ref USxxx) ghost tasks with a story-driven task', () => {
    const plan = basePlanFixture({
      agentTasks: [
        {
          id: 'T-ghost-1',
          title: 'Cover US001',
          description: '(ref US001)',
          acceptanceCriteria: ['Satisfies US001'],
          fileHints: ['apps/api/cover.ts'],
          userStoryIds: ['US001'],
        },
      ],
      userStories: [
        {
          id: 'US001',
          title: 'Avatar capture',
          priority: 'P1',
          description: 'User captures an avatar frame.',
          whyThisPriority: 'MVP',
          independentTest: 'Avatar frame is saved when triggered.',
          acceptanceScenarios: [
            { id: 'AS-001', given: 'a captured frame', when: 'submitted', then: 'frame is persisted' },
          ],
          boundedContextIds: [],
        },
      ],
    });
    const out = runCoverageStage(plan);
    expect(out.some((f) => f.id.startsWith('STAGE-3.3-GHOST-TASK-T-ghost-1'))).toBe(true);
  });

  it('installs an import-linter task when a domain isolation rule exists', () => {
    const plan = basePlanFixture({
      architectureLayers: [
        {
          id: 'backend',
          name: 'backend',
          description: 'fixture',
          techStack: ['TS'],
          patterns: ['Clean'],
          mermaidDiagram: 'flowchart\n  A',
          directoryStructure: [
            { path: 'apps/api', description: 'api', agentInstructions: ['a', 'b', 'c'] },
          ],
          constitutionCheck: ['domain layer has zero infrastructure imports — domain forbid infrastructure'],
        },
      ],
    });
    const out = runCoverageStage(plan);
    expect(out.some((f) => f.id.startsWith('STAGE-3.4-IMPORT-LINTER-'))).toBe(true);
  });
});
