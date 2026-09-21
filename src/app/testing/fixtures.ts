import { Plan } from '../core/plan.schema';
import { TokenUsage } from '../core/token-usage.model';

export const pdfTokenStatsFixture: TokenUsage = {
  promptTokens: 120,
  completionTokens: 340,
  totalTokens: 460,
  model: 'openai/gpt-4o-mini',
  generatedAt: '2026-08-21T00:00:00.000Z',
  startedAt: '2026-08-21T00:00:00.000Z',
  llmCalls: 4,
};

export const minimalPlanFixture: Plan = {
  meta: {
    title: 'Planner Fixture',
    summary: 'A small but valid architecture plan fixture.',
    generatedAt: '2026-04-21T00:00:00.000Z',
    model: 'openrouter/test-model',
    featureNumber: 1,
    featureSlug: 'planner-fixture',
    branchName: '001-planner-fixture',
  },
  systemOverview: {
    purpose: 'Validate parsing and rendering.',
    context: 'Used for tests.',
    keyActors: ['Developer'],
    constraints: ['Frontend only'],
    nfrs: ['Must load in under 2 seconds'],
    boundedContextMap: 'graph LR\n  Frontend -->|uses| Backend',
    c4: {
      contextDiagram: 'graph TD\nA[User]-->B[Planner]',
      containerDiagram: 'graph TD\nPlanner-->Storage',
    },
  },
  boundedContexts: [
    {
      id: 'planning',
      name: 'Planning',
      description: 'Core bounded context for plan generation.',
      layer: 'backend',
      ubiquitousLanguage: {
        Plan: 'A structured architecture document produced by the LLM.',
        Domain: 'A distinct business area within the plan.',
      },
    },
  ],
  userStories: [
    {
      id: 'US001',
      title: 'Generate a plan from an idea',
      priority: 'P1',
      description: 'As a developer, I want to submit an idea and receive a structured architecture plan so that I can kick off implementation.',
      whyThisPriority: 'MVP — without this no other story is reachable.',
      independentTest: 'Submit a known idea and assert a Plan JSON that satisfies PlanSchema.',
      acceptanceScenarios: [
        {
          id: 'FR-001',
          given: 'a developer with a valid API key and an idea of 50+ characters',
          when: 'they click Generate Plan',
          then: 'a Plan JSON is produced that passes PlanSchema validation',
        },
      ],
      boundedContextIds: ['planning'],
    },
  ],
  functionalRequirements: [
    {
      id: 'FR-001',
      text: 'The planner must accept a free-form idea and emit a Plan that satisfies PlanSchema.',
      needsClarification: false,
    },
  ],
  successCriteria: [
    {
      id: 'SC-001',
      text: 'A user can produce a valid Plan in under 90 seconds on a warm cache.',
    },
  ],
  constitution: {
    projectName: 'Planner Fixture',
    version: '1.0.0',
    ratifiedAt: '2026-04-21T00:00:00.000Z',
    lastAmendedAt: '2026-04-21T00:00:00.000Z',
    articles: [
      { articleNumber: 1, title: 'Library-First', content: 'Every capability ships as a standalone library.' },
      { articleNumber: 2, title: 'CLI Interface', content: 'Every library exposes a CLI surface.' },
      { articleNumber: 3, title: 'Test-First', content: 'Tests are written before implementation.' },
      { articleNumber: 4, title: 'Integration Testing', content: 'Real dependencies are exercised end-to-end.' },
      { articleNumber: 5, title: 'Observability', content: 'Structured logs and metrics at every boundary.' },
      { articleNumber: 6, title: 'Versioning', content: 'Breaking changes require a major bump.' },
      { articleNumber: 7, title: 'Simplicity', content: 'Prefer the simplest solution that satisfies the gates.' },
      { articleNumber: 8, title: 'Anti-Abstraction', content: 'No abstractions without two concrete consumers.' },
      { articleNumber: 9, title: 'Integration-First', content: 'New code paths ship with an integration test.' },
    ],
  },
  architectureLayers: [
    {
      id: 'backend',
      name: 'Backend',
      description: 'API and orchestration layer.',
      techStack: ['NestJS 10', 'PostgreSQL 15'],
      patterns: ['Clean Architecture'],
      mermaidDiagram: 'graph TD\nAPI-->DB',
      summary: 'API and orchestration layer.',
      directoryStructure: [
        {
          path: 'backend/src/core-planning',
          description: 'Core planning bounded context.',
          agentInstructions: [
            'Create PlannerService injectable with generate(brief) method.',
            'Inject PlanSchemaService for runtime Zod validation.',
            'Surface validation failures through ProjectStore.setError().',
          ],
        },
      ],
    },
    {
      id: 'frontend',
      name: 'Frontend',
      description: 'Angular SPA for user interaction.',
      techStack: ['Angular 17', 'PrimeNG'],
      patterns: ['Component-based', 'NgRx Signals'],
      mermaidDiagram: 'graph TD\nUI-->Store',
      summary: 'Angular SPA for plan generation and review.',
      directoryStructure: [
        {
          path: 'src/app/features/planner',
          description: 'Planner feature module.',
          agentInstructions: [
            'Create PlannerComponent with idea input and generate button.',
            'Inject PlannerGraphService to trigger plan generation on submit.',
            'Render validation errors with ProjectStore.setError() and an accessible message.',
          ],
        },
      ],
    },
  ],
  domains: [
    {
      id: 'core-planning',
      name: 'Core Planning',
      description: 'Domain for plan generation.',
      layer: 'backend',
      responsibilities: ['Generate architecture plan', 'Validate plan schema'],
      aggregates: [
        {
          id: 'plan-aggregate',
          name: 'Plan',
          rootEntity: 'Plan',
          description: 'Root aggregate for an architecture plan.',
          invariants: ['Plan must have at least one domain'],
          valueObjects: ['PlanMeta', 'SystemOverview'],
          commands: ['GeneratePlan'],
          domainEvents: ['PlanGenerated'],
        },
      ],
      domainEvents: [
        {
          id: 'plan-generated',
          name: 'PlanGenerated',
          description: 'Emitted when a plan is successfully generated.',
          payload: ['planId: string', 'title: string', 'generatedAt: string'],
          triggeredBy: 'GeneratePlan command',
          handledBy: ['ExportService', 'ProjectStore'],
        },
      ],
      directoryPath: 'src/app/core',
      components: [
        {
          id: 'planner-service',
          name: 'PlannerService',
          description: 'Coordinates generation and validation.',
          type: 'domain-service',
          layer: 'domain',
          responsibilities: ['Build prompts', 'Validate schema'],
          inputs: ['ProjectBrief: { idea: string; hints: string[] }'],
          outputs: ['Plan JSON'],
          dependencies: ['PromptBuilderService', 'PlanSchemaService'],
          publicApi: [
            'generate(brief: ProjectBrief): Promise<Plan>',
            'validate(raw: unknown): ValidationResult',
          ],
          errorHandling: 'Throws DomainError on schema validation failure.',
          acceptanceCriteria: [
            'generate() returns a valid Plan object for a well-formed brief',
            'generate() throws if LLM returns invalid JSON',
          ],
          outOfScope: ['Streaming token updates', 'Saving to localStorage'],
          tddSpec: {
            unitTests: [
              {
                description: 'returns valid plan for a well-formed brief',
                given: ['a valid ProjectBrief with idea and hints'],
                when: 'generate() is called with the brief',
                then: [
                  'returned object passes PlanSchema.safeParse',
                  'plan.meta.title is non-empty',
                ],
              },
              {
                description: 'throws DomainError when LLM returns invalid JSON',
                given: ['a mock LLM invoker that returns malformed JSON'],
                when: 'generate() is called',
                then: [
                  'DomainError is thrown',
                  'error message contains "schema validation"',
                ],
              },
            ],
            integrationTests: [
              {
                description: 'full generation pipeline produces exportable plan',
                given: ['a real PromptBuilderService', 'a mock ChatOpenAI returning valid plan JSON'],
                when: 'generate() is called end-to-end',
                then: [
                  'toMarkdownFiles() on the result returns at least 10 files',
                  'ARCHITECTURE.md is included in the output',
                ],
              },
            ],
          },
          targetFile: 'src/app/core/planner-graph.service.ts',
        },
      ],
    },
  ],
  workflows: [
    {
      id: 'generate-flow',
      name: 'Generate Plan',
      description: 'Generates architecture docs from project idea.',
      steps: ['Collect input', 'Call LLM', 'Validate output', 'Store plan'],
      domainIds: ['core-planning'],
    },
  ],
  adrs: [
    {
      id: 'adr-001',
      title: 'Schema-first output contract',
      status: 'accepted',
      context: 'LLM output can be inconsistent.',
      decision: 'Use strict Zod validation before accepting plan.',
      consequences: ['May require retries', 'Adds latency on first generation'],
    },
  ],
  agentTasks: [
    {
      id: 'task-001',
      title: 'Implement schema service',
      description: 'Create runtime schema validation and JSON schema export.',
      acceptanceCriteria: ['Valid plans parse', 'Invalid plans fail with field errors'],
      fileHints: ['src/app/core/plan-schema.service.ts'],
      userStoryIds: [],
    },
  ],
  refinementChats: [],
};
