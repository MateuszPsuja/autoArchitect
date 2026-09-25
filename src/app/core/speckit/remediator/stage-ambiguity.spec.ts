import { runAmbiguityStage } from './stage-ambiguity';
import { basePlanFixture } from './__fixtures__/plan-fixture';

describe('stage-ambiguity', () => {
  it('flags vague adjectives in stories', () => {
    const plan = basePlanFixture({
      userStories: [
        {
          id: 'US001',
          title: 'Quick lookup',
          priority: 'P1',
          description: 'A fast lookup should feel intuitive.',
          whyThisPriority: 'MVP',
          independentTest: 'Lookup responds within 200ms.',
          acceptanceScenarios: [
            { id: 'AS-001', given: 'a query', when: 'submitted', then: 'result returned' },
          ],
          boundedContextIds: [],
        },
      ],
    });
    const out = runAmbiguityStage(plan);
    expect(out.some((f) => f.id === 'STAGE-6.1-VAGUE-US-US001')).toBe(true);
  });

  it('flags disjunction in stories', () => {
    const plan = basePlanFixture({
      userStories: [
        {
          id: 'US002',
          title: 'Pick a mode',
          priority: 'P1',
          description: 'Either dark mode or light mode is acceptable.',
          whyThisPriority: 'MVP',
          independentTest: 'Mode renders.',
          acceptanceScenarios: [
            { id: 'AS-002', given: 'a setting', when: 'toggled', then: 'mode changes' },
          ],
          boundedContextIds: [],
        },
      ],
    });
    const out = runAmbiguityStage(plan);
    expect(out.some((f) => f.id === 'STAGE-6.2-MODE-DISJUNCTION-US002')).toBe(true);
  });
});
