import { z } from 'zod';
import { RefinementChatSessionSchema } from './refinement/refinement-chat.schema';
import { sanitizeMermaidLabels } from './mermaid-label-sanitizer';
import { TokenUsageSchema } from './token-usage.model';

const LAYER_DIAGRAM_MAX_LINES = 15;
const PROJECT_STRUCTURE_TREE_MAX_LINES = 30;
const DIRECTORY_STRUCTURE_MAX_ENTRIES = 4;
const AGENT_INSTRUCTIONS_MAX_ENTRIES = 6;
const TECH_STACK_MAX_ENTRIES = 8;
const PATTERNS_MAX_ENTRIES = 6;
const CONSTITUTION_CHECK_MAX_ENTRIES = 8;
const COMPLEXITY_TRACKING_MAX_ENTRIES = 8;
const COMPONENT_RESPONSIBILITIES_MAX = 4;
const COMPONENT_INPUTS_MAX = 6;
const COMPONENT_OUTPUTS_MAX = 6;
const COMPONENT_DEPENDENCIES_MAX = 8;
const COMPONENT_PUBLIC_API_MAX = 6;
const COMPONENT_ACCEPTANCE_CRITERIA_MAX = 5;
const COMPONENT_OUT_OF_SCOPE_MAX = 4;
const COMPONENT_TDD_UNIT_TESTS_MAX = 3;
const COMPONENT_TDD_INTEGRATION_TESTS_MAX = 2;
const TEST_CASE_GIVEN_MAX = 3;
const TEST_CASE_THEN_MAX = 3;
const DOMAIN_RESPONSIBILITIES_MAX = 6;
const DOMAIN_AGGREGATES_MAX = 3;
const DOMAIN_EVENTS_MAX = 4;
const DOMAIN_COMPONENTS_MAX = 4;
const AGGREGATE_INVARIANTS_MAX = 4;
const AGGREGATE_VALUE_OBJECTS_MAX = 4;
const AGGREGATE_COMMANDS_MAX = 6;
const AGGREGATE_DOMAIN_EVENTS_MAX = 6;
const DOMAIN_EVENT_PAYLOAD_MAX = 6;
const DOMAIN_EVENT_HANDLED_BY_MAX = 4;

function capArray<T>(arr: T[], max: number): T[] {
  return arr.length > max ? arr.slice(0, max) : arr;
}

function capMermaidLines(maxLines: number): (s: string) => string {
  return (s) => {
    const lines = s.split('\n');
    return lines.length > maxLines ? lines.slice(0, maxLines).join('\n') : s;
  };
}

export const LAYER_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const FEATURE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LayerId = z.string().min(1).regex(LAYER_ID_PATTERN);
const FeatureNumber = z.number().int().positive();
const FeatureSlug = z.string().min(1).regex(FEATURE_SLUG_PATTERN);

const TestCaseSchema = z.object({
  description: z.string().min(1),
  given: z.array(z.string().min(1)).min(1).transform((arr) => capArray(arr, TEST_CASE_GIVEN_MAX)),
  when: z.string().min(1),
  then: z.array(z.string().min(1)).min(1).transform((arr) => capArray(arr, TEST_CASE_THEN_MAX)),
});

const TDDSpecSchema = z.object({
  unitTests: z.array(TestCaseSchema)
    .min(2)
    .transform((arr) => capArray(arr, COMPONENT_TDD_UNIT_TESTS_MAX)),
  integrationTests: z.array(TestCaseSchema)
    .min(1)
    .transform((arr) => capArray(arr, COMPONENT_TDD_INTEGRATION_TESTS_MAX)),
});

const USER_STORIES_MAX = 12;
const ACCEPTANCE_SCENARIOS_MAX = 8;
const FUNCTIONAL_REQUIREMENTS_MAX = 30;
const SUCCESS_CRITERIA_MAX = 10;
const CONSTITUTION_ARTICLES_MAX = 9;

