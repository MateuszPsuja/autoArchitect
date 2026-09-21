import { TestBed } from '@angular/core/testing';
import {
  PromptBuilderService,
  formatRefinementContext,
  formatRefinementInstruction,
  resolveSkillForStage,
  resolveSkillsForStage,
} from './prompt-builder.service';
import { minimalPlanFixture } from '../testing/fixtures';
import { ResolvedSkill } from './agents.store';

describe('PromptBuilderService', () => {
  let service: PromptBuilderService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PromptBuilderService);
  });

  it('preserves unrestricted optional context and instructs the agent to extract requirements', async () => {
    const prompt = await service.buildGeneratePrompt(
      {
        title: 'Marketplace Hub',
        idea: 'Build a marketplace app',
        technicalConstraints:
          'Deployment is browser-only, but corporate OIDC already exists.\nOther choices are open.',
        nfrs: 'The app should feel fast for remote users. Accessibility matters, especially keyboard navigation.',
        hints: 'The team knows Angular, and PostgreSQL is available. Recommend everything else.',
        contextAttachments: [],
      },
      { type: 'object' },
      'Fix domains structure',
    );

    const rendered = await prompt.format({});

    expect(rendered).toContain('Marketplace Hub');
    expect(rendered).toContain('Plan title: Marketplace Hub');
    expect(rendered).toContain('Build a marketplace app');
    expect(rendered).toContain(
      'Optional technical context (free-form):\nDeployment is browser-only, but corporate OIDC already exists.\nOther choices are open.',
    );
    expect(rendered).toContain(
      'Optional quality and non-functional context (free-form):\nThe app should feel fast for remote users. Accessibility matters, especially keyboard navigation.',
    );
    expect(rendered).toContain(
      'Optional technology context (free-form):\nThe team knows Angular, and PostgreSQL is available. Recommend everything else.',
    );
    expect(rendered).toContain(
      'Extract and reconcile every explicit product requirement, technical constraint, quality attribute, integration, and technology preference',
    );
    expect(rendered).toContain('Fix domains structure');
    expect(rendered).toContain('"type": "object"');
    expect(rendered).toContain('none provided');
  });

  it('tells the agent to infer missing decisions when optional inputs are empty', async () => {
    const prompt = await service.buildGeneratePrompt(
      {
        title: 'Internal Planner',
        idea: 'Build an internal planning tool',
        technicalConstraints: '',
        nfrs: '   ',
        hints: '',
        contextAttachments: [
          {
            id: 'ctx-1',
            name: 'requirements.md',
            mimeType: 'text/markdown',
            size: 42,
            kind: 'markdown',
            extractedText: 'Must support importing legacy planning notes.',
          },
        ],
      },
      { type: 'object' },
    );

    const rendered = await prompt.format({});

    expect(rendered).toContain('requirements.md');
    expect(rendered).toContain('Must support importing legacy planning notes.');
    expect(rendered).toContain(
      'No additional input was provided. Infer suitable technical constraints and implementation assumptions from the application idea.',
    );
    expect(rendered).toContain(
      'No additional input was provided. Derive suitable, measurable non-functional requirements from the application idea.',
    );
    expect(rendered).toContain(
      'No additional input was provided. Choose and justify an appropriate, specific technology stack for the application.',
    );
    expect(rendered).toContain(
      'When optional input is blank or incomplete, infer sensible constraints, measurable non-functional requirements, architecture patterns, and a specific technology stack',
    );
  });

  it('instructs the agent to follow spec-kit per-layer architecture plan fields', async () => {
    const prompt = await service.buildGeneratePrompt(
      {
        title: 'Spec-Kit Demo',
        idea: 'Build a tool that generates spec-kit-shaped architecture plans.',
        technicalConstraints: '',
        nfrs: '',
        hints: '',
        contextAttachments: [],
      },
      { type: 'object' },
    );

    const rendered = await prompt.format({});

    expect(rendered).toContain('PER-LAYER ARCHITECTURE PLAN (spec-kit)');
    expect(rendered).toContain('plan-template.md');
    expect(rendered).toContain('mermaidDiagram');
    expect(rendered).not.toContain('componentTreeDiagram');
    expect(rendered).not.toContain('dataFlowDiagram');
    expect(rendered).not.toContain('moduleDependenciesDiagram');
    expect(rendered).not.toContain('stateManagementDiagram');
    expect(rendered).not.toContain('apiContractDiagram');
    expect(rendered).toContain('NEEDS CLARIFICATION');
  });

  it('instructs the planner to populate user stories, FR, SC, and the 9-article constitution', async () => {
    const prompt = await service.buildGeneratePrompt(
      {
        title: 'Spec-Kit Demo',
        idea: 'Build a tool that generates spec-kit-shaped architecture plans.',
        technicalConstraints: '',
        nfrs: '',
        hints: '',
        contextAttachments: [],
      },
      { type: 'object' },
    );

    const rendered = await prompt.format({});

    expect(rendered).toContain('USER STORIES (spec-kit)');
    expect(rendered).toContain('"userStories"');
    expect(rendered).toContain('US followed by 3+ digits');
    expect(rendered).toContain('FUNCTIONAL REQUIREMENTS & SUCCESS CRITERIA');
    expect(rendered).toContain('"functionalRequirements"');
    expect(rendered).toContain('"successCriteria"');
    expect(rendered).toContain('PROJECT CONSTITUTION');
    expect(rendered).toContain('"constitution"');
    expect(rendered).toContain('Library-First');
    expect(rendered).toContain('Integration-First Delivery');
    expect(rendered).toContain('"userStoryIds"');
  });
});

import { AgentsStore } from './agents.store';

