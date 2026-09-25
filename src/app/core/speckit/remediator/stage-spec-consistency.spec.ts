import { runSpecConsistencyStage } from './stage-spec-consistency';
import { basePlanFixture } from './__fixtures__/plan-fixture';

describe('stage-spec-consistency', () => {
  it('injects an offline contract when offline language appears and contract is null', () => {
    const plan = basePlanFixture({
      specKit: { offlineContract: null, keyEntities: [], patches: [] },
      systemOverview: { purpose: 'A local-first avatar studio.', context: 'C', keyActors: [], constraints: [], nfrs: [], c4: { contextDiagram: 'flowchart\n  A', containerDiagram: 'flowchart\n  A' } } as never,
    });
    const draft = 'We support offline mode for last-mile users.';
    const out = runSpecConsistencyStage(plan, draft);
    expect(out.some((f) => f.id === 'STAGE-2.1-OFFLINE-CONTRACT-MISSING')).toBe(true);
  });

  it('flags two different scale numbers on a single line', () => {
    const plan = basePlanFixture();
    const draft = '| Scale/Scope | 1000 users scaling to 100 000 users |';
    const out = runSpecConsistencyStage(plan, draft);
    expect(out.some((f) => f.id === 'STAGE-2.2-SCALE-SCOPE-NORMALISED')).toBe(true);
  });

  it('reports placeholders in the draft', () => {
    const plan = basePlanFixture();
    const out = runSpecConsistencyStage(plan, 'See [TODO: clarify].');
    expect(out.some((f) => f.id === 'STAGE-2.3-PLACEHOLDER-REMAINING')).toBe(true);
  });
});
