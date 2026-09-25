import { runTraceabilityStage } from './stage-traceability';
import { basePlanFixture, makeTask } from './__fixtures__/plan-fixture';

describe('stage-traceability', () => {
  it('emits MissingFrRef when task AC has no FR reference', () => {
    const plan = basePlanFixture({
      agentTasks: [makeTask({ id: 'T-noref', description: 'No FR citations.', acceptanceCriteria: ['Behaves correctly.'] })],
    });
    const out = runTraceabilityStage(plan);
    expect(out.some((f) => f.id === 'STAGE-5.1-MISSING-FR-T-noref')).toBe(true);
  });

  it('emits WrongCite when FR-NNN does not exist', () => {
    const plan = basePlanFixture({
      agentTasks: [makeTask({ id: 'T-cite', description: 'Cites FR-DOES-NOT-EXIST', acceptanceCriteria: ['AC.'] })],
    });
    const out = runTraceabilityStage(plan);
    expect(out.some((f) => f.id.startsWith('STAGE-5.1-MISSING-FR-T-cite-FR-DOES-NOT-EXIST'))).toBe(true);
  });

  it('flags orphan FR with no referencing task (§5.4)', () => {
    const plan = basePlanFixture({
      functionalRequirements: [
        { id: 'FR-ORPHAN-001', text: 'Nobody references this.', needsClarification: false },
      ],
      agentTasks: [
        makeTask({ id: 'T-busy', description: 'Implements a different FR entirely.', acceptanceCriteria: ['Works.'] }),
      ],
    });
    const out = runTraceabilityStage(plan);
    expect(out.some((f) => f.id === 'STAGE-5.4-ORPHAN-FR-FR-ORPHAN-001')).toBe(true);
  });

  it('does not flag an FR that is referenced by at least one task', () => {
    const plan = basePlanFixture({
      functionalRequirements: [
        { id: 'FR-LINKED-001', text: 'Linked FR.', needsClarification: false },
      ],
      agentTasks: [
        makeTask({ id: 'T-cite-it', description: 'Cites FR-LINKED-001', acceptanceCriteria: ['AC.'] }),
      ],
    });
    const out = runTraceabilityStage(plan);
    expect(out.some((f) => f.id === 'STAGE-5.4-ORPHAN-FR-FR-LINKED-001')).toBe(false);
  });
});