export const PRIORITY_PATTERN = /^P[123]$/;
export const USER_STORY_ID_PATTERN = /^US\d{3,}$/;
export const FR_ID_PATTERN = /^FR-\d{3,}$/;
export const SC_ID_PATTERN = /^SC-\d{3,}$/;
export const ACCEPTANCE_SCENARIO_ID_PATTERN = /^(FR|SC|AS)-\d{3,}$/;
export const BRANCH_NAME_PATTERN = /^\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

const AcceptanceScenarioSchema = z.object({
  id: z.string().regex(ACCEPTANCE_SCENARIO_ID_PATTERN, 'Use FR-NNN / SC-NNN / AS-NNN'),
  given: z.string().min(1),
  when: z.string().min(1),
  then: z.string().min(1),
});

const FunctionalRequirementSchema = z.object({
  id: z.string().regex(FR_ID_PATTERN),
  text: z.string().min(1),
  needsClarification: z.boolean().default(false),
  clarificationNote: z.string().optional(),
});

const SuccessCriterionSchema = z.object({
  id: z.string().regex(SC_ID_PATTERN),
  text: z.string().min(1),
});

const UserStorySchema = z.object({
  id: z.string().regex(USER_STORY_ID_PATTERN),
  title: z.string().min(1),
  priority: z.enum(['P1', 'P2', 'P3']),
  description: z.string().min(1),
  whyThisPriority: z.string().min(1),
  independentTest: z.string().min(1),
  acceptanceScenarios: z.array(AcceptanceScenarioSchema).min(1).transform((arr) => capArray(arr, ACCEPTANCE_SCENARIOS_MAX)),
  boundedContextIds: z.array(z.string().min(1)).default([]),
});

const ConstitutionArticleSchema = z.object({
  articleNumber: z.number().int().min(1).max(CONSTITUTION_ARTICLES_MAX),
  title: z.string().min(1),
  content: z.string().min(1),
});

export const EMPTY_CONSTITUTION: z.infer<typeof ConstitutionArticleSchema>[] = Array.from(
  { length: CONSTITUTION_ARTICLES_MAX },
  (_, i) => ({
    articleNumber: i + 1,
    title: `Article ${i + 1}`,
    content: '> _Regenerate the plan to populate the project constitution._',
  }),
);

export const ConstitutionSchema = z.object({
  projectName: z.string().min(1),
  version: z.string().min(1),
  ratifiedAt: z.string().min(1),
  lastAmendedAt: z.string().min(1),
  articles: z.array(ConstitutionArticleSchema).length(CONSTITUTION_ARTICLES_MAX),
});

const AggregateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  rootEntity: z.string().min(1),
  description: z.string().min(1),
  invariants: z.array(z.string().min(1)).min(1).transform((arr) => capArray(arr, AGGREGATE_INVARIANTS_MAX)),
  valueObjects: z.array(z.string().min(1)).min(1).transform((arr) => capArray(arr, AGGREGATE_VALUE_OBJECTS_MAX)),
  commands: z.array(z.string().min(1)).min(1).transform((arr) => capArray(arr, AGGREGATE_COMMANDS_MAX)),
  domainEvents: z.array(z.string().min(1)).min(1).transform((arr) => capArray(arr, AGGREGATE_DOMAIN_EVENTS_MAX)),
});

const DomainEventSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  payload: z.array(z.string().min(1)).default([]).transform((arr) => capArray(arr, DOMAIN_EVENT_PAYLOAD_MAX)),
  triggeredBy: z.string().min(1),
  handledBy: z.array(z.string().min(1)).default([]).transform((arr) => capArray(arr, DOMAIN_EVENT_HANDLED_BY_MAX)),
});

const BoundedContextSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  layer: LayerId,
  ubiquitousLanguage: z
    .record(z.string(), z.string())
    .refine((value) => Object.keys(value).length > 0, {
      message: 'At least one ubiquitous language term is required.',
    }),
});