describe('PromptBuilderService — skill composition (Phase 1)', () => {
  let service: PromptBuilderService;
  let agents: InstanceType<typeof AgentsStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PromptBuilderService);
    agents = TestBed.inject(AgentsStore);
  });

  it('appends a resolved skill prompt to the scaffold system prompt', async () => {
    const skill = agents.resolveSkill('agent-1', 'skill-1');
    const prompt = await service.buildScaffoldPrompt(
      {
        title: 'T',
        idea: 'I',
        technicalConstraints: '',
        nfrs: '',
        hints: '',
        contextAttachments: [],
      },
      '',
      skill,
    );
    const rendered = await prompt.format({});

    expect(rendered).toContain('SCAFFOLD');

    expect(rendered).toContain('principal software architect producing a Plan JSON');
  });

  it('mutating a resolved skill prompt only changes the appended suffix, not the base', async () => {
    const baseSkill = agents.resolveSkill('agent-1', 'skill-1');
    const promptA = await service.buildScaffoldPrompt(
      {
        title: 'T',
        idea: 'I',
        technicalConstraints: '',
        nfrs: '',
        hints: '',
        contextAttachments: [],
      },
      '',
      baseSkill,
    );
    const renderedA = await promptA.format({});

    agents.updateSkill('agent-1', 'skill-1', { prompt: 'CUSTOM-SUFFIX-MARKER-12345' });
    const updatedSkill = agents.resolveSkill('agent-1', 'skill-1');
    const promptB = await service.buildScaffoldPrompt(
      {
        title: 'T',
        idea: 'I',
        technicalConstraints: '',
        nfrs: '',
        hints: '',
        contextAttachments: [],
      },
      '',
      updatedSkill,
    );
    const renderedB = await promptB.format({});

    expect(renderedA).toContain('SCAFFOLD');
    expect(renderedB).toContain('SCAFFOLD');

    expect(renderedB).toContain('CUSTOM-SUFFIX-MARKER-12345');

    expect(renderedB).not.toContain(
      'principal software architect producing a Plan JSON for a web application',
    );
  });

  it('falls back to base-only when no skill override is supplied', async () => {
    const prompt = await service.buildScaffoldPrompt(
      {
        title: 'T',
        idea: 'I',
        technicalConstraints: '',
        nfrs: '',
        hints: '',
        contextAttachments: [],
      },
      '',
      null,
    );
    const rendered = await prompt.format({});
    expect(rendered).toContain('SCAFFOLD');
  });

  it('substitutes {schema} and {retryContext} placeholders even when a skill prompt is appended', async () => {
    const skill = agents.resolveSkill('agent-1', 'skill-1');
    const prompt = await service.buildScaffoldPrompt(
      {
        title: 'T',
        idea: 'I',
        technicalConstraints: '',
        nfrs: '',
        hints: '',
        contextAttachments: [],
      },
      'fix boundedContexts',
      skill,
    );
    const rendered = await prompt.format({});

    expect(rendered).not.toContain('{shape}');

    expect(rendered).toContain('fix boundedContexts');

    expect(rendered).toContain('principal software architect producing a Plan JSON');
  });
});

describe('PromptBuilderService — slim shape descriptions (Step 1 of planner-generation-speed-reliability)', () => {
  let service: PromptBuilderService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PromptBuilderService);
  });

  const input = {
    title: 'T',
    idea: 'I',
    technicalConstraints: '',
    nfrs: '',
    hints: '',
    contextAttachments: [] as never[],
  };

  it('buildScaffoldPrompt contains the shape description and not the literal Zod schema', async () => {
    const prompt = await service.buildScaffoldPrompt(input, '');
    const rendered = await prompt.format({});
    expect(rendered).toContain('boundedContexts');
    expect(rendered).toContain('architectureLayerIds');
    expect(rendered).toContain('domainIds');

    expect(rendered).not.toContain('$schema');
    expect(rendered).not.toContain('"type":"object"');
  });

  it('buildLayerChunkPrompt contains the shape description and not the literal Zod schema', async () => {
    const prompt = await service.buildLayerChunkPrompt(
      input,
      {
        meta: { title: 'T', summary: 'S', generatedAt: '2026-08-24T00:00:00.000Z', model: 'm', featureNumber: 1, featureSlug: 't' },
        systemOverview: {
          purpose: 'p',
          context: 'c',
          keyActors: ['a'],
          constraints: ['x'],
          nfrs: ['y'],
          c4: { contextDiagram: 'flowchart TD', containerDiagram: 'flowchart TD' },
        },
        boundedContexts: [
          {
            id: 'bc',
            name: 'BC',
            description: 'd',
            layer: 'backend',
            ubiquitousLanguage: { term: 'definition' },
          },
        ],
        architectureLayerIds: ['backend'],
        domainIds: ['d'],
        includeTail: false,
      },
      '',
    );
    const rendered = await prompt.format({});
    expect(rendered).toContain('techStack');
    expect(rendered).toContain('directoryStructure');
    expect(rendered).not.toContain('$schema');
  });

  it('buildRepairPrompt uses the per-stage shape description', async () => {
    const layersPrompt = await service.buildRepairPrompt('layers', '{"id":"x"}');
    const layersRendered = await layersPrompt.format({});
    expect(layersRendered).toContain('techStack');
    expect(layersRendered).toContain('directoryStructure');
    expect(layersRendered).not.toContain('$schema');

    const domainsPrompt = await service.buildRepairPrompt('domains', '{"id":"x"}');
    const domainsRendered = await domainsPrompt.format({});
    expect(domainsRendered).toContain('tddSpec');
    expect(domainsRendered).toContain('aggregates');

    const tailPrompt = await service.buildRepairPrompt('tail', '{}');
    const tailRendered = await tailPrompt.format({});
    expect(tailRendered).toContain('workflows');
    expect(tailRendered).toContain('adrs');
  });

  it('buildTailPrompt instructs the LLM to emit user stories, FR, SC, and the 9-article constitution', async () => {
    const scaffoldFixture = {
      meta: {
        title: 'T',
        summary: 'S',
        generatedAt: '2026-08-24T00:00:00.000Z',
        model: 'm',
        featureNumber: 1,
        featureSlug: 't',
      },
      systemOverview: {
        purpose: 'p',
        context: 'c',
        keyActors: ['a'],
        constraints: ['x'],
        nfrs: ['y'],
        c4: { contextDiagram: 'flowchart TD', containerDiagram: 'flowchart TD' },
      },
      boundedContexts: [
        {
          id: 'bc',
          name: 'BC',
          description: 'd',
          layer: 'backend',
          ubiquitousLanguage: { term: 'definition' },
        },
      ],
      architectureLayerIds: ['backend'],
      domainIds: ['d'],
      includeTail: true,
    };
    const prompt = await service.buildTailPrompt(input, scaffoldFixture as never, '');
    const rendered = await prompt.format({});

    expect(rendered).toContain('"userStories"');
    expect(rendered).toContain('"functionalRequirements"');
    expect(rendered).toContain('"successCriteria"');
    expect(rendered).toContain('"constitution"');
    expect(rendered).toContain('Library-First');
    expect(rendered).toContain('Integration-First Delivery');
    expect(rendered).toContain('userStoryIds');
    expect(rendered).toContain('USNNN');
  });
});

