import { AgentTask, UserStory } from '../plan.schema';
import { crossReferenceLine, dedupKey, pickPrimaryStory } from './task-dedup';

const task = (over: Partial<AgentTask>): AgentTask => ({
  id: 'T001',
  title: 't',
  description: 'desc',
  acceptanceCriteria: ['a'],
  fileHints: ['apps/api/foo.ts'],
  userStoryIds: ['US001'],
  ...over,
});

describe('task-dedup', () => {
  it('dedupKey is stable across fileHints reordering', () => {
    const a = task({ fileHints: ['a', 'b', 'c'] });
    const b = task({ fileHints: ['c', 'a', 'b'] });
    expect(dedupKey(a)).toBe(dedupKey(b));
  });

  it('dedupKey changes when description changes', () => {
    expect(dedupKey(task({ description: 'foo' }))).not.toBe(dedupKey(task({ description: 'bar' })));
  });

  it('dedupKey normalises whitespace in description', () => {
    expect(dedupKey(task({ description: 'foo  bar' }))).toBe(dedupKey(task({ description: 'foo bar' })));
  });

  it('pickPrimaryStory prefers the userStoryIds intersection, lowest priority first', () => {
    const stories: UserStory[] = [
      { id: 'US002', title: 'b', priority: 'P2', description: '', whyThisPriority: '', independentTest: '', acceptanceScenarios: [], boundedContextIds: [] },
      { id: 'US001', title: 'a', priority: 'P1', description: '', whyThisPriority: '', independentTest: '', acceptanceScenarios: [], boundedContextIds: [] },
    ];
    expect(pickPrimaryStory(task({ userStoryIds: ['US002'] }), stories)).toBe('US002');
    expect(pickPrimaryStory(task({ userStoryIds: [] }), stories)).toBe('US001');
  });

  it('crossReferenceLine includes the primary id, story tag, and a 60-char snippet', () => {
    const line = crossReferenceLine(task({ id: 'T017', description: 'a'.repeat(120) }), 'T005', 'US001');
    expect(line).toContain('(ref T005)');
    expect(line).toContain('[US001]');
    expect(line).toContain('…');
  });
});