const DirectoryEntrySchema = z.object({
  path: z.string().min(1),
  description: z.string().min(1),
  agentInstructions: z.array(z.string().min(1))
    .min(3)
    .transform((arr) => capArray(arr, AGENT_INSTRUCTIONS_MAX_ENTRIES)),
});

const TechnicalContextSchema = z.object({
  storage: z.string().min(1),
  targetPlatform: z.string().min(1),
  performanceGoals: z.string().min(1),
  constraints: z.string().min(1),
  scaleScope: z.string().min(1),
});

const ComplexityEntrySchema = z.object({
  violation: z.string().min(1),
  whyNeeded: z.string().min(1),
  simplerAlternativeRejected: z.string().min(1),
});

const ArchitectureLayerSchema = z.object({
  id: LayerId,
  name: z.string().min(1),
  description: z.string().min(1),
  techStack: z.array(z.string().min(1)).min(1).transform((arr) => capArray(arr, TECH_STACK_MAX_ENTRIES)),
  patterns: z.array(z.string().min(1)).min(1).transform((arr) => capArray(arr, PATTERNS_MAX_ENTRIES)),
  mermaidDiagram: z.string().min(1).transform(sanitizeMermaidLabels).transform(capMermaidLines(LAYER_DIAGRAM_MAX_LINES)),
  directoryStructure: z.array(DirectoryEntrySchema)
    .min(1)
    .transform((arr) => capArray(arr, DIRECTORY_STRUCTURE_MAX_ENTRIES)),



  summary: z.string().min(1).optional(),
  technicalContext: TechnicalContextSchema.optional(),
  constitutionCheck: z
    .array(z.string().min(1))
    .transform((arr: string[]): string[] => capArray(arr, CONSTITUTION_CHECK_MAX_ENTRIES))
    .optional(),
  projectStructureTree: z
    .string()
    .min(1)
    .transform(capMermaidLines(PROJECT_STRUCTURE_TREE_MAX_LINES))
    .optional(),
  complexityTracking: z
    .array(ComplexityEntrySchema)
    .transform((arr: ComplexityEntry[]): ComplexityEntry[] => capArray(arr, COMPLEXITY_TRACKING_MAX_ENTRIES))
    .optional(),



  componentTreeDiagram: z
    .string()
    .min(1)
    .transform(sanitizeMermaidLabels)
    .transform(capMermaidLines(LAYER_DIAGRAM_MAX_LINES))
    .optional(),
  dataFlowDiagram: z
    .string()
    .min(1)
    .transform(sanitizeMermaidLabels)
    .transform(capMermaidLines(LAYER_DIAGRAM_MAX_LINES))
    .optional(),
  moduleDependenciesDiagram: z
    .string()
    .min(1)
    .transform(sanitizeMermaidLabels)
    .transform(capMermaidLines(LAYER_DIAGRAM_MAX_LINES))
    .optional(),
  stateManagementDiagram: z
    .string()
    .min(1)
    .transform(sanitizeMermaidLabels)
    .transform(capMermaidLines(LAYER_DIAGRAM_MAX_LINES))
    .optional(),
  apiContractDiagram: z
    .string()
    .min(1)
    .transform(sanitizeMermaidLabels)
    .transform(capMermaidLines(LAYER_DIAGRAM_MAX_LINES))
    .optional(),
});

const ComponentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  type: z.enum([
    'ui-component',
    'service',
    'store',
    'repository',
    'aggregate',
    'domain-service',
    'use-case',
    'controller',
    'utility',
  ]),
  layer: z.enum(['domain', 'application', 'infrastructure', 'presentation']),
  responsibilities: z.array(z.string().min(1))
    .min(1)
    .transform((arr) => capArray(arr, COMPONENT_RESPONSIBILITIES_MAX)),
  inputs: z.array(z.string().min(1)).min(1).transform((arr) => capArray(arr, COMPONENT_INPUTS_MAX)),
  outputs: z.array(z.string().min(1)).min(1).transform((arr) => capArray(arr, COMPONENT_OUTPUTS_MAX)),
  dependencies: z.array(z.string().min(1)).default([]).transform((arr) => capArray(arr, COMPONENT_DEPENDENCIES_MAX)),
  publicApi: z.array(z.string().min(1)).min(1).transform((arr) => capArray(arr, COMPONENT_PUBLIC_API_MAX)),
  errorHandling: z.string().min(1),
  acceptanceCriteria: z.array(z.string().min(1))
    .min(1)
    .transform((arr) => capArray(arr, COMPONENT_ACCEPTANCE_CRITERIA_MAX)),
  tddSpec: TDDSpecSchema,
  targetFile: z.string().min(1),
  outOfScope: z.array(z.string().min(1)).min(1).transform((arr) => capArray(arr, COMPONENT_OUT_OF_SCOPE_MAX)),
});

const DomainSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  layer: LayerId,
  responsibilities: z.array(z.string().min(1))
    .min(1)
    .transform((arr) => capArray(arr, DOMAIN_RESPONSIBILITIES_MAX)),
  aggregates: z.array(AggregateSchema).default([]).transform((arr) => capArray(arr, DOMAIN_AGGREGATES_MAX)),
  domainEvents: z.array(DomainEventSchema).default([]).transform((arr) => capArray(arr, DOMAIN_EVENTS_MAX)),
  directoryPath: z.string().min(1),
  components: z.array(ComponentSchema).min(1).transform((arr) => capArray(arr, DOMAIN_COMPONENTS_MAX)),
});

const WorkflowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  steps: z.array(z.string().min(1)).default([]),
  domainIds: z.array(z.string().min(1)).default([]),
});

const AdrSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(['proposed', 'accepted', 'deprecated']),
  context: z.string().min(1),
  decision: z.string().min(1),
  consequences: z.array(z.string().min(1)).default([]),
});

const AgentTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  fileHints: z.array(z.string().min(1)).min(1),
  userStoryIds: z.array(z.string().regex(USER_STORY_ID_PATTERN)).default([]),
});

export const PlanSchema = z.object({
  meta: z.object({
    title: z.string().min(1),
    summary: z.string().min(1),
    generatedAt: z.string().min(1),
    model: z.string().min(1),
    featureNumber: FeatureNumber,
    featureSlug: FeatureSlug,
    branchName: z
      .string()
      .regex(BRANCH_NAME_PATTERN)
      .optional(),
    technologyHints: z.string().optional(),
    tokenStats: TokenUsageSchema.nullable().optional(),
  }),
  systemOverview: z.object({
    purpose: z.string().min(1),
    context: z.string().min(1),
    keyActors: z.array(z.string().min(1)).default([]),
    constraints: z.array(z.string().min(1)).default([]),
    nfrs: z.array(z.string().min(1)).default([]),
    boundedContextMap: z.string().optional(),
    c4: z.object({
      contextDiagram: z.string().min(1),
      containerDiagram: z.string().min(1),
    }),
  }),
  boundedContexts: z.array(BoundedContextSchema).min(1),
  architectureLayers: z.array(ArchitectureLayerSchema).min(1),
  domains: z.array(DomainSchema).min(1),
  userStories: z.array(UserStorySchema).default([]).transform((arr) => capArray(arr, USER_STORIES_MAX)),
  functionalRequirements: z
    .array(FunctionalRequirementSchema)
    .default([])
    .transform((arr) => capArray(arr, FUNCTIONAL_REQUIREMENTS_MAX)),
  successCriteria: z
    .array(SuccessCriterionSchema)
    .default([])
    .transform((arr) => capArray(arr, SUCCESS_CRITERIA_MAX)),
  constitution: ConstitutionSchema.optional(),
  workflows: z.array(WorkflowSchema).default([]),
  adrs: z.array(AdrSchema).default([]),
  agentTasks: z.array(AgentTaskSchema).default([]),
  refinementChats: z.array(RefinementChatSessionSchema).default([]),
});