describe('PromptBuilderService — COMPLEXITY GUIDANCE in scaffold prompt', () => {
  let service: PromptBuilderService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PromptBuilderService);
  });

  const input = {
    title: 'T',
    idea: 'I',
    technicalConstraints: '',
    nfrs: '',
    hints: '',
    contextAttachments: [] as never[],
  };

  it('omits the COMPLEXITY GUIDANCE block when no caps are supplied', async () => {
    const prompt = await service.buildScaffoldPrompt(input, '');
    const rendered = await prompt.format({});
    expect(rendered).not.toContain('COMPLEXITY GUIDANCE');
  });

  it('injects tier-aware cap numbers when caps are supplied', async () => {
    const prompt = await service.buildScaffoldPrompt(input, '', null, {
      tier: 'high',
      maxLayers: 3,
      maxDomains: 3,
    });
    const rendered = await prompt.format({});
    expect(rendered).toContain('COMPLEXITY GUIDANCE');
    expect(rendered).toContain('Idea complexity: high');
    expect(rendered).toContain('≤ 3 architectureLayerIds');
    expect(rendered).toContain('≤ 3 domainIds');
  });
});

describe('PromptBuilderService — buildSectionRepairPrompt', () => {
  let service: PromptBuilderService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PromptBuilderService);
  });

  const basePlanSummary = {
    meta: { title: 'Test Plan', summary: 's', generatedAt: '2026-01-01T00:00:00.000Z', model: 'm', featureNumber: 1, featureSlug: 'test-plan' },
    boundedContextIds: ['planning'],
    architectureLayerIds: ['backend', 'frontend'],
    domainIds: ['core-planning'],
  };

  it('produces a section-scoped prompt that contains the section JSON', async () => {
    const prompt = await service.buildSectionRepairPrompt({
      stage: 'domains',
      sectionId: 'core-planning',
      currentSection: { id: 'core-planning', name: 'Core Planning' },
      findings: [
        {
          severity: 'error',
          path: 'domains[core-planning].components[x].tddSpec.unitTests',
          message: 'too few',
          fix: 'add more',
        },
      ],
      planSummary: basePlanSummary,
    });
    const rendered = await prompt.format({});
    expect(rendered).toContain('core-planning');
    expect(rendered).toContain('Section under repair: domains');
  });

  it('does NOT include JSON.stringify(plan) — the section JSON is the only body', async () => {





    const distinctiveSentinel = 'src/app/core/planner-graph.service.ts';
    const prompt = await service.buildSectionRepairPrompt({
      stage: 'domains',
      sectionId: 'core-planning',
      currentSection: { id: 'core-planning', name: 'Core Planning' },
      findings: [
        {
          severity: 'error',
          path: 'domains[core-planning].components[planner-service].tddSpec.unitTests',
          message: 'too few',
          fix: 'add more',
        },
      ],
      planSummary: basePlanSummary,
    });
    const rendered = await prompt.format({});
    expect(rendered).not.toContain(distinctiveSentinel);
  });

  it('embeds the findings as JSON in the human message', async () => {
    const prompt = await service.buildSectionRepairPrompt({
      stage: 'domains',
      sectionId: 'core-planning',
      currentSection: { id: 'core-planning', name: 'Core Planning' },
      findings: [
        {
          severity: 'error',
          path: 'domains[core-planning].layer',
          message: 'bad ref',
          fix: 'use a real layer id',
        },
      ],
      planSummary: basePlanSummary,
    });
    const rendered = await prompt.format({});
    expect(rendered).toContain('bad ref');
    expect(rendered).toContain('use a real layer id');
  });

  it('inherits the relevant stage system prompt (scaffold, layers, domains, tail)', async () => {
    const scaffold = await service.buildSectionRepairPrompt({
      stage: 'scaffold',
      currentSection: { purpose: 'x' },
      findings: [],
      planSummary: basePlanSummary,
    });
    expect((await scaffold.format({}))).toContain('boundedContextMap');

    const layers = await service.buildSectionRepairPrompt({
      stage: 'layers',
      sectionId: 'backend',
      currentSection: { id: 'backend' },
      findings: [],
      planSummary: basePlanSummary,
    });
    expect((await layers.format({}))).toContain('techStack');

    const tail = await service.buildSectionRepairPrompt({
      stage: 'tail',
      currentSection: { workflows: [], adrs: [], agentTasks: [] },
      findings: [],
      planSummary: basePlanSummary,
    });
    expect((await tail.format({}))).toContain('workflows');
  });

  it('does not include the FINDINGS block when no findings are provided', async () => {
    const prompt = await service.buildSectionRepairPrompt({
      stage: 'domains',
      sectionId: 'core-planning',
      currentSection: { id: 'core-planning' },
      findings: [],
      planSummary: basePlanSummary,
    });
    const rendered = await prompt.format({});
    expect(rendered).not.toContain('FINDINGS TO ADDRESS');
  });
});

