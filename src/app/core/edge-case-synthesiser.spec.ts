import {
  CANONICAL_LIFTED_FR_IDS,
  liftEdgeCasesToFunctionalRequirements,
  synthetiseNegativeAcceptance,
  synthesiseEdgeCases,
} from './edge-case-synthesiser';
import { Plan } from './plan.schema';

describe('synthesiseEdgeCases()', () => {
  it('returns an empty list for a plan with no constraints', () => {
    const plan: Plan = {
      meta: {
        title: 'x',
        summary: 'y',
        generatedAt: '2026-01-01T00:00:00.000Z',
        model: 'test',
        featureNumber: 1,
        featureSlug: 'x',
      },
      systemOverview: {
        purpose: 'p',
        context: 'c',
        keyActors: [],
        constraints: [],
        nfrs: [],
        c4: { contextDiagram: 'graph LR\nA-->B', containerDiagram: 'graph LR\nA-->B' },
      },
      boundedContexts: [
        {
          id: 'bc',
          name: 'BC',
          description: 'd',
          layer: 'backend',
          ubiquitousLanguage: { Plan: 'A plan.' },
        },
      ],
      architectureLayers: [],
      domains: [],
    } as unknown as Plan;

    expect(synthesiseEdgeCases(plan)).toEqual([]);
  });

  it('emits one bullet per non-trivial constraint clause', () => {
    const plan = {
      meta: {
        title: 'Multi-tenant SaaS',
        summary: 'Multi-tenant',
        generatedAt: '2026-01-01T00:00:00.000Z',
        model: 'test',
        featureNumber: 1,
        featureSlug: 'saas',
      },
      systemOverview: {
        purpose: 'p',
        context: 'c',
        keyActors: [],
        constraints: ['p95 latency under 200ms at the 99th percentile'],
        nfrs: ['Auth tokens expire after 30 minutes'],
        c4: { contextDiagram: 'graph LR\nA-->B', containerDiagram: 'graph LR\nA-->B' },
      },
      boundedContexts: [
        {
          id: 'bc',
          name: 'BC',
          description: 'd',
          layer: 'backend',
          ubiquitousLanguage: { Plan: 'A plan.' },
        },
      ],
      architectureLayers: [
        {
          id: 'backend',
          name: 'Backend',
          description: 'd',
          techStack: ['NestJS'],
          patterns: ['Clean'],
          mermaidDiagram: 'graph LR\nA-->B',
          directoryStructure: [
            {
              path: 'backend',
              description: 'd',
              agentInstructions: ['a', 'b', 'c'],
            },
          ],
          technicalContext: {
            storage: 'pg',
            targetPlatform: 'linux',
            performanceGoals: 'p95 < 200ms',
            constraints: 'Domain has no framework imports',
            scaleScope: '5k',
          },
          constitutionCheck: ['Strict TypeScript', 'Standalone components only'],
        },
      ],
      domains: [],
    } as unknown as Plan;

    const bullets = synthesiseEdgeCases(plan);
    expect(bullets.length).toBeGreaterThan(0);
    expect(bullets.length).toBeLessThanOrEqual(8);

    expect(bullets.some((b) => /p95 latency/i.test(b))).toBe(true);
    expect(bullets.some((b) => /multi-tenant/i.test(b))).toBe(true);
    expect(bullets.some((b) => /auth/i.test(b))).toBe(true);
  });

  it('caps output at 8 bullets', () => {
    const plan = {
      meta: {
        title: 'SaaS',
        summary: 'multi-tenant offline',
        generatedAt: '2026-01-01T00:00:00.000Z',
        model: 'test',
        featureNumber: 1,
        featureSlug: 'saas',
      },
      systemOverview: {
        purpose: 'p',
        context: 'c',
        keyActors: [],
        constraints: [
          'p95 must remain under 200ms at 99th percentile',
          'retries use exponential backoff with jitter',
          'back-pressure must shed load before upstream fills memory',
          'offline reads hit the local cache',
          'time skew is handled via monotonic server timestamps',
          'unicode payloads trimmed at grapheme cluster boundaries',
          'large uploads must stream in chunks',
        ],
        nfrs: ['auth tokens expire after 30m'],
        c4: { contextDiagram: 'graph LR\nA-->B', containerDiagram: 'graph LR\nA-->B' },
      },
      boundedContexts: [
        {
          id: 'bc',
          name: 'BC',
          description: 'd',
          layer: 'backend',
          ubiquitousLanguage: { Plan: 'A plan.' },
        },
      ],
      architectureLayers: [],
      domains: [],
    } as unknown as Plan;

    const bullets = synthesiseEdgeCases(plan);
    expect(bullets.length).toBeLessThanOrEqual(8);
  });

  it('deduplicates repeated clauses', () => {
    const plan = {
      meta: {
        title: 'x',
        summary: 'y',
        generatedAt: '2026-01-01T00:00:00.000Z',
        model: 'test',
        featureNumber: 1,
        featureSlug: 'x',
      },
      systemOverview: {
        purpose: 'p',
        context: 'c',
        keyActors: [],
        constraints: ['p95 latency under 200ms', 'p95 latency under 200ms'],
        nfrs: [],
        c4: { contextDiagram: 'graph LR\nA-->B', containerDiagram: 'graph LR\nA-->B' },
      },
      boundedContexts: [
        {
          id: 'bc',
          name: 'BC',
          description: 'd',
          layer: 'backend',
          ubiquitousLanguage: { Plan: 'A plan.' },
        },
      ],
      architectureLayers: [],
      domains: [],
    } as unknown as Plan;

    const bullets = synthesiseEdgeCases(plan);
    const matches = bullets.filter((b) => /p95 latency/i.test(b));
    expect(matches.length).toBe(1);
  });

  describe('liftEdgeCasesToFunctionalRequirements', () => {
    it('returns no FRs when no trigger phrase matches', () => {
      const plan = {
        meta: {
          title: 'x',
          summary: 'y',
          generatedAt: '2026-01-01T00:00:00.000Z',
          model: 'test',
          featureNumber: 1,
          featureSlug: 'x',
        },
        systemOverview: {
          purpose: 'p',
          context: 'c',
          keyActors: [],
          constraints: [],
          nfrs: [],
          c4: { contextDiagram: 'A', containerDiagram: 'A' },
        },
        boundedContexts: [],
        architectureLayers: [],
        domains: [],
        functionalRequirements: [],
      } as unknown as Plan;

      expect(liftEdgeCasesToFunctionalRequirements(plan, [])).toEqual([]);
    });

    it('emits all six canonical FRs when every trigger phrase is present', () => {
      const plan = {
        meta: {
          title: 'no secrets no codegen strict TS strict python framework-free read-only',
          summary: '',
          generatedAt: '2026-01-01T00:00:00.000Z',
          model: 'test',
          featureNumber: 1,
          featureSlug: 'x',
        },
        systemOverview: {
          purpose: 'p',
          context: 'no secrets, mypy --strict, codegen:check',
          keyActors: [],
          constraints: [
            'Domain has no framework imports',
            'Generated bindings are read-only',
          ],
          nfrs: ['Strict TypeScript, no any'],
          c4: { contextDiagram: 'A', containerDiagram: 'A' },
        },
        boundedContexts: [],
        architectureLayers: [],
        domains: [],
        functionalRequirements: [],
      } as unknown as Plan;

      const lifted = liftEdgeCasesToFunctionalRequirements(plan, []);
      const ids = lifted.map((fr) => fr.id).sort();
      expect(ids).toEqual([...CANONICAL_LIFTED_FR_IDS].sort());
    });

    it('never duplicates an existing FR id already present on the plan', () => {
      const plan = {
        meta: {
          title: 'no secrets strict TS',
          summary: '',
          generatedAt: '2026-01-01T00:00:00.000Z',
          model: 'test',
          featureNumber: 1,
          featureSlug: 'x',
        },
        systemOverview: {
          purpose: 'p',
          context: 'c',
          keyActors: [],
          constraints: [],
          nfrs: ['Strict TypeScript, no any'],
          c4: { contextDiagram: 'A', containerDiagram: 'A' },
        },
        boundedContexts: [],
        architectureLayers: [],
        domains: [],
        functionalRequirements: [
          { id: 'FR-TS-001', text: 'existing', needsClarification: false },
        ],
      } as unknown as Plan;

      const lifted = liftEdgeCasesToFunctionalRequirements(plan, []);
      const ids = lifted.map((fr) => fr.id);
      expect(ids).not.toContain('FR-TS-001');
      expect(ids).toContain('FR-SEC-001');
    });
  });

  describe('synthetiseNegativeAcceptance', () => {
    it('emits at least the cross-context memory-isolation rule', () => {
      const plan = {
        meta: {
          title: 'x',
          summary: 'y',
          generatedAt: '2026-01-01T00:00:00.000Z',
          model: 'test',
          featureNumber: 1,
          featureSlug: 'x',
        },
        systemOverview: {
          purpose: 'p',
          context: 'c',
          keyActors: [],
          constraints: [],
          nfrs: [],
          c4: { contextDiagram: 'A', containerDiagram: 'A' },
        },
        boundedContexts: [],
        architectureLayers: [],
        domains: [],
        userStories: [],
      } as unknown as Plan;

      const out = synthetiseNegativeAcceptance(plan);
      expect(out.length).toBeGreaterThan(0);
      expect(out.some((s) => /memory/i.test(s.given))).toBe(true);
    });

    it('produces a USNNN-NEG-001 scenario when a memory story exists', () => {
      const plan = {
        meta: {
          title: 'x',
          summary: 'y',
          generatedAt: '2026-01-01T00:00:00.000Z',
          model: 'test',
          featureNumber: 1,
          featureSlug: 'x',
        },
        systemOverview: {
          purpose: 'p',
          context: 'c',
          keyActors: [],
          constraints: [],
          nfrs: [],
          c4: { contextDiagram: 'A', containerDiagram: 'A' },
        },
        boundedContexts: [],
        architectureLayers: [],
        domains: [],
        userStories: [
          {
            id: 'US042',
            title: 'Conversation memory across sessions',
            priority: 'P1',
            description: 'A story about memory.',
            whyThisPriority: 'x',
            independentTest: 'x',
            acceptanceScenarios: [],
            boundedContextIds: [],
          },
        ],
      } as unknown as Plan;

      const out = synthetiseNegativeAcceptance(plan);
      expect(out.some((s) => s.id === 'US042-NEG-001')).toBe(true);
    });
  });
});