export const LayerChunkSchema = z.union([
  ArchitectureLayerSchema,
  z.array(ArchitectureLayerSchema).min(1),
]);

export const DomainChunkSchema = z.union([DomainSchema, z.array(DomainSchema).min(1)]);

export const BOUNDED_CONTEXTS_MAX = 12;

export const BoundedContextChunkSchema = z.union([
  BoundedContextSchema,
  z.array(BoundedContextSchema).min(1).max(BOUNDED_CONTEXTS_MAX),
]);

export const TailSchema = z.object({
  workflows: z.array(WorkflowSchema).default([]),
  adrs: z.array(AdrSchema).default([]),
  agentTasks: z.array(AgentTaskSchema).default([]),
  userStories: z.array(UserStorySchema).default([]).transform((arr) => capArray(arr, USER_STORIES_MAX)).optional(),
  functionalRequirements: z
    .array(FunctionalRequirementSchema)
    .default([])
    .transform((arr) => capArray(arr, FUNCTIONAL_REQUIREMENTS_MAX))
    .optional(),
  successCriteria: z
    .array(SuccessCriterionSchema)
    .default([])
    .transform((arr) => capArray(arr, SUCCESS_CRITERIA_MAX))
    .optional(),
  constitution: ConstitutionSchema.optional(),
});

export const ScaffoldSchema = z.object({
  meta: z.object({
    title: z.string().min(1),
    summary: z.string().min(1),
    generatedAt: z.string().min(1),
    model: z.string().min(1),
    featureNumber: FeatureNumber,
    featureSlug: FeatureSlug,
    branchName: z.string().regex(BRANCH_NAME_PATTERN).optional(),
  }),
  systemOverview: z.object({
    purpose: z.string().min(1),
    context: z.string().min(1),
    keyActors: z.array(z.string().min(1)).default([]),
    constraints: z.array(z.string().min(1)).default([]),
    nfrs: z.array(z.string().min(1)).default([]),
    boundedContextMap: z.string().optional(),
    c4: z.object({
      contextDiagram: z.string().min(1),
      containerDiagram: z.string().min(1),
    }),
  }),
  boundedContexts: z.array(BoundedContextSchema).min(1),
  architectureLayerIds: z.array(LayerId).min(1),
  domainIds: z.array(z.string().min(1)).min(1),
  includeTail: z.boolean().default(true),
});

export type Plan = z.infer<typeof PlanSchema>;
export type Domain = z.infer<typeof DomainSchema>;
export type DomainComponent = z.infer<typeof ComponentSchema>;
export type Aggregate = z.infer<typeof AggregateSchema>;
export type DomainEvent = z.infer<typeof DomainEventSchema>;
export type BoundedContext = z.infer<typeof BoundedContextSchema>;
export type ArchitectureLayer = z.infer<typeof ArchitectureLayerSchema>;
export type DirectoryEntry = z.infer<typeof DirectoryEntrySchema>;
export type TDDSpec = z.infer<typeof TDDSpecSchema>;
export type TestCase = z.infer<typeof TestCaseSchema>;
export type AgentTask = z.infer<typeof AgentTaskSchema>;
export type Adr = z.infer<typeof AdrSchema>;
export type Workflow = z.infer<typeof WorkflowSchema>;
export type TechnicalContext = z.infer<typeof TechnicalContextSchema>;
export type UserStory = z.infer<typeof UserStorySchema>;
export type FunctionalRequirement = z.infer<typeof FunctionalRequirementSchema>;
export type SuccessCriterion = z.infer<typeof SuccessCriterionSchema>;
export type AcceptanceScenario = z.infer<typeof AcceptanceScenarioSchema>;
export type ConstitutionArticle = z.infer<typeof ConstitutionArticleSchema>;
export type Constitution = z.infer<typeof ConstitutionSchema>;
type ComplexityEntry = z.infer<typeof ComplexityEntrySchema>;