describe('PromptBuilderService — PDF creator payload and prompt', () => {
  let service: PromptBuilderService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PromptBuilderService);
  });

  it('summarizeForPdf keeps the high-signal fields and drops noisy ones (small payload)', async () => {
    const { summarizeForPdf } = await import('./prompt-builder.service');
    const summarized = summarizeForPdf(minimalPlanFixture) as Record<string, unknown>;
    expect(summarized['kpis']).toMatchObject({
      architectureLayers: 2,
      boundedContexts: 1,
      domains: 1,
      components: 1,
      aggregates: 1,
      domainEvents: 1,
      adrs: 1,
      workflows: 1,
      agentTasks: 1,
      unitTests: 2,
      integrationTests: 1,
    });
    const contexts = summarized['boundedContexts'] as Array<{ ubiquitousLanguage: unknown }>;
    expect(contexts[0].ubiquitousLanguage).toEqual(minimalPlanFixture.boundedContexts[0].ubiquitousLanguage);
    const layers = summarized['architectureLayers'] as Array<Record<string, unknown>>;
    expect(layers[0]).toHaveProperty('summary');
    expect(layers[0]).toHaveProperty('technicalContext');
    expect(layers[0]).toHaveProperty('constitutionCheck');
    expect(layers[0]).toHaveProperty('complexityTracking');



    expect(layers[0]).not.toHaveProperty('dataFlowDiagram');
    const domains = summarized['domains'] as Array<{
      aggregates: unknown[];
      domainEvents: unknown[];
      components: Array<{ id: string; tddSpec?: unknown }>;
    }>;
    expect(domains[0].aggregates.length).toBe(1);
    expect(domains[0].domainEvents.length).toBe(1);



    expect(domains[0].components[0]).not.toHaveProperty('inputs');
    expect(domains[0].components[0]).not.toHaveProperty('outputs');
    expect(domains[0].components[0]).not.toHaveProperty('dependencies');
    expect(domains[0].components[0]).not.toHaveProperty('errorHandling');
    expect(domains[0].components[0]).not.toHaveProperty('targetFile');
    const adrs = summarized['adrs'] as Array<Record<string, unknown>>;
    expect(adrs[0]).toHaveProperty('context');
    expect(adrs[0]).toHaveProperty('consequences');
    const workflows = summarized['workflows'] as Array<Record<string, unknown>>;
    expect(workflows[0]).toHaveProperty('steps');
    expect(workflows[0]).toHaveProperty('domainIds');



    const tasks = summarized['agentTasks'] as Array<Record<string, unknown>>;
    expect(tasks[0]).toHaveProperty('description');
    expect(tasks[0]).not.toHaveProperty('acceptanceCriteria');
    expect(tasks[0]).not.toHaveProperty('fileHints');
  });

  it('summarizeForPdf truncates long strings with a marker so the payload stays bounded', async () => {
    const { summarizeForPdf } = await import('./prompt-builder.service');

    const oversize = 'x'.repeat(800);
    const ulEntries: Record<string, string> = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`term-${i}`, `${oversize}-${i}`]),
    );
    const plan = {
      ...minimalPlanFixture,
      boundedContexts: [
        {
          ...minimalPlanFixture.boundedContexts[0],
          ubiquitousLanguage: ulEntries,
        },
      ],
      adrs: [{ ...minimalPlanFixture.adrs[0], context: oversize }],
    } as typeof minimalPlanFixture;
    const summarized = summarizeForPdf(plan) as Record<string, unknown>;
    const adr = (summarized['adrs'] as Array<{ context: string }>)[0];
    expect(adr.context.length).toBeLessThanOrEqual(300);
    expect(adr.context).toMatch(/…\[truncated\]$/);
    const ul = (summarized['boundedContexts'] as Array<{ ubiquitousLanguage: Record<string, string> }>)[0]
      .ubiquitousLanguage;
    expect(Object.keys(ul).length).toBeLessThanOrEqual(8);
  });

  it('buildPdfCreatorPrompt prompt template contains the expanded section skeleton and new block kinds', async () => {
    const { PDF_CREATOR_SYSTEM_PROMPT } = await import('./prompt-builder.service');
    expect(PDF_CREATOR_SYSTEM_PROMPT).toContain('Per-Layer Spec Kit Highlights');
    expect(PDF_CREATOR_SYSTEM_PROMPT).toContain('Domain Deep Dive');
    expect(PDF_CREATOR_SYSTEM_PROMPT).toContain('Glossary & Appendix');
    expect(PDF_CREATOR_SYSTEM_PROMPT).not.toContain('Risks & Open Questions');
    for (const kind of ['callout', 'glossary', 'matrix']) {
      expect(PDF_CREATOR_SYSTEM_PROMPT).toContain(kind);
    }

    expect(PDF_CREATOR_SYSTEM_PROMPT).not.toContain('kpiGrid');



    expect(PDF_CREATOR_SYSTEM_PROMPT).toMatch(/Do NOT reference .*dataFlowDiagram/);



    expect(PDF_CREATOR_SYSTEM_PROMPT).toContain('mermaidDiagram');
    expect(PDF_CREATOR_SYSTEM_PROMPT).not.toMatch(/dataFlowDiagram.*moduleDependencies/);



    expect(PDF_CREATOR_SYSTEM_PROMPT).toMatch(/paragraph text: ≤ 2 sentences/);
    expect(PDF_CREATOR_SYSTEM_PROMPT).toMatch(/bullets \/ numbered items: ≤ 6 items/);
    expect(PDF_CREATOR_SYSTEM_PROMPT).toMatch(/Total document size MUST stay under 24 KB/);

    expect(PDF_CREATOR_SYSTEM_PROMPT).toContain('NOT a single PdfSection');
    expect(PDF_CREATOR_SYSTEM_PROMPT).toContain('NOT an array of headings');
    expect(PDF_CREATOR_SYSTEM_PROMPT).toContain('degraded PDF');





    expect(PDF_CREATOR_SYSTEM_PROMPT).toMatch(/≤ 220 characters/);
    expect(PDF_CREATOR_SYSTEM_PROMPT).toMatch(/each ≤ 100 characters/);
    expect(PDF_CREATOR_SYSTEM_PROMPT).toMatch(/≤ 6 rows/);
    expect(PDF_CREATOR_SYSTEM_PROMPT).toMatch(/Hard ceiling: 8 sections/);
    expect(PDF_CREATOR_SYSTEM_PROMPT).toMatch(/mermaidRef: ≤ 1 per section/);
    expect(PDF_CREATOR_SYSTEM_PROMPT).toMatch(/Max 1 matrix per section/);
    expect(PDF_CREATOR_SYSTEM_PROMPT).toMatch(/at most 3 events/);

    expect(PDF_CREATOR_SYSTEM_PROMPT).not.toContain('twoColumn');
    expect(PDF_CREATOR_SYSTEM_PROMPT).not.toMatch(/\baudience:\s*['"`]/);
  });

  it('PDF_HEADER_SYSTEM_PROMPT contains the section-stitching mode and "two sections" rule', async () => {
    const { PDF_HEADER_SYSTEM_PROMPT } = await import('./prompt-builder.service');
    expect(PDF_HEADER_SYSTEM_PROMPT).toContain('executiveSummary');
    expect(PDF_HEADER_SYSTEM_PROMPT).toMatch(/two sections/i);
    expect(PDF_HEADER_SYSTEM_PROMPT).toContain('Executive Summary');
    expect(PDF_HEADER_SYSTEM_PROMPT).toContain('System Overview');
    expect(PDF_HEADER_SYSTEM_PROMPT).toContain('blueprint');
  });

  it('PDF_SECTION_SYSTEM_PROMPT contains the prior-sections + target-sections wiring', async () => {
    const { PDF_SECTION_SYSTEM_PROMPT } = await import('./prompt-builder.service');
    expect(PDF_SECTION_SYSTEM_PROMPT).toContain('prior sections');
    expect(PDF_SECTION_SYSTEM_PROMPT).toContain('targetSectionKinds');
    expect(PDF_SECTION_SYSTEM_PROMPT).toContain('Per-Layer Spec Kit Highlights');
    expect(PDF_SECTION_SYSTEM_PROMPT).toContain('Key Workflows');
    expect(PDF_SECTION_SYSTEM_PROMPT).toContain('Architecture Decisions (ADRs)');
  });

  it('PDF_SECTION_USER_TEMPLATE contains plan/prior/target placeholders', async () => {
    const { PDF_SECTION_USER_TEMPLATE } = await import('./prompt-builder.service');
    expect(PDF_SECTION_USER_TEMPLATE).toContain('{planJson}');
    expect(PDF_SECTION_USER_TEMPLATE).toContain('{priorSectionsJson}');
    expect(PDF_SECTION_USER_TEMPLATE).toContain('{targetSectionKinds}');
  });
});

