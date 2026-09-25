import { runConstitutionStage } from './stage-constitution';
import { basePlanFixture } from './__fixtures__/plan-fixture';

describe('stage-constitution', () => {
  it('emits no findings when Article 3 has named framework scopes and a matching task exists', () => {
    const plan = basePlanFixture({
      agentTasks: [
        {
          id: 'T-test-1',
          title: 'Install Vitest for the api layer',
          description: 'Vitest covers the api layer.',
          acceptanceCriteria: ['Vitest passes for api scope.'],
          fileHints: ['apps/api/'],
          userStoryIds: [],
          constitutionArticle: 3,
        },
        {
          id: 'T-test-2',
          title: 'Install Vitest for the unit layer',
          description: 'Vitest covers the unit layer.',
          acceptanceCriteria: ['Vitest passes for unit scope.'],
          fileHints: ['apps/api/'],
          userStoryIds: [],
          constitutionArticle: 3,
        },
        {
          id: 'T-test-3',
          title: 'Install Vitest for the integration layer',
          description: 'Vitest covers the integration layer.',
          acceptanceCriteria: ['Vitest passes for integration scope.'],
          fileHints: ['apps/api/'],
          userStoryIds: [],
          constitutionArticle: 3,
        },
        {
          id: 'T-test-4',
          title: 'Install Vitest for the e2e layer',
          description: 'Vitest covers the e2e layer.',
          acceptanceCriteria: ['Vitest passes for e2e scope.'],
          fileHints: ['apps/api/'],
          userStoryIds: [],
          constitutionArticle: 3,
        },
      ],
    });
    const out = runConstitutionStage(plan);
    expect(out.find((f) => f.id.startsWith('STAGE-1.1'))).toBeUndefined();
  });

  it('inserts a task when framework coverage is missing', () => {
    const plan = basePlanFixture();
    const out = runConstitutionStage(plan);
    const ids = out.map((f) => f.id);
    expect(ids.some((id) => id.startsWith('STAGE-1.1-FRAMEWORK-COVERAGE'))).toBe(true);
  });

  it('inserts versioning tasks when Article 6 mandates SemVer/changelog', () => {
    const plan = basePlanFixture();
    const out = runConstitutionStage(plan);
    const ids = out.map((f) => f.id);
    expect(ids).toContain('STAGE-1.2-VERSIONING-MISSING-version-bump');
    expect(ids).toContain('STAGE-1.2-VERSIONING-MISSING-changelog-init');
    expect(ids).toContain('STAGE-1.2-VERSIONING-MISSING-release-notes');
  });

  it('emits an ADR-override finding when an Article 8 primitive is rejected by a layer', () => {
    const plan = basePlanFixture({
      architectureLayers: [
        {
          id: 'backend',
          name: 'backend',
          description: 'fixture',
          techStack: ['TypeScript 5'],
          patterns: ['Clean'],
          mermaidDiagram: 'flowchart\n  A',
          directoryStructure: [
            { path: 'apps/api', description: 'api', agentInstructions: ['a', 'b', 'c'] },
          ],
          technicalContext: {
            storage: 'N/A',
            targetPlatform: 'node',
            performanceGoals: '<200ms p95',
            constraints: 'We reject HttpClient in favor of a custom transport.',
            scaleScope: '50 users',
          },
        },
      ],
    });
    const out = runConstitutionStage(plan);
    expect(out.some((f) => f.id.startsWith('STAGE-1.3-ANTI-ABSTRACTION-OVERRIDE-'))).toBe(true);
  });
});
