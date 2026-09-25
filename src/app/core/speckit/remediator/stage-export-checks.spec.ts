import {
  runExportChecks,
  scanChecklistConsistency,
  scanEmptyPhases,
  scanForbiddenTokens,
  scanUnexpandedMarkers,
} from './stage-export-checks';
import { basePlanFixture, makeConstitution, makeTask } from './__fixtures__/plan-fixture';

function file(path: string, content: string): { path: string; content: string } {
  return { path, content };
}

describe('stage-export-checks (Stage B)', () => {
  describe('scanUnexpandedMarkers', () => {
    it('flags a leaked (ref US001) in tasks.md body', () => {
      const tasksBody = [
        '# Tasks',
        '',
        '## User Story US001 — Cover avatar',
        '',
        '- [ ] T001 (ref US001) Cover avatar cropping.',
        '',
        '## Notes',
        '',
        '- (ref US001) is documented here but should not appear in body.',
      ].join('\n');
      const out = scanUnexpandedMarkers(tasksBody);
      expect(out.length).toBe(1);
      expect(out[0].id).toMatch(/STAGE-EX-UNEXPANDED-MARKER/);
      expect(out[0].severity).toBe('HIGH');
    });

    it('does not flag the legend paragraph under "## Notes"', () => {
      const tasksBody = [
        '# Tasks',
        '',
        '## User Story US001 — Cover avatar',
        '',
        '- [ ] T001 Implement avatar cropping.',
        '',
        '## Notes',
        '',
        '- `(ref US001)` `(ghost)` `(synth)` markers flag synthesised tasks.',
      ].join('\n');
      expect(scanUnexpandedMarkers(tasksBody)).toEqual([]);
    });

    it('flags (synth) leaks in the body', () => {
      const tasksBody = [
        '# Tasks',
        '',
        '## User Story US001',
        '',
        '- [ ] T001 (synth) filler task description.',
        '',
        '## Notes',
        '',
        '- nothing here.',
      ].join('\n');
      const out = scanUnexpandedMarkers(tasksBody);
      expect(out.length).toBe(1);
      expect(out[0].id).toMatch(/STAGE-EX-UNEXPANDED-MARKER/);
    });
  });

  describe('scanEmptyPhases', () => {
    it('flags a US phase with no checkbox tasks', () => {
      const tasksBody = [
        '# Tasks',
        '',
        '## User Story US002 — Empty phase',
        '',
        '> No tasks yet for this story.',
        '',
        '## User Story US003 — Non-empty',
        '',
        '- [ ] T007 Real task.',
        '',
      ].join('\n');
      const out = scanEmptyPhases(tasksBody);
      expect(out.some((f) => f.id === 'STAGE-EX-EMPTY-PHASE-US002')).toBe(true);
      expect(out.some((f) => f.id === 'STAGE-EX-EMPTY-PHASE-US003')).toBe(false);
    });

    it('returns empty when there are no user story phases', () => {
      expect(scanEmptyPhases('# Tasks\n- nothing here\n')).toEqual([]);
    });
  });

  describe('scanForbiddenTokens', () => {
    it('flags < and > tokens embedded in spec.md', () => {
      const files = [
        file('001-foo/spec.md', 'Use <placeholder> here.\n\nAnd ??? for unknown.\n'),
        file('001-foo/tasks.md', '- [ ] T1 Clean task.'),
      ];
      const out = scanForbiddenTokens(files);
      const ids = out.map((f) => f.id);
      expect(ids.some((id) => id.startsWith('STAGE-EX-FORBIDDEN-TOKEN-001-foo-spec-md'))).toBe(true);
      expect(out.length).toBeGreaterThan(1);
    });

    it('flags "regenerate to populate" in constitution', () => {
      const files = [
        file(
          '.specify/memory/constitution.md',
          '> Regulate the plan to populate the project constitution.',
        ),
      ];
      const out = scanForbiddenTokens(files);
      expect(
        out.some((f) =>
          f.id.startsWith('STAGE-EX-FORBIDDEN-TOKEN-specify-memory-constitution-md'),
        ),
      ).toBe(true);
    });

    it('does not flag clean markdown', () => {
      const files = [file('001-foo/spec.md', 'Crisp spec content here.')];
      expect(scanForbiddenTokens(files)).toEqual([]);
    });
  });

  describe('scanChecklistConsistency', () => {
    it('flags agent-task count mismatch', () => {
      const checklistMd = `- [x] CHK001 All 7 agent task(s) carry a non-empty \`acceptanceCriteria[]\`.`;
      const plan = basePlanFixture({ agentTasks: [makeTask({ id: 'T-a' }), makeTask({ id: 'T-b' })] });
      const out = scanChecklistConsistency(plan, checklistMd);
      expect(out.some((f) => f.id === 'STAGE-EX-CHECKLIST-AGENT-TASKS-COUNT')).toBe(true);
    });

    it('flags Article MUST without enforcement task', () => {
      const plan = basePlanFixture({
        constitution: {
          ...makeConstitution(),
          articles: makeConstitution().articles.map((a) =>
            a.articleNumber === 5
              ? { ...a, content: 'MUST export traces with structured logs.' }
              : a,
          ),
        },
        agentTasks: [],
      });
      const out = scanChecklistConsistency(plan, '');
      expect(
        out.some((f) => f.id === 'STAGE-EX-CONSTITUTION-MUST-UNENFORCED-A5'),
      ).toBe(true);
    });

    it('does not flag when at least one task carries the article', () => {
      const plan = basePlanFixture({
        constitution: makeConstitution(),
        agentTasks: [
          makeTask({ id: 'T-art-3', constitutionArticle: 3, description: 'Enforces article 3.' }),
        ],
      });
      const out = scanChecklistConsistency(plan, '');
      expect(
        out.some((f) => f.id === 'STAGE-EX-CONSTITUTION-MUST-UNENFORCED-A3'),
      ).toBe(false);
    });
  });

  describe('runExportChecks orchestrator', () => {
    it('aggregates multiple check categories from a single file set', () => {
      const tasksMd = [
        '# Tasks',
        '',
        '## User Story US009 — Empty',
        '',
        '> nothing yet',
        '',
        '## Notes',
        '',
        '- nothing important',
      ].join('\n');
      const files = [
        file('001-demo/tasks.md', tasksMd),
        file('001-demo/spec.md', 'has ??? token here.'),
      ];
      const plan = basePlanFixture();
      const out = runExportChecks(plan, files);
      expect(out.some((f) => f.id === 'STAGE-EX-EMPTY-PHASE-US009')).toBe(true);
      expect(out.some((f) => f.id.startsWith('STAGE-EX-FORBIDDEN-TOKEN-001-demo-spec-md'))).toBe(true);
    });

    it('returns no findings on a fully clean render', () => {
      const tasksMd = [
        '# Tasks',
        '',
        '## User Story US001 — Real',
        '',
        '- [ ] T001 Implement avatar endpoint.',
        '',
        '## Notes',
        '',
        '- nothing.',
      ].join('\n');
      const files = [
        file('001-demo/tasks.md', tasksMd),
        file('001-demo/spec.md', 'Clean markdown here.'),
      ];
      const out = runExportChecks(basePlanFixture({ agentTasks: [makeTask({ id: 'T-art-3', constitutionArticle: 3, description: 'Enforces article 3.' })] }), files);
      expect(out.length).toBe(0);
    });
  });
});