describe('PromptBuilderService — multi-skill PDF stage', () => {
  let service: PromptBuilderService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PromptBuilderService);
  });
  function fakeResolved(agentId: string, skillId: string, prompt: string): ResolvedSkill {
    return {
      agentId,
      skill: {
        id: skillId,
        name: skillId,
        prompt,
        version: 1,
      },
    };
  }

  it('buildPdfCreatorPrompt concatenates primary + additional skills in order, separated by blank lines', async () => {
    const primary = fakeResolved('agent-4', 'skill-8', 'PRIMARY_PROMPT_BODY');
    const skill13 = fakeResolved('agent-4', 'skill-13', 'COMPOSITION_PROMPT_BODY');
    const skill14 = fakeResolved('agent-4', 'skill-14', 'DESIGN_PROMPT_BODY');
    const skill15 = fakeResolved('agent-4', 'skill-15', 'DIAGRAM_PROMPT_BODY');

    const prompt = await service.buildPdfCreatorPrompt(minimalPlanFixture, { type: 'object' }, '', [
      primary,
      skill13,
      skill14,
      skill15,
    ]);
    const rendered = await prompt.format({});

    const idxPrimary = rendered.indexOf('PRIMARY_PROMPT_BODY');
    const idx13 = rendered.indexOf('COMPOSITION_PROMPT_BODY');
    const idx14 = rendered.indexOf('DESIGN_PROMPT_BODY');
    const idx15 = rendered.indexOf('DIAGRAM_PROMPT_BODY');
    expect(idxPrimary).toBeGreaterThanOrEqual(0);
    expect(idx13).toBeGreaterThan(idxPrimary);
    expect(idx14).toBeGreaterThan(idx13);
    expect(idx15).toBeGreaterThan(idx14);



  expect(rendered).toMatch(/COMPOSITION_PROMPT_BODY\n\nDESIGN_PROMPT_BODY/);
  expect(rendered).toMatch(/DESIGN_PROMPT_BODY\n\nDIAGRAM_PROMPT_BODY/);
});

  it('buildPdfCreatorPrompt tolerates a missing additional skill without breaking the export', async () => {



    const primary = fakeResolved('agent-4', 'skill-8', 'PRIMARY_ONLY');
    const skill14 = fakeResolved('agent-4', 'skill-14', 'DESIGN_ONLY');

    const prompt = await service.buildPdfCreatorPrompt(
      minimalPlanFixture,
      { type: 'object' },
      '',



      [primary, null, skill14, null],
    );
    const rendered = await prompt.format({});
    expect(rendered).toContain('PRIMARY_ONLY');
    expect(rendered).toContain('DESIGN_ONLY');
  });

  it('buildPdfCreatorPrompt with empty skill overrides falls back to the base prompt only', async () => {
    const prompt = await service.buildPdfCreatorPrompt(
      minimalPlanFixture,
      { type: 'object' },
      '',
      [],
    );
    const rendered = await prompt.format({});



    expect(rendered).toContain('Per-Layer Spec Kit Highlights');
    expect(rendered).not.toContain('PRIMARY_PROMPT_BODY');
  });
});

describe('PromptBuilderService — resolveSkillForStage / resolveSkillsForStage', () => {
  it('resolveSkillForStage returns the legacy singular result for non-pdf stages', () => {
    const agents = {
      resolveSkill: (agentId: string, skillId: string) =>
        agentId === 'agent-1' && skillId === 'skill-1'
          ? {
              agentId,
              skill: { id: skillId, name: 'Plan Generation', prompt: 'P', version: 1 },
            }
          : null,
    };
    const result = resolveSkillForStage(agents, 'scaffold');
    expect(result?.agentId).toBe('agent-1');
    expect(result?.skill.id).toBe('skill-1');
  });

  it('resolveSkillsForStage returns the primary + all PDF_ADDITIONAL_SKILLS', () => {
    const fakeStore: Record<string, ResolvedSkill> = {
      'agent-4:skill-8': fakeResolved('agent-4', 'skill-8', 'P8'),
      'agent-4:skill-13': fakeResolved('agent-4', 'skill-13', 'P13'),
      'agent-4:skill-14': fakeResolved('agent-4', 'skill-14', 'P14'),
      'agent-4:skill-15': fakeResolved('agent-4', 'skill-15', 'P15'),
    };
    const agents = {
      resolveSkill: (agentId: string, skillId: string) =>
        fakeStore[`${agentId}:${skillId}`] ?? null,
    };
    const result = resolveSkillsForStage(agents, 'pdf');
    expect(result.map((s) => s.skill.id)).toEqual(['skill-8', 'skill-13', 'skill-14', 'skill-15']);
  });

  it('resolveSkillsForStage silently skips a missing additional skill', () => {



    const agents = {
      resolveSkill: (agentId: string, skillId: string) => {
        if (agentId !== 'agent-4') return null;
        if (skillId === 'skill-8') return fakeResolved('agent-4', 'skill-8', 'P8');
        if (skillId === 'skill-13') return fakeResolved('agent-4', 'skill-13', 'P13');
        if (skillId === 'skill-14') return fakeResolved('agent-4', 'skill-14', 'P14');

        return null;
      },
    };
    const result = resolveSkillsForStage(agents, 'pdf');
    expect(result.map((s) => s.skill.id)).toEqual(['skill-8', 'skill-13', 'skill-14']);
  });

  it('resolveSkillsForStage returns the singular result (wrapped in an array) for non-pdf stages', () => {
    const agents = {
      resolveSkill: () => fakeResolved('agent-1', 'skill-1', 'P1'),
    };
    const result = resolveSkillsForStage(agents, 'scaffold');
    expect(result).toHaveLength(1);
    expect(result[0].skill.id).toBe('skill-1');
  });

  it('resolveSkillsForStage returns an empty array when the primary skill is missing', () => {
    const agents = {
      resolveSkill: () => null,
    };
    const result = resolveSkillsForStage(agents, 'pdf');
    expect(result).toEqual([]);
  });
});

