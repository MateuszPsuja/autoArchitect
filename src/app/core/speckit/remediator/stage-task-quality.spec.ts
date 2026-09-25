import { detectDuplicateDescriptions, detectParallelConflicts, runTaskQualityStage } from './stage-task-quality';
import { basePlanFixture, makeTask } from './__fixtures__/plan-fixture';

describe('stage-task-quality', () => {
  it('flags mega-tasks citing 3+ FRs', () => {
    const plan = basePlanFixture({
      agentTasks: [
        makeTask({
          id: 'T001',
          description: 'Covers FR-001, FR-002, FR-003 in one sweep.',
          acceptanceCriteria: ['Works for FR-001, FR-002, FR-003.'],
        }),
      ],
    });
    const out = runTaskQualityStage(plan);
    expect(out.some((f) => f.id === 'STAGE-4.1-MEGA-TASK-T001')).toBe(true);
  });

  it('flags vague adjectives inside AC', () => {
    const plan = basePlanFixture({
      agentTasks: [
        makeTask({
          id: 'T002',
          acceptanceCriteria: ['Response is fast and robust.'],
        }),
      ],
    });
    const out = runTaskQualityStage(plan);
    expect(out.some((f) => f.id === 'STAGE-4.5-VAGUE-AC-T002')).toBe(true);
  });

  it('detects [P] conflicts on overlapping file hints', () => {
    const conflicts = detectParallelConflicts([
      makeTask({ id: 'T003', title: '[P] A', fileHints: ['apps/api/x.ts'] }),
      makeTask({ id: 'T004', title: '[P] B', fileHints: ['apps/api/x.ts'] }),
    ]);
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0].a).toBe('T003');
    expect(conflicts[0].b).toBe('T004');
  });

  it('inserts an implementation task when a test-only task has no impl partner', () => {
    const plan = basePlanFixture({
      agentTasks: [
        makeTask({
          id: 'T-test',
          title: 'Author tests for Search feature',
          description: 'Write failing test first.',
          acceptanceCriteria: ['Test is red.'],
          fileHints: ['apps/api/search.ts'],
          userStoryIds: [],
        }),
      ],
    });
    const out = runTaskQualityStage(plan);
    expect(out.some((f) => f.id === 'STAGE-4.3-TEST-ONLY-T-test')).toBe(true);
  });

  it('flags two tasks with verbatim descriptions (§4.6)', () => {
    const tasks = [
      makeTask({ id: 'T-dup-1', description: 'Implement avatar cropping pipeline end-to-end.' }),
      makeTask({ id: 'T-dup-2', description: 'Implement avatar cropping pipeline end-to-end.' }),
    ];
    const out = detectDuplicateDescriptions(tasks);
    expect(out.length).toBe(1);
    expect(out[0].id).toContain('STAGE-4.6-DUPLICATE-DESCRIPTION');
    expect(out[0].severity).toBe('MEDIUM');
    const ids = out[0].message.match(/T-dup-\d/g);
    expect(ids?.length).toBe(2);
  });

  it('does not flag unique descriptions', () => {
    const out = detectDuplicateDescriptions([
      makeTask({ id: 'T-u-1', description: 'Unique task one.' }),
      makeTask({ id: 'T-u-2', description: 'Unique task two.' }),
    ]);
    expect(out.length).toBe(0);
  });
});
