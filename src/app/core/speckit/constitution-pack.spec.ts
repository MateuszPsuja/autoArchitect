import { ARTICLES, synthesiseConstitutionTasks } from './constitution-pack';
import { BoundedContext, Plan } from '../plan.schema';

const fixturePlan = (contexts: BoundedContext[]): Plan => {
  const base = {
    meta: {
      title: 'fixture',
      summary: 'fixture',
      generatedAt: '2026-01-01T00:00:00Z',
      model: 'test',
      featureNumber: 1,
      featureSlug: 'fixture',
    },
    systemOverview: {
      purpose: 'fixture',
      context: 'fixture',
      keyActors: [],
      constraints: [],
      nfrs: [],
      c4: {
        contextDiagram: 'flowchart\n  A',
        containerDiagram: 'flowchart\n  A',
      },
    },
    architectureLayers: [
      {
        id: 'backend',
        name: 'backend',
        description: 'fixture',
        techStack: ['TypeScript 5'],
        patterns: ['Clean'],
        mermaidDiagram: 'flowchart\n  A',
        directoryStructure: [{ path: 'apps/api', description: 'api', agentInstructions: ['a', 'b', 'c'] }],
      },
    ],
    domains: [],
    userStories: [],
    functionalRequirements: [],
    successCriteria: [],
    workflows: [],
    adrs: [],
    agentTasks: [],
    refinementChats: [],
  };
  return { ...base, boundedContexts: contexts } as Plan;
};

describe('constitution-pack', () => {
  it('exposes the 9 articles in numeric order with stable titles', () => {
    expect(ARTICLES.map((a) => a.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(ARTICLES[1].title).toBe('CLI Interface');
    expect(ARTICLES[4].title).toBe('Observability');
  });

  it('emits Article 2 tasks per bounded context + a composer', () => {
    const plan = fixturePlan([
      {
        id: 'avatar',
        name: 'avatar',
        description: 'avatar context',
        layer: 'backend',
        ubiquitousLanguage: { avatar: 'identity' },
      },
      {
        id: 'transcript',
        name: 'transcript',
        description: 'transcript context',
        layer: 'backend',
        ubiquitousLanguage: { transcript: 'history' },
      },
    ]);
    const tasks = synthesiseConstitutionTasks(plan);
    const article2 = tasks.filter((t) => t.constitutionArticle === 2);
    expect(article2.length).toBe(2 * 3 + 1);
    expect(article2.some((t) => t.title.includes('composer'))).toBe(true);
    expect(article2.some((t) => t.title.includes('avatar-bootstrap-avatar'))).toBe(true);
  });

  it('emits Article 4 integration tasks per provider adapter', () => {
    const tasks = synthesiseConstitutionTasks(fixturePlan([]));
    const article4 = tasks.filter((t) => t.constitutionArticle === 4);
    const adapters = ['minimaxLlm', 'minimaxStt', 'minimaxTts', 'minimaxImage', 'minimaxVoiceClone'];
    for (const a of adapters) {
      expect(article4.some((t) => t.title === `Vitest integration spec for ${a}`)).toBe(true);
      expect(article4.some((t) => t.title === `pytest integration spec for ${a}`)).toBe(true);
    }
    expect(article4.some((t) => t.title === 'CI integration gate')).toBe(true);
    expect(article4.some((t) => t.title === 'Integration coverage matrix')).toBe(true);
  });

  it('emits Article 5 observability tasks (logging, metrics, dashboard, wire-up)', () => {
    const tasks = synthesiseConstitutionTasks(fixturePlan([]));
    const article5 = tasks.filter((t) => t.constitutionArticle === 5);
    expect(article5.some((t) => t.title === 'Structured logging contract')).toBe(true);
    expect(article5.some((t) => t.title === 'Local observability dashboard')).toBe(true);
    expect(article5.some((t) => t.title === 'Wire observability into FastAPI sidecar')).toBe(true);
    expect(article5.some((t) => t.title === 'Wire observability into Angular SPA')).toBe(true);
    for (const metric of ['turn_latency_ms', 'stt_latency_ms', 'tts_first_byte_ms', 'memory_recall_latency_ms']) {
      expect(article5.some((t) => t.title === `Metrics emitter for ${metric}`)).toBe(true);
    }
  });
});