function fakeResolved(agentId: string, skillId: string, prompt: string): ResolvedSkill {
  return {
    agentId,
    skill: {
      id: skillId,
      name: skillId,
      prompt,
      version: 1,
    },
  };
}

describe('PromptBuilderService — refinement context', () => {
  let service: PromptBuilderService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PromptBuilderService);
  });

  it('leaves prompts unchanged when refinement context is empty', () => {
    expect(formatRefinementContext([])).toBe('');
    expect(formatRefinementContext([{ questionId: 'scope', value: '', skipped: true }])).toBe('');
  });

  it('adds submitted clarifications and omits skipped answers', async () => {
    const prompt = await service.buildGeneratePrompt(
      {
        title: 'Planner',
        idea: 'A planning workspace for product teams.',
        technicalConstraints: '',
        nfrs: '',
        hints: '',
        contextAttachments: [],
      },
      { type: 'object' },
      '',
      null,
      [
        { questionId: 'deployment', value: 'Browser only', skipped: false },
        { questionId: 'scale', value: '', skipped: true },
      ],
    );
    const rendered = await prompt.format({});

    expect(rendered).toContain('## User Clarifications');
    expect(rendered).toContain('- Q: deployment A: Browser only');
    expect(rendered).not.toContain('- Q: scale');
  });
});

describe('formatRefinementInstruction', () => {
  it('returns an empty string when no block is provided', () => {
    expect(formatRefinementInstruction(undefined)).toBe('');
  });

  it('returns an empty string when the block has neither instruction nor answers', () => {
    expect(formatRefinementInstruction({ instruction: '', answers: [] })).toBe('');
  });

  it('formats the instruction, original request, and collected clarifications', () => {
    const rendered = formatRefinementInstruction({
      instruction: 'Add Keycloak',
      userPrompt: 'Add authentication with OIDC',
      answers: [{ questionId: 'auth', value: 'Keycloak' }],
    });
    expect(rendered).toContain("### User's Original Request\nAdd authentication with OIDC");
    expect(rendered).toContain('- Q: auth A: Keycloak');
  });
  it('formats the instruction and collected clarifications', () => {
    const rendered = formatRefinementInstruction({
      instruction: 'Add Keycloak',
      answers: [{ questionId: 'auth', value: 'Keycloak' }],
    });
    expect(rendered).toContain('## Refinement Instruction');
    expect(rendered).toContain('Add Keycloak');
    expect(rendered).toContain('### Collected Clarifications');
    expect(rendered).toContain('- Q: auth A: Keycloak');
  });

  it('emits the Refinement Chat History block when chatTranscript has entries', () => {
    const rendered = formatRefinementInstruction({
      instruction: 'Add admin',
      answers: [],
      chatTranscript: [
        { role: 'user', text: 'Add admin panel', at: '2026-09-10T00:00:01.000Z' },
        { role: 'assistant', text: 'Where?', at: '2026-09-10T00:00:02.000Z' },
        { role: 'user', text: 'Backend.', at: '2026-09-10T00:00:03.000Z' },
      ],
    });
    expect(rendered).toContain('## Refinement Chat History');
    expect(rendered).toContain('- USER: Add admin panel');
    expect(rendered).toContain('- ASSISTANT: Where?');
    expect(rendered).toContain('- USER: Backend.');
  });

  it('caps very long transcript turns so they cannot blow the prompt budget', () => {
    const long = 'x'.repeat(2000);
    const rendered = formatRefinementInstruction({
      instruction: '',
      answers: [],
      chatTranscript: [{ role: 'user', text: long }],
    });
    expect(rendered).toContain('## Refinement Chat History');
    expect(rendered).not.toContain('x'.repeat(500));
    expect(rendered).toMatch(/x{300}…/);
  });

  it('omits the transcript block when chatTranscript is empty or absent', () => {
    const renderedEmpty = formatRefinementInstruction({
      instruction: 'Add admin',
      answers: [],
      chatTranscript: [],
    });
    expect(renderedEmpty).not.toContain('## Refinement Chat History');
    const renderedAbsent = formatRefinementInstruction({
      instruction: 'Add admin',
      answers: [],
    });
    expect(renderedAbsent).not.toContain('## Refinement Chat History');
  });
});

