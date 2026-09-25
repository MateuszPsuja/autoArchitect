import { AgentTask, ArchitectureLayer, Constitution, Plan } from '../../../plan.schema';

export function basePlanFixture(overrides: Partial<Plan> = {}): Plan {
  const architectureLayers: ArchitectureLayer[] = overrides.architectureLayers ?? [
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
    },
  ];
  const constitution: Constitution = overrides.constitution ?? makeConstitution();
  return {
    meta: {
      title: 'fixture',
      summary: 'fixture',
      generatedAt: '2026-01-01T00:00:00Z',
      model: 'test',
      featureNumber: 1,
      featureSlug: 'fixture',
      libraries: [],
      ...overrides.meta,
    },
    systemOverview: {
      purpose: 'fixture',
      context: 'fixture',
      keyActors: [],
      constraints: [],
      nfrs: [],
      c4: { contextDiagram: 'flowchart\n  A', containerDiagram: 'flowchart\n  A' },
      ...overrides.systemOverview,
    },
    architectureLayers,
    domains: overrides.domains ?? [],
    boundedContexts: overrides.boundedContexts ?? [],
    userStories: overrides.userStories ?? [],
    functionalRequirements: overrides.functionalRequirements ?? [],
    successCriteria: overrides.successCriteria ?? [],
    constitution,
    workflows: [],
    adrs: [],
    agentTasks: overrides.agentTasks ?? [],
    refinementChats: [],
    specKit: overrides.specKit ?? { offlineContract: null, keyEntities: [], patches: [] },
  };
}

export function makeConstitution(): Constitution {
  return {
    projectName: 'fixture',
    version: '0.0.1',
    ratifiedAt: '2026-01-01T00:00:00Z',
    lastAmendedAt: '2026-01-01T00:00:00Z',
    articles: [
      {
        articleNumber: 3,
        title: 'Test-First (TDD)',
        content:
          'Tests are written first; Vitest covers the api layer. Vitest covers the unit layer. Vitest covers the integration layer. Vitest covers the e2e layer.',
      },
      {
        articleNumber: 6,
        title: 'Versioning & Breaking Changes',
        content: 'Public APIs follow SemVer. A changelog is maintained.',
      },
      {
        articleNumber: 8,
        title: 'Anti-Abstraction',
        content: 'Use HttpClient directly until a measured constraint forces a custom layer.',
      },
      {
        articleNumber: 1,
        title: 'Library-First',
        content: 'Every feature ships as a library.',
      },
      {
        articleNumber: 2,
        title: 'CLI Interface',
        content: 'A top-level CLI composes per-context subcommands.',
      },
      {
        articleNumber: 4,
        title: 'Integration Testing',
        content: 'Each provider adapter has a Vitest and pytest integration spec.',
      },
      {
        articleNumber: 5,
        title: 'Observability',
        content: 'Structured logs emit JSON with trace_id; metrics for latency_ms.',
      },
      {
        articleNumber: 7,
        title: 'Simplicity',
        content: 'Three or more concrete uses justify a shared layer.',
      },
      {
        articleNumber: 9,
        title: 'Integration-First Delivery',
        content: 'Each phase ships an end-to-end slice.',
      },
    ],
  };
}

export function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: 'T001',
    title: 'Implement feature',
    description: 'Implement feature for FR-001 acceptance.',
    acceptanceCriteria: ['Feature satisfies FR-001'],
    fileHints: ['apps/api/feature.ts'],
    userStoryIds: ['US001'],
    ...overrides,
  };
}