describe('PromptBuilderService — refinement instruction threading', () => {
  let service: PromptBuilderService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PromptBuilderService);
  });

  const refinementInstruction = {
    instruction: 'Move auth into its own domain',
    answers: [{ questionId: 'auth', value: 'Keycloak' }],
  };

  it('appends the refinement block to buildRegenerateLayerPrompt ahead of the digest', async () => {
    const prompt = await service.buildRegenerateLayerPrompt({
      layer: minimalPlanFixture.architectureLayers[0],
      currentPlan: minimalPlanFixture,
      editSummary: {
        capturedAt: '2026-09-08T00:00:00.000Z',
        preservedFilePaths: [],
        addedElements: [],
        removedElements: [],
        fieldChanges: [],
        naturalLanguageDigest: 'No edits.',
      },
      isUserAdded: false,
      schema: { type: 'object' },
      skillOverride: null,
      refinementInstruction,
    });
    const rendered = (await prompt.format({})) as string;
    const instructionIdx = rendered.indexOf('## Refinement Instruction');
    const digestIdx = rendered.indexOf('User-edit summary');
    expect(instructionIdx).toBeGreaterThan(-1);
    expect(digestIdx).toBeGreaterThan(instructionIdx);
    expect(rendered).toContain('Move auth into its own domain');
    expect(rendered).toContain('- Q: auth A: Keycloak');
    expect(rendered).toContain('## ACTION REQUIRED — Apply the Refinement Below');
    expect(rendered).toContain('Your output MUST reflect it');
  });

  it('appends the refinement block to buildRegenerateDomainPrompt', async () => {
    const prompt = await service.buildRegenerateDomainPrompt({
      domain: minimalPlanFixture.domains[0],
      currentPlan: minimalPlanFixture,
      editSummary: {
        capturedAt: '2026-09-08T00:00:00.000Z',
        preservedFilePaths: [],
        addedElements: [],
        removedElements: [],
        fieldChanges: [],
        naturalLanguageDigest: 'No edits.',
      },
      isUserAdded: false,
      schema: { type: 'object' },
      skillOverride: null,
      refinementInstruction,
    });
    const rendered = (await prompt.format({})) as string;
    expect(rendered).toContain('## Refinement Instruction');
    expect(rendered).toContain('Move auth into its own domain');
  });

  it('appends the refinement block to buildRegenerateTailPrompt', async () => {
    const prompt = await service.buildRegenerateTailPrompt({
      currentPlan: minimalPlanFixture,
      editSummary: {
        capturedAt: '2026-09-08T00:00:00.000Z',
        preservedFilePaths: [],
        addedElements: [],
        removedElements: [],
        fieldChanges: [],
        naturalLanguageDigest: 'No edits.',
      },
      schema: { type: 'object' },
      skillOverride: null,
      refinementInstruction,
    });
    const rendered = (await prompt.format({})) as string;
    expect(rendered).toContain('## Refinement Instruction');
    expect(rendered).toContain('Move auth into its own domain');
  });

  it('omits the refinement block when none is provided', async () => {
    const prompt = await service.buildRegenerateLayerPrompt({
      layer: minimalPlanFixture.architectureLayers[0],
      currentPlan: minimalPlanFixture,
      editSummary: {
        capturedAt: '2026-09-08T00:00:00.000Z',
        preservedFilePaths: [],
        addedElements: [],
        removedElements: [],
        fieldChanges: [],
        naturalLanguageDigest: 'No edits.',
      },
      isUserAdded: false,
      schema: { type: 'object' },
      skillOverride: null,
    });
    const rendered = (await prompt.format({})) as string;
    expect(rendered).not.toContain('## Refinement Instruction\n');
  });

  it('forwards originalInput.idea/technicalConstraints/nfrs/hints into buildRegenerateLayerPrompt', async () => {
    const prompt = await service.buildRegenerateLayerPrompt({
      layer: minimalPlanFixture.architectureLayers[0],
      currentPlan: minimalPlanFixture,
      editSummary: {
        capturedAt: '2026-09-08T00:00:00.000Z',
        preservedFilePaths: [],
        addedElements: [],
        removedElements: [],
        fieldChanges: [],
        naturalLanguageDigest: 'No edits.',
      },
      isUserAdded: false,
      schema: { type: 'object' },
      skillOverride: null,
      originalInput: {
        title: 'Planner App',
        idea: 'A recipe-sharing community',
        technicalConstraints: 'TypeScript end-to-end',
        nfrs: 'p95 < 200ms',
        hints: 'Angular 17 + NestJS',
        contextAttachments: [],
      },
    });
    const rendered = (await prompt.format({})) as string;
    expect(rendered).toContain('Application idea: A recipe-sharing community');
    expect(rendered).toContain('TypeScript end-to-end');
    expect(rendered).toContain('p95 < 200ms');
    expect(rendered).toContain('Angular 17 + NestJS');
  });

  it('forwards originalInput into buildRegenerateDomainPrompt and buildRegenerateTailPrompt', async () => {
    const originalInput = {
      title: 'Planner App',
      idea: 'A recipe-sharing community',
      technicalConstraints: 'TypeScript end-to-end',
      nfrs: 'p95 < 200ms',
      hints: 'Angular 17 + NestJS',
      contextAttachments: [],
    };
    const domainPrompt = await service.buildRegenerateDomainPrompt({
      domain: minimalPlanFixture.domains[0],
      currentPlan: minimalPlanFixture,
      editSummary: {
        capturedAt: '2026-09-08T00:00:00.000Z',
        preservedFilePaths: [],
        addedElements: [],
        removedElements: [],
        fieldChanges: [],
        naturalLanguageDigest: 'No edits.',
      },
      isUserAdded: false,
      schema: { type: 'object' },
      skillOverride: null,
      originalInput,
    });
    const domainRendered = (await domainPrompt.format({})) as string;
    expect(domainRendered).toContain('Application idea: A recipe-sharing community');
    expect(domainRendered).toContain('Angular 17 + NestJS');

    const tailPrompt = await service.buildRegenerateTailPrompt({
      currentPlan: minimalPlanFixture,
      editSummary: {
        capturedAt: '2026-09-08T00:00:00.000Z',
        preservedFilePaths: [],
        addedElements: [],
        removedElements: [],
        fieldChanges: [],
        naturalLanguageDigest: 'No edits.',
      },
      schema: { type: 'object' },
      skillOverride: null,
      originalInput,
    });
    const tailRendered = (await tailPrompt.format({})) as string;
    expect(tailRendered).toContain('Application idea: A recipe-sharing community');
    expect(tailRendered).toContain('Angular 17 + NestJS');
  });
});

describe('PromptBuilderService — bounded-contexts regen prompt', () => {
  let service: PromptBuilderService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PromptBuilderService);
  });

  it('lists existing ids and the cap in the system prompt', async () => {
    const prompt = await service.buildRegenerateBoundedContextsPrompt({
      currentPlan: minimalPlanFixture,
      editSummary: {
        capturedAt: '2026-09-08T00:00:00.000Z',
        preservedFilePaths: [],
        addedElements: [],
        removedElements: [],
        fieldChanges: [],
        naturalLanguageDigest: 'No edits.',
      },
      schema: { type: 'object' },
      skillOverride: null,
    });
    const system = (await prompt.format({})) as string;
    expect(system).toContain('boundedContexts');
    expect(system).toContain('Existing ids you do not explicitly remove MUST be returned verbatim');
    expect(system).toContain('Total entries (existing + new) MUST NOT exceed 12');
  });

  it('renders the existing boundedContexts JSON and the architecture layer ids', async () => {
    const prompt = await service.buildRegenerateBoundedContextsPrompt({
      currentPlan: minimalPlanFixture,
      editSummary: {
        capturedAt: '2026-09-08T00:00:00.000Z',
        preservedFilePaths: [],
        addedElements: [],
        removedElements: [],
        fieldChanges: [],
        naturalLanguageDigest: 'No edits.',
      },
      schema: { type: 'object' },
      skillOverride: null,
    });
    const rendered = (await prompt.format({})) as string;
    expect(rendered).toContain('"id": "planning"');
    expect(rendered).toContain('backend, frontend');
    expect(rendered).toContain('Existing boundedContexts JSON');
  });

  it('embeds the refinement instruction under ACTION REQUIRED when provided', async () => {
    const prompt = await service.buildRegenerateBoundedContextsPrompt({
      currentPlan: minimalPlanFixture,
      editSummary: {
        capturedAt: '2026-09-08T00:00:00.000Z',
        preservedFilePaths: [],
        addedElements: [],
        removedElements: [],
        fieldChanges: [],
        naturalLanguageDigest: 'No edits.',
      },
      schema: { type: 'object' },
      skillOverride: null,
      refinementInstruction: {
        instruction: 'Add admin-frontend as a separate bounded context',
        answers: [],
      },
    });
    const rendered = (await prompt.format({})) as string;
    expect(rendered).toContain('## ACTION REQUIRED — Apply the Refinement Below');
    expect(rendered).toContain('Add admin-frontend as a separate bounded context');
  });
});

describe('PromptBuilderService — system-overview regen prompt', () => {
  let service: PromptBuilderService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PromptBuilderService);
  });

  it('declares the three-string shape and forwards the existing bounded contexts', async () => {
    const prompt = await service.buildRegenerateSystemOverviewPrompt({
      currentPlan: minimalPlanFixture,
      editSummary: {
        capturedAt: '2026-09-08T00:00:00.000Z',
        preservedFilePaths: [],
        addedElements: [],
        removedElements: [],
        fieldChanges: [],
        naturalLanguageDigest: 'No edits.',
      },
      schema: { type: 'object' },
      skillOverride: null,
    });
    const rendered = (await prompt.format({})) as string;
    expect(rendered).toContain('boundedContextMap');
    expect(rendered).toContain('c4.contextDiagram');
    expect(rendered).toContain('c4.containerDiagram');
    expect(rendered).toContain('- planning (Planning) — layer=backend');
  });

  it('lists newly added elements under the ADDED clause', async () => {
    const prompt = await service.buildRegenerateSystemOverviewPrompt({
      currentPlan: minimalPlanFixture,
      editSummary: {
        capturedAt: '2026-09-08T00:00:00.000Z',
        preservedFilePaths: [],
        addedElements: [
          { kind: 'boundedContext', id: 'admin-frontend', name: 'Admin Frontend', element: {} },
        ],
        removedElements: [],
        fieldChanges: [],
        naturalLanguageDigest: 'Added admin-frontend.',
      },
      schema: { type: 'object' },
      skillOverride: null,
    });
    const rendered = (await prompt.format({})) as string;
    expect(rendered).toContain('ADDED since the diagrams were last drawn');
    expect(rendered).toContain('boundedContext[id=admin-frontend, name=Admin Frontend]');
  });
});

describe('PromptBuilderService — regen additions prompt', () => {
  let service: PromptBuilderService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PromptBuilderService);
  });

  it('renders existing id lists and the Refinement Instruction block', async () => {
    const prompt = await service.buildRegenerateAdditionsPrompt({
      currentPlan: minimalPlanFixture,
      editSummary: {
        capturedAt: '2026-09-08T00:00:00.000Z',
        preservedFilePaths: [],
        addedElements: [],
        removedElements: [],
        fieldChanges: [],
        naturalLanguageDigest: 'No edits.',
      },
      schema: { type: 'object' },
      skillOverride: null,
      refinementInstruction: {
        instruction: 'Add a banking domain',
        answers: [],
      },
    });
    const rendered = (await prompt.format({})) as string;
    expect(rendered).toContain('## ACTION REQUIRED — Apply the Refinement Below');
    expect(rendered).toContain('Add a banking domain');
    expect(rendered).toContain('Existing domain ids (do NOT collide)');
    expect(rendered).toContain('core-planning');
    expect(rendered).toContain('Existing architecture layer ids (do NOT collide)');
    expect(rendered).toContain('backend, frontend');
    expect(rendered).toContain('Existing bounded context ids (do NOT collide)');
    expect(rendered).toContain('planning');
    expect(rendered).toContain('Add any NEW structural elements implied by the refinement instruction.');
  });

  it('omits the Refinement Instruction block when none is provided', async () => {
    const prompt = await service.buildRegenerateAdditionsPrompt({
      currentPlan: minimalPlanFixture,
      editSummary: {
        capturedAt: '2026-09-08T00:00:00.000Z',
        preservedFilePaths: [],
        addedElements: [],
        removedElements: [],
        fieldChanges: [],
        naturalLanguageDigest: 'No edits.',
      },
      schema: { type: 'object' },
      skillOverride: null,
    });
    const rendered = (await prompt.format({})) as string;
    expect(rendered).not.toContain('## ACTION REQUIRED');
    expect(rendered).toContain('Add any NEW structural elements implied by the refinement instruction.');
  });

  it('Declares the additions response shape in the system prompt', async () => {
    const prompt = await service.buildRegenerateAdditionsPrompt({
      currentPlan: minimalPlanFixture,
      editSummary: {
        capturedAt: '2026-09-08T00:00:00.000Z',
        preservedFilePaths: [],
        addedElements: [],
        removedElements: [],
        fieldChanges: [],
        naturalLanguageDigest: 'No edits.',
      },
      schema: { type: 'object' },
      skillOverride: null,
      refinementInstruction: {
        instruction: 'Add admin contexts',
        answers: [],
      },
    });
    const rendered = (await prompt.format({})) as string;
    expect(rendered).toContain('newLayers');
    expect(rendered).toContain('newDomains');
    expect(rendered).toContain('newBoundedContexts');
    expect(rendered).toContain('does NOT collide with any existing id');
  });
});
