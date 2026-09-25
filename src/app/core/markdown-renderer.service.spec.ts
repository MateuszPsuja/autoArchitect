import { TestBed } from '@angular/core/testing';
import { MarkdownRendererService, replaceVagueAdjectives } from './markdown-renderer.service';
import { minimalPlanFixture } from '../testing/fixtures';
import { Plan } from './plan.schema';
import { featureFolder } from './feature-slug';

describe('MarkdownRendererService', () => {
  let service: MarkdownRendererService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(MarkdownRendererService);
  });

  const PREFIX = featureFolder(minimalPlanFixture);

  describe('toMarkdownFiles()', () => {
    it('returns root ARCHITECTURE.md and AGENTS.md under the spec-kit folder', () => {
      const files = service.toMarkdownFiles(minimalPlanFixture);
      const paths = files.map((f) => f.path);

      expect(paths).toContain(`${PREFIX}/ARCHITECTURE.md`);
      expect(paths).toContain(`${PREFIX}/AGENTS.md`);
    });

    it('emits the spec-kit artefacts (spec/plan/data-model/contracts/quickstart/tasks)', () => {
      const files = service.toMarkdownFiles(minimalPlanFixture);
      const paths = files.map((f) => f.path);

      expect(paths).toContain(`${PREFIX}/spec.md`);
      expect(paths).toContain(`${PREFIX}/plan.md`);
      expect(paths).toContain(`${PREFIX}/data-model.md`);
      expect(paths).toContain(`${PREFIX}/quickstart.md`);
      expect(paths).toContain(`${PREFIX}/tasks.md`);
      expect(paths).toContain(`${PREFIX}/README.md`);
      expect(paths).toContain(`${PREFIX}/contracts/backend.md`);
      expect(paths).toContain(`${PREFIX}/contracts/frontend.md`);
    });

    it('emits the spec-kit checklist.md artefact (T1 of spec-kit workflow compliance plan)', () => {
      const files = service.toMarkdownFiles(minimalPlanFixture);
      const paths = files.map((f) => f.path);

      expect(paths).toContain(`${PREFIX}/checklist.md`);
    });

    it('returns the two surviving system docs (C4 blueprints were dropped)', () => {
      const files = service.toMarkdownFiles(minimalPlanFixture);
      const paths = files.map((f) => f.path);

      expect(paths).toContain(`${PREFIX}/docs/00-system/overview.md`);
      expect(paths).toContain(`${PREFIX}/docs/00-system/bounded-context-map.md`);
      expect(paths).not.toContain(`${PREFIX}/docs/00-system/system-context-blueprint.md`);
      expect(paths).not.toContain(`${PREFIX}/docs/00-system/container-blueprint.md`);
    });

    it('returns architecture overview and one layer file per architectureLayer', () => {
      const files = service.toMarkdownFiles(minimalPlanFixture);
      const paths = files.map((f) => f.path);

      expect(paths).toContain(`${PREFIX}/docs/10-architecture/overview.md`);
      expect(paths).toContain(`${PREFIX}/docs/10-architecture/backend-architecture.md`);
      expect(paths).toContain(`${PREFIX}/docs/10-architecture/frontend-architecture.md`);
    });

    it('returns one ADR file per adr entry', () => {
      const files = service.toMarkdownFiles(minimalPlanFixture);
      const adrFiles = files.filter((f) => f.path.includes('/docs/20-decisions/'));

      expect(adrFiles.length).toBe(minimalPlanFixture.adrs.length);
    });

    it('returns 5 files per backend domain', () => {
      const files = service.toMarkdownFiles(minimalPlanFixture);
      const backendFiles = files.filter((f) =>
        f.path.includes('/docs/30-backend/core-planning/'),
      );

      expect(backendFiles.length).toBe(5);
    });

    it('returns a domain/aggregates.md file for backend domains', () => {
      const files = service.toMarkdownFiles(minimalPlanFixture);
      const paths = files.map((f) => f.path);

      expect(paths).toContain(`${PREFIX}/docs/30-backend/core-planning/domain/aggregates.md`);
    });

    it('returns a domain/domain-services.md file for backend domains', () => {
      const files = service.toMarkdownFiles(minimalPlanFixture);
      const paths = files.map((f) => f.path);

      expect(paths).toContain(`${PREFIX}/docs/30-backend/core-planning/domain/domain-services.md`);
    });

    it('returns an application/use-cases.md file for backend domains', () => {
      const files = service.toMarkdownFiles(minimalPlanFixture);
      const paths = files.map((f) => f.path);

      expect(paths).toContain(`${PREFIX}/docs/30-backend/core-planning/application/use-cases.md`);
    });

    it('returns an implementation order index file', () => {
      const files = service.toMarkdownFiles(minimalPlanFixture);
      const paths = files.map((f) => f.path);

      expect(paths).toContain(`${PREFIX}/docs/60-agent-tasks/00-implementation-order.md`);
    });

    it('returns a per-directory AGENTS.md from architectureLayers.directoryStructure when explicitly opted in', () => {
      const files = service.toMarkdownFiles(minimalPlanFixture, { includeDirectoryAgents: true });
      const paths = files.map((f) => f.path);

      expect(paths).toContain('src/app/features/planner/AGENTS.md');
    });

    it('omits per-directory AGENTS.md by default so the spec-kit zip stays flat under specs/<NNN>-<slug>/', () => {
      const files = service.toMarkdownFiles(minimalPlanFixture);
      const paths = files.map((f) => f.path);

      const directoryAgents = paths.filter((p) => /\/AGENTS\.md$/.test(p) && !p.startsWith(`${PREFIX}/`));
      expect(directoryAgents).toEqual([]);
    });

    it('strips a leading specs/ from directoryStructure paths so per-directory AGENTS.md lands at zip root (no specs/specs/ doubling)', () => {
      const plan: Plan = {
        ...minimalPlanFixture,
        architectureLayers: minimalPlanFixture.architectureLayers.map((l) =>
          l.id === 'backend'
            ? {
                ...l,
                directoryStructure: [
                  { path: 'specs/backend/app', description: 'app', agentInstructions: ['do x'] },
                  { path: 'specs/specs/backend/lib', description: 'lib', agentInstructions: ['do y'] },
                  { path: 'backend/legacy', description: 'legacy', agentInstructions: ['do z'] },
                ],
              }
            : l,
        ),
      };
      const files = service.toMarkdownFiles(plan, { includeDirectoryAgents: true });
      const paths = files.map((f) => f.path);

      expect(paths).toContain('backend/app/AGENTS.md');
      expect(paths).toContain('backend/lib/AGENTS.md');
      expect(paths).toContain('backend/legacy/AGENTS.md');
      expect(paths).not.toContain('specs/backend/app/AGENTS.md');
      expect(paths).not.toContain('specs/specs/backend/lib/AGENTS.md');
      expect(paths.some((p) => /^specs\/specs\//.test(p))).toBe(false);
    });

    it('produces at least 10 files total for the minimal fixture', () => {
      const files = service.toMarkdownFiles(minimalPlanFixture);

      expect(files.length).toBeGreaterThanOrEqual(10);
    });

    it('never emits a fenced ```mermaid block in any markdown file (spec-kit fixture)', () => {
      const speckitPlan: Plan = (() => {
        const base = minimalPlanFixture;
        return {
          ...base,
          architectureLayers: base.architectureLayers.map((l) => ({
            ...l,
            mermaidDiagram: 'graph TD\nA-->B',
            componentTreeDiagram: 'classDiagram\nclass Foo',
            dataFlowDiagram: 'sequenceDiagram\nA->>B: call',
            moduleDependenciesDiagram: 'graph LR\nI-->A',
            stateManagementDiagram: 'stateDiagram-v2\n[*] --> idle',
            apiContractDiagram: 'sequenceDiagram\nClient->>API: GET',
          })),
        };
      })();

      const files = service.toMarkdownFiles(speckitPlan);
      const offenders = files.filter((f) => f.content.includes('```mermaid'));

      expect(offenders.map((f) => f.path)).toEqual([]);
    });
  });

  describe('spec-kit v3 deliverable shape', () => {
    it('emits .specify/memory/constitution.md at the bundle root', () => {
      const files = service.toMarkdownFiles(minimalPlanFixture);
      expect(files.map((f) => f.path)).toContain('.specify/memory/constitution.md');
    });

    it('renders the constitution.md with all 9 articles and a Governance section', () => {
      const files = service.toMarkdownFiles(minimalPlanFixture);
      const constitution = files.find(
        (f) => f.path === '.specify/memory/constitution.md',
      )!;

      expect(constitution).toBeTruthy();
      expect(constitution.content).toContain('## Article 1 — Library-First');
      expect(constitution.content).toContain('## Article 9 — Integration-First');
      expect(constitution.content).toContain('## Governance');
    });

    it('uses the NNN-slug spec-kit folder prefix', () => {
      expect(PREFIX).toBe('specs/001-planner-fixture');
    });

    it('renders spec.md with prioritised user stories and Given/When/Then scenarios', () => {
      const files = service.toMarkdownFiles(minimalPlanFixture);
      const spec = files.find((f) => f.path === `${PREFIX}/spec.md`)!;

      expect(spec).toBeTruthy();
      expect(spec.content).toContain('**Feature Branch**');
      expect(spec.content).toContain('### User Story US001');
      expect(spec.content).toContain('(Priority: P1)');
      expect(spec.content).toContain('**Given** a developer');
      expect(spec.content).toContain('**When** they click Generate Plan');
      expect(spec.content).toContain('**Then** a Plan JSON is produced');
      expect(spec.content).toContain('### Functional Requirements');
      expect(spec.content).toContain('FR-001');
      expect(spec.content).toContain('### Measurable Outcomes');
      expect(spec.content).toContain('SC-001');
    });

    it('emits plan.md with the 9-row Technical Context table and a branch header', () => {
      const files = service.toMarkdownFiles(minimalPlanFixture);
      const plan = files.find((f) => f.path === `${PREFIX}/plan.md`)!;

      const tableRows = [
        '**Language / Version**',
        '**Primary Dependencies**',
        '**Storage**',
        '**Testing**',
        '**Target Platform**',
        '**Project Type**',
        '**Performance Goals**',
        '**Constraints**',
        '**Scale / Scope**',
      ];

      for (const row of tableRows) {
        expect(plan.content).toContain(row);
      }
      expect(plan.content).toContain('**Branch**');
      expect(plan.content).toContain('001-planner-fixture');
    });

    it('emits tasks.md with User Story phases and a tests-first block inside each phase', () => {
      const files = service.toMarkdownFiles(minimalPlanFixture);
      const tasks = files.find((f) => f.path === `${PREFIX}/tasks.md`)!;

      expect(tasks.content).toContain('## Phase 1: Setup (Shared Infrastructure)');
      expect(tasks.content).toContain('## Phase 3: User Story US001');
      expect(tasks.content).toContain('(Priority: P1)');
      expect(tasks.content).toContain('Tests for User Story US001');
      expect(tasks.content).toContain('Implementation for User Story US001');
    });

    it('references userStoryIds on agent task files', () => {
      const files = service.toMarkdownFiles(minimalPlanFixture);
      const taskFiles = files.filter(
        (f) =>
          f.path.startsWith(`${PREFIX}/docs/60-agent-tasks/`) &&
          /^\d+-/.test(f.path.split('/').pop() ?? ''),
      );
      expect(taskFiles.length).toBeGreaterThan(0);
    });
  });

  describe('content quality', () => {
    it('ARCHITECTURE.md does not contain a mermaid diagram block', () => {
      const files = service.toMarkdownFiles(minimalPlanFixture);
      const archFile = files.find((f) => f.path === `${PREFIX}/ARCHITECTURE.md`)!;

      expect(archFile.content).not.toContain('```mermaid');
    });

    it('bounded-context-map.md contains ubiquitous language table', () => {
      const files = service.toMarkdownFiles(minimalPlanFixture);
      const bcFile = files.find((f) => f.path === `${PREFIX}/docs/00-system/bounded-context-map.md`)!;

      expect(bcFile.content).toContain('Ubiquitous Language');
      expect(bcFile.content).toContain('| Term | Definition |');
    });

    it('domain-services.md contains Given:/When:/Then: TDD section', () => {
      const files = service.toMarkdownFiles(minimalPlanFixture);
      const svcFile = files.find(
        (f) => f.path === `${PREFIX}/docs/30-backend/core-planning/domain/domain-services.md`,
      )!;

      expect(svcFile.content).toContain('Given:');
      expect(svcFile.content).toContain('When:');
      expect(svcFile.content).toContain('Then:');
    });

    it('domain-services.md contains acceptance criteria checkboxes', () => {
      const files = service.toMarkdownFiles(minimalPlanFixture);
      const svcFile = files.find(
        (f) => f.path === `${PREFIX}/docs/30-backend/core-planning/domain/domain-services.md`,
      )!;

      expect(svcFile.content).toContain('- [ ]');
    });

    it('aggregates.md lists invariants and domain events', () => {
      const files = service.toMarkdownFiles(minimalPlanFixture);
      const aggFile = files.find(
        (f) => f.path === `${PREFIX}/docs/30-backend/core-planning/domain/aggregates.md`,
      )!;

      expect(aggFile.content).toContain('Invariants');
      expect(aggFile.content).toContain('Domain Events');
    });

    it('directory AGENTS.md contains checkbox agent instructions', () => {
      const files = service.toMarkdownFiles(minimalPlanFixture, { includeDirectoryAgents: true });
      const agentsFile = files.find((f) => f.path === 'src/app/features/planner/AGENTS.md')!;

      expect(agentsFile.content).toContain('- [ ]');
      expect(agentsFile.content).toContain('Agent Instructions');
    });

    it('ADR file contains status and decision sections', () => {
      const files = service.toMarkdownFiles(minimalPlanFixture);
      const adrFile = files.find((f) => f.path.includes('/docs/20-decisions/adr-001-'))!;

      expect(adrFile.content).toContain('**Status:**');
      expect(adrFile.content).toContain('## Decision');
    });
  });

  describe('spec-kit per-layer architecture documents', () => {
    function buildSpeckitFixture(): Plan {
      return {
        ...minimalPlanFixture,
        architectureLayers: [
          {
            id: 'backend',
            name: 'Backend',
            description: 'FastAPI service for plan storage.',
            techStack: ['Python 3.11', 'FastAPI'],
            patterns: ['Clean Architecture'],
            mermaidDiagram: 'graph TD\nAPI-->DB',
            summary: 'FastAPI service exposing plan CRUD.',
            technicalContext: {
              storage: 'PostgreSQL 15',
              targetPlatform: 'Linux server',
              performanceGoals: 'p95 < 200ms',
              constraints: 'Domain layer has no framework imports',
              scaleScope: '5k RPS',
            },
            constitutionCheck: ['Domain has no framework imports'],
            projectStructureTree: 'backend/src/',
            complexityTracking: [],
            componentTreeDiagram: 'classDiagram\nclass Foo',
            dataFlowDiagram: 'sequenceDiagram\nA->>B: call',
            moduleDependenciesDiagram: 'graph LR\nI-->A',
            apiContractDiagram: 'sequenceDiagram\nClient->>API: GET',
            directoryStructure: [
              {
                path: 'backend/src/plans',
                description: 'Plans bounded context.',
                agentInstructions: [
                  'Create PlanAggregate with publish/unpublish commands.',
                  'Create PlanRepository wrapping SQLAlchemy sessions.',
                  'Create use cases that orchestrate the aggregate and repository.',
                ],
              },
            ],
          },
          {
            ...minimalPlanFixture.architectureLayers[1],
            summary: 'Angular SPA for plan generation and review.',
            technicalContext: {
              storage: 'N/A',
              targetPlatform: 'Browser',
              performanceGoals: 'TTI < 3s',
              constraints: 'Signals only',
              scaleScope: '50k MAU',
            },
            constitutionCheck: [
              'Strict TypeScript',
              'Standalone components only',
              'patchState for all mutations',
            ],
            projectStructureTree: 'src/\n  app/\n    features/',
            complexityTracking: [],
            componentTreeDiagram: 'graph TD\nA-->B',
            dataFlowDiagram: 'flowchart LR\nX-->Y',
            moduleDependenciesDiagram: 'graph LR\nF-->C',
            stateManagementDiagram: 'stateDiagram-v2\n[*] --> idle',
          },
        ],
        domains: [
          {
            ...minimalPlanFixture.domains[0],
            layer: 'backend',
            directoryPath: 'backend/src/plans',
          },
          {
            id: 'reading',
            name: 'Reading',
            description: 'Public reader.',
            layer: 'frontend',
            responsibilities: ['Render the home feed'],
            aggregates: [],
            domainEvents: [],
            directoryPath: 'frontend/src/app/features/reading',
            components: [
              {
                id: 'reading-component-1',
                name: 'ReadingShell',
                description: 'Shell component.',
                type: 'ui-component',
                layer: 'presentation',
                responsibilities: ['Render routes'],
                inputs: ['Route params'],
                outputs: ['Rendered routes'],
                dependencies: [],
                publicApi: ['render()'],
                errorHandling: 'render empty state',
                acceptanceCriteria: ['renders without error'],
                tddSpec: {
                  unitTests: [
                    { description: 'renders', given: ['a router outlet'], when: 'render', then: ['ok'] },
                    { description: 'handles empty', given: ['empty'], when: 'render', then: ['ok'] },
                  ],
                  integrationTests: [
                    { description: 'navigates', given: ['a route'], when: 'navigate', then: ['ok'] },
                  ],
                },
                targetFile: 'frontend/src/app/features/reading/reading.component.ts',
                outOfScope: ['Auth'],
              },
            ],
          },
        ],
      };
    }

    it('frontend-architecture.md renders the spec-kit sections in order', () => {
      const files = service.toMarkdownFiles(buildSpeckitFixture());
      const doc = files.find((f) => f.path === `${PREFIX}/docs/10-architecture/frontend-architecture.md`)!;

      expect(doc).toBeTruthy();

      const summaryIdx = doc.content.indexOf('## Summary');
      const tcIdx = doc.content.indexOf('## Technical Context');
      const ccIdx = doc.content.indexOf('## Constitution Check');
      const psIdx = doc.content.indexOf('## Project Structure');
      const complexityIdx = doc.content.indexOf('## Complexity Tracking');
      expect(summaryIdx).toBeGreaterThan(-1);
      expect(tcIdx).toBeGreaterThan(summaryIdx);
      expect(ccIdx).toBeGreaterThan(tcIdx);
      expect(psIdx).toBeGreaterThan(ccIdx);
      expect(complexityIdx).toBeGreaterThan(psIdx);
      expect(doc.content).not.toContain('## Diagrams');
    });

    it('Technical Context renders a 5-row markdown table with the required fields', () => {
      const files = service.toMarkdownFiles(buildSpeckitFixture());
      const doc = files.find((f) => f.path === `${PREFIX}/docs/10-architecture/frontend-architecture.md`)!;

      expect(doc.content).toContain('| **Storage** | N/A |');
      expect(doc.content).toContain('| **Target Platform** | Browser |');
      expect(doc.content).toContain('| **Performance Goals** | TTI < 3s |');
      expect(doc.content).toContain('| **Constraints** | Signals only |');
      expect(doc.content).toContain('| **Scale / Scope** | 50k MAU |');
    });

    it('Constitution Check renders each gate as a checkmark bullet', () => {
      const files = service.toMarkdownFiles(buildSpeckitFixture());
      const doc = files.find((f) => f.path === `${PREFIX}/docs/10-architecture/frontend-architecture.md`)!;

      expect(doc.content).toContain('- ✅ Strict TypeScript');
      expect(doc.content).toContain('- ✅ Standalone components only');
      expect(doc.content).toContain('- ✅ patchState for all mutations');
    });

    it('Project Structure renders a fenced text block with the source tree', () => {
      const files = service.toMarkdownFiles(buildSpeckitFixture());
      const doc = files.find((f) => f.path === `${PREFIX}/docs/10-architecture/frontend-architecture.md`)!;

      expect(doc.content).toContain('### Documentation (this layer)');
      expect(doc.content).toContain('### Source Code');
      expect(doc.content).toMatch(/```text\nsrc\/[\s\S]*app\/[\s\S]*features\//);
    });

    it('per-layer documents do not embed named diagram headings or mermaid blocks', () => {
      const files = service.toMarkdownFiles(buildSpeckitFixture());
      const doc = files.find((f) => f.path === `${PREFIX}/docs/10-architecture/frontend-architecture.md`)!;

      expect(doc.content).not.toContain('### Component Tree');
      expect(doc.content).not.toContain('### Data Flow');
      expect(doc.content).not.toContain('### Module Dependencies');
      expect(doc.content).not.toContain('### State Management');
      expect(doc.content).not.toContain('### API Contract');
      expect(doc.content).not.toContain('```mermaid');
    });

    it('Complexity Tracking renders an empty-state blockquote when tracking is empty', () => {
      const files = service.toMarkdownFiles(buildSpeckitFixture());
      const doc = files.find((f) => f.path === `${PREFIX}/docs/10-architecture/frontend-architecture.md`)!;

      expect(doc.content).toContain('## Complexity Tracking');
      expect(doc.content).toContain('> No constitution violations; standard complexity.');
    });

    it('Complexity Tracking renders a table with one row per entry when populated', () => {
      const fixture = buildSpeckitFixture();
      const frontendIndex = fixture.architectureLayers.findIndex((l) => l.id === 'frontend');
      fixture.architectureLayers[frontendIndex] = {
        ...fixture.architectureLayers[frontendIndex],
        complexityTracking: [
          {
            violation: 'Repository pattern',
            whyNeeded: 'Testability of use cases',
            simplerAlternativeRejected: 'Direct SQLAlchemy sessions — couples domain to ORM',
          },
        ],
      };

      const files = service.toMarkdownFiles(fixture);
      const doc = files.find((f) => f.path === `${PREFIX}/docs/10-architecture/frontend-architecture.md`)!;

      expect(doc.content).toContain('| Violation | Why Needed | Simpler Alternative Rejected Because |');
      expect(doc.content).toContain('| Repository pattern | Testability of use cases | Direct SQLAlchemy sessions — couples domain to ORM |');
      expect(doc.content).not.toContain('> No constitution violations');
    });

    it('renders gracefully when no spec-kit fields are present (legacy plans)', () => {



      const legacyFixture: Plan = {
        ...minimalPlanFixture,
        architectureLayers: [
          {
            ...minimalPlanFixture.architectureLayers[0],
            summary: undefined,
            technicalContext: undefined,
            constitutionCheck: undefined,
            projectStructureTree: undefined,
            complexityTracking: undefined,
            componentTreeDiagram: undefined,
            dataFlowDiagram: undefined,
            moduleDependenciesDiagram: undefined,
            stateManagementDiagram: undefined,
            apiContractDiagram: undefined,
          },
        ],
      };

      const files = service.toMarkdownFiles(legacyFixture);
      const layerId = legacyFixture.architectureLayers[0].id;
      const doc = files.find((f) => f.path === `${PREFIX}/docs/10-architecture/${layerId}-architecture.md`)!;

      expect(doc.content).toContain('## Summary');
      expect(doc.content).toContain('## Technical Context');
      expect(doc.content).toContain('## Project Structure');
      expect(doc.content).toContain('## Complexity Tracking');

      expect(doc.content).not.toContain('## Constitution Check');
      expect(doc.content).not.toContain('### Component Tree');
      expect(doc.content).not.toContain('### Data Flow');
      expect(doc.content).not.toContain('## Diagrams');
      expect(doc.content).not.toContain('```mermaid');
    });

    it('back-compat: a domain with layer "frontend" but no presentation components still uses the interactive template', () => {





      const legacyFrontendDomain: Plan = {
        ...minimalPlanFixture,
        domains: [
          {
            ...minimalPlanFixture.domains[0],
            layer: 'frontend',
            components: [
              {
                id: 'svc-1',
                name: 'LegacyService',
                description: 'Service',
                type: 'service',
                layer: 'application',
                responsibilities: ['serve'],
                inputs: ['req'],
                outputs: ['res'],
                dependencies: [],
                publicApi: ['invoke()'],
                errorHandling: 'throws',
                acceptanceCriteria: ['ok'],
                tddSpec: {
                  unitTests: [
                    { description: 't', given: ['g'], when: 'w', then: ['th'] },
                    { description: 't', given: ['g'], when: 'w', then: ['th'] },
                  ],
                  integrationTests: [
                    { description: 't', given: ['g'], when: 'w', then: ['th'] },
                  ],
                },
                targetFile: 'svc.ts',
                outOfScope: ['x'],
              },
            ],
          },
        ],
      };
      const files = service.toMarkdownFiles(legacyFrontendDomain);
      const paths = files.map((f) => f.path);
      expect(paths).toContain(`${PREFIX}/docs/40-frontend/core-planning/overview.md`);
      expect(paths).toContain(`${PREFIX}/docs/40-frontend/core-planning/components.md`);
      expect(paths).toContain(`${PREFIX}/docs/40-frontend/core-planning/services.md`);
      expect(paths).toContain(`${PREFIX}/docs/40-frontend/core-planning/state.md`);
    });

    it('routes free-form kebab-case layer ids through the new path scheme (e.g. cli/core)', () => {
      const cliPlan: Plan = {
        ...minimalPlanFixture,
        architectureLayers: [
          {
            id: 'cli',
            name: 'CLI',
            description: 'Python CLI',
            techStack: ['Python 3.11'],
            patterns: ['Clean Architecture'],
            mermaidDiagram: 'graph TD\nA-->B',
            directoryStructure: [],
          },
          {
            id: 'core',
            name: 'Core',
            description: 'Library',
            techStack: ['Python 3.11'],
            patterns: [],
            mermaidDiagram: 'graph TD\nC-->D',
            directoryStructure: [],
          },
        ],
        domains: [
          {
            ...minimalPlanFixture.domains[0],
            layer: 'core',
          },
        ],
      };
      const files = service.toMarkdownFiles(cliPlan);
      const paths = files.map((f) => f.path);
      expect(paths).toContain(`${PREFIX}/docs/10-architecture/cli-architecture.md`);
      expect(paths).toContain(`${PREFIX}/docs/10-architecture/core-architecture.md`);

      expect(paths.some((p) => p.includes('/docs/40-core/core-planning/'))).toBe(true);
    });
  });

  describe('buildWorkflowMd robustness', () => {
    it('renders a workflow whose `domainIds` / `steps` is explicitly null', () => {





      const plan: Plan = {
        ...minimalPlanFixture,
        workflows: [
          {
            id: 'wf-null',
            name: 'Null workflow',
            description: 'Has null steps + null domainIds.',
            steps: null as unknown as string[],
            domainIds: null as unknown as string[],
          },
        ],
      };

      const files = service.toMarkdownFiles(plan);
      const workflowFile = files.find((f) => f.path === `${PREFIX}/docs/50-workflows/wf-null.md`);
      expect(workflowFile).toBeDefined();
      expect(workflowFile!.content).toContain('# Null workflow');

      expect(workflowFile!.content).toContain('## Steps');
      expect(workflowFile!.content).toContain('## Domains Involved');
    });
  });

  describe('checklist.md (spec-kit /speckit.checklist)', () => {
    function findChecklist(plan: Plan): { path: string; content: string } {
      const files = service.toMarkdownFiles(plan);
      const file = files.find((f) => f.path === `${PREFIX}/checklist.md`);
      expect(file).toBeTruthy();
      return file!;
    }

    function buildCompliantFixture(): Plan {
      const tddSpec = minimalPlanFixture.domains[0].components[0].tddSpec;
      return {
        ...minimalPlanFixture,
        architectureLayers: [
          {
            ...minimalPlanFixture.architectureLayers[0],
            summary: 'API and orchestration layer.',
            technicalContext: {
              storage: 'PostgreSQL 15',
              targetPlatform: 'Linux server',
              performanceGoals: 'p95 < 200ms',
              constraints: 'Strict TS',
              scaleScope: '5k RPS',
            },
            constitutionCheck: ['Domain has no framework imports'],
            projectStructureTree: 'backend/src/',
            complexityTracking: [],
          },
          {
            ...minimalPlanFixture.architectureLayers[1],
            summary: 'Angular SPA for plan generation and review.',
            technicalContext: {
              storage: 'N/A',
              targetPlatform: 'Browser',
              performanceGoals: 'TTI < 3s',
              constraints: 'Signals only',
              scaleScope: '50k MAU',
            },
            constitutionCheck: [
              'Strict TypeScript',
              'Standalone components only',
              'patchState for all mutations',
            ],
            projectStructureTree: 'src/\n  app/',
            complexityTracking: [],
          },
        ],
        domains: [
          {
            ...minimalPlanFixture.domains[0],
            layer: 'backend',
            directoryPath: 'backend/src/core-planning',
            components: [
              {
                ...minimalPlanFixture.domains[0].components[0],
                tddSpec,
              },
            ],
          },
          {
            id: 'reading',
            name: 'Reading',
            description: 'Public reader.',
            layer: 'frontend',
            responsibilities: ['Render the home feed'],
            aggregates: [],
            domainEvents: [],
            directoryPath: 'src/app/features/reading',
            components: [
              {
                id: 'reading-component-1',
                name: 'ReadingShell',
                description: 'Shell component.',
                type: 'ui-component',
                layer: 'presentation',
                responsibilities: ['Render routes'],
                inputs: ['Route params'],
                outputs: ['Rendered routes'],
                dependencies: [],
                publicApi: ['render()'],
                errorHandling: 'render empty state',
                acceptanceCriteria: ['renders without error'],
                tddSpec,
                targetFile: 'src/app/features/reading/reading.component.ts',
                outOfScope: ['Auth'],
              },
            ],
          },
        ],
      };
    }

    it('renders all five compliance sections in order', () => {
      const { content } = findChecklist(minimalPlanFixture);
      const expectedHeadings = [
        '## Specification Clarity',
        '## Acceptance Criteria Quality',
        '## Test Coverage',
        '## NFR Coverage',
        '## Spec-Kit Compliance',
      ];

      let lastIndex = -1;
      for (const heading of expectedHeadings) {
        const idx = content.indexOf(heading);
        expect(idx).toBeGreaterThan(lastIndex);
        lastIndex = idx;
      }
    });

    it('marks every gate as passed for a fully spec-kit compliant fixture (golden file)', () => {
      const { content } = findChecklist(buildCompliantFixture());

      expect(content).toContain(
        '- [x] CHK001 No `NEEDS CLARIFICATION` markers detected anywhere in the plan — the spec is unambiguous.',
      );
      expect(content).toContain(
        '- [x] CHK002 All 1 agent task(s) carry a non-empty `acceptanceCriteria[]`.',
      );
      expect(content).toMatch(/- \[x\] CHK003 All 2 component\(s\) ship a `tddSpec` \(\d+ BDD scenario\(s\) total/);
      expect(content).toContain(
        '- [x] CHK004 All 2 architecture layer(s) ship a non-empty `constitutionCheck[]` (NFRs + quality bars).',
      );
      expect(content).toContain(
        '- [x] CHK005 All 2 architecture layer(s) carry the spec-kit section set: `summary`, `technicalContext` (5 rows), `projectStructure`, `complexityTracking`, `domainAreas`.',
      );
    });

    it('reflects the minimal fixture as partially compliant (NFR + Spec-Kit Compliance fail because constitutionCheck/technicalContext/complexityTracking/domainAreas are unset)', () => {
      const { content } = findChecklist(minimalPlanFixture);

      expect(content).toContain(
        '- [x] CHK001 No `NEEDS CLARIFICATION` markers detected anywhere in the plan — the spec is unambiguous.',
      );
      expect(content).toMatch(/- \[x\] CHK003 All 1 component\(s\) ship a `tddSpec` \(\d+ BDD scenario\(s\) total/);
      expect(content).toMatch(/- \[ \] CHK004 2 layer\(s\) missing `constitutionCheck\[\]`: `backend`, `frontend`\./);
      expect(content).toMatch(/- \[ \] CHK005 2 layer\(s\) have gaps:/);
      expect(content).toContain('`backend` is missing: technicalContext, complexityTracking.');
      expect(content).toContain('`frontend` is missing: technicalContext, complexityTracking, domainAreas.');
    });

    it('flips Specification Clarity to fail when a Plan field contains a NEEDS CLARIFICATION marker', () => {
      const plan: Plan = {
        ...minimalPlanFixture,
        architectureLayers: minimalPlanFixture.architectureLayers.map((l, i) =>
          i === 0
            ? { ...l, summary: 'NEEDS CLARIFICATION: which auth provider should we use?' }
            : l,
        ),
      };

      const { content } = findChecklist(plan);

      expect(content).toMatch(/- \[ \] CHK001 1 `NEEDS CLARIFICATION` marker\(s\) detected/);
    });

    it('flips NFR Coverage to fail when a layer has no constitutionCheck', () => {
      const compliant = buildCompliantFixture();
      const plan: Plan = {
        ...compliant,
        architectureLayers: compliant.architectureLayers.map((l, i) =>
          i === 0 ? l : { ...l, constitutionCheck: undefined },
        ),
      };

      const { content } = findChecklist(plan);

      expect(content).toMatch(/- \[ \] CHK004 1 layer\(s\) missing `constitutionCheck\[\]`: `frontend`\./);
    });

    it('flips Spec-Kit Compliance to fail when a layer is missing technicalContext or summary', () => {
      const plan: Plan = {
        ...minimalPlanFixture,
        architectureLayers: minimalPlanFixture.architectureLayers.map((l, i) =>
          i === 0
            ? { ...l, summary: undefined, technicalContext: undefined }
            : l,
        ),
      };

      const { content } = findChecklist(plan);

      expect(content).toMatch(/- \[ \] CHK005 2 layer\(s\) have gaps:/);
      expect(content).toContain('`backend` is missing: summary, technicalContext, complexityTracking.');
      expect(content).toContain('`frontend` is missing: technicalContext, complexityTracking, domainAreas.');
    });

    it('numbers CHK### continuously across the four categories (Specification Clarity → Spec-Kit Compliance)', () => {
      const { content } = findChecklist(minimalPlanFixture);
      const ids = Array.from(content.matchAll(/(- \[[ x]\] )(CHK\d{3})/g)).map((m) => m[2]);
      expect(ids.length).toBeGreaterThanOrEqual(5);
      const sorted = [...ids].sort();
      expect(ids).toEqual(sorted);
      expect(ids[0]).toBe('CHK001');
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('toSafeHtml()', () => {
    function unwrap(safeHtml: ReturnType<MarkdownRendererService['toSafeHtml']>): string {
      const el = document.createElement('div');
      el.innerHTML = (safeHtml as unknown as { changingThisBreaksApplicationSecurity: string })
        .changingThisBreaksApplicationSecurity;
      return el.innerHTML;
    }

    it('renders an H1 from "# H1"', () => {
      const html = unwrap(service.toSafeHtml('# H1'));
      expect(html).toContain('<h1>H1</h1>');
    });

    it('renders a GFM table from pipe syntax into <table><thead>', () => {
      const md = ['| A | B |', '|---|---|', '| 1 | 2 |'].join('\n');
      const html = unwrap(service.toSafeHtml(md));
      expect(html).toContain('<table>');
      expect(html).toContain('<thead>');
      expect(html).toContain('<th>A</th>');
      expect(html).toContain('<td>1</td>');
    });

    it('strips a <script> tag from input markdown', () => {
      const md = 'hello\n\n<script>alert(1)</script>\n';
      const html = unwrap(service.toSafeHtml(md));
      expect(html).not.toContain('<script');
      expect(html).not.toContain('alert(1)');
    });

    it('rewrites anchors to target="_blank" rel="noopener noreferrer"', () => {
      const md = '[click](https://example.com)';
      const html = unwrap(service.toSafeHtml(md));
      expect(html).toMatch(/<a [^>]*href="https:\/\/example\.com"/);
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');
    });

    it('returns an empty string for empty input', () => {
      const html = unwrap(service.toSafeHtml(''));
      expect(html).toBe('');
    });
  });

  describe('spec-kit plan gate fixes', () => {
    it('rewrites "Mini Max" (split) typo to the canonical MiniMax brand in emitted files', () => {
      const plan: Plan = {
        ...minimalPlanFixture,
        boundedContexts: [
          {
            ...minimalPlanFixture.boundedContexts[0],
            ubiquitousLanguage: { Plan: 'Mini Max powered planner fixture' },
          },
        ],
      };
      const files = service.toMarkdownFiles(plan);
      const offenders = files.filter((f) => /\bMini\sMax\b/.test(f.content));
      expect(offenders.length).toBe(0);
      expect(files.some((f) => /MiniMax powered planner fixture/.test(f.content))).toBe(true);
    });

    it('rewrites Lang Chain and AngularJS to LangChain / Angular', () => {
      const plan: Plan = {
        ...minimalPlanFixture,
        systemOverview: {
          ...minimalPlanFixture.systemOverview,
          context: 'A web app using Lang Chain for agent flows; AngularJS legacy components.',
        },
      };
      const files = service.toMarkdownFiles(plan);
      const offenders = files.filter(
        (f) => /\bLang\sChain\b/.test(f.content) || /\bAngularJS\b/.test(f.content),
      );
      expect(offenders.length).toBe(0);
      expect(files.some((f) => /LangChain for agent flows/.test(f.content))).toBe(true);
      expect(files.some((f) => /Angular legacy components/.test(f.content))).toBe(true);
    });

    it('emits the ## See also cross-reference block in plan.md', () => {
      const files = service.toMarkdownFiles(minimalPlanFixture);
      const plan = files.find((f) => f.path === `${PREFIX}/plan.md`)!;
      expect(plan.content).toContain('## See also');
      expect(plan.content).toContain('[./data-model.md](./data-model.md)');
      expect(plan.content).toContain('[./contracts/](./contracts/)');
      expect(plan.content).toContain('[./quickstart.md](./quickstart.md)');
      expect(plan.content).toContain('[./checklist.md](./checklist.md)');
    });

    it('marks each empty Article content as PENDING in the Constitution Check section', () => {
      const pendingConstitution = {
        ...minimalPlanFixture.constitution!,
        articles: minimalPlanFixture.constitution!.articles.map((a) =>
          a.articleNumber === 3 ? { ...a, content: '' } : a,
        ),
      };
      const plan: Plan = { ...minimalPlanFixture, constitution: pendingConstitution };
      const files = service.toMarkdownFiles(plan);
      const planMd = files.find((f) => f.path === `${PREFIX}/plan.md`)!;
      expect(planMd.content).toMatch(/⚠️ PENDING/);
      expect(planMd.content).toContain('regenerate the plan to ratify the constitution');
    });

    it('emits a PENDING banner when no constitution is attached', () => {
      const plan: Plan = { ...minimalPlanFixture, constitution: undefined };
      const files = service.toMarkdownFiles(plan);
      const planMd = files.find((f) => f.path === `${PREFIX}/plan.md`)!;
      expect(planMd.content).toContain('⚠️ PENDING');
    });

    it('emits the langchain decision sub-line in the Primary Dependencies cell', () => {
      const plan: Plan = {
        ...minimalPlanFixture,
        architectureLayers: minimalPlanFixture.architectureLayers.map((l) =>
          l.id === 'backend'
            ? { ...l, techStack: ['NestJS 10', 'LangChain', 'PostgreSQL 15'] }
            : l,
        ),
      };
      const files = service.toMarkdownFiles(plan);
      const planMd = files.find((f) => f.path === `${PREFIX}/plan.md`)!;
      expect(planMd.content).toContain('_langchain decision:');
      expect(planMd.content).toMatch(
        /_langchain decision:[^_]*LangChain \/ LangGraph for the agentic pipeline/,
      );
    });

    it('emits the agent-framework exclusion sub-line when LangChain is absent and agentFramework is unset', () => {
      const files = service.toMarkdownFiles(minimalPlanFixture);
      const planMd = files.find((f) => f.path === `${PREFIX}/plan.md`)!;
      expect(planMd.content).toContain('Agent framework: none');
      expect(planMd.content).toContain('ADR-0001');
    });

    it('emits a single Source Code block listing directories from agentTasks.fileHints (no separate mapped sub-block)', () => {
      const plan: Plan = {
        ...minimalPlanFixture,
        agentTasks: [
          ...minimalPlanFixture.agentTasks,
          {
            id: 'task-002',
            title: 'Implement API contract',
            description: 'Define the input/output contract',
            acceptanceCriteria: ['contract is exported'],
            fileHints: ['src/app/features/planner/contracts/api.ts'],
            userStoryIds: ['US001'],
          },
        ],
      };
      const files = service.toMarkdownFiles(plan);
      const planMd = files.find((f) => f.path === `${PREFIX}/plan.md`)!;
      expect(planMd.content).not.toContain('### Source Code (mapped to tasks)');
      expect(planMd.content).toContain('src/app/features/planner/contracts/');
    });

    it('uses contiguous T### ids and emits zero T-FOUND- / T-TEST- variants', () => {
      const files = service.toMarkdownFiles(minimalPlanFixture);
      const tasks = files.find((f) => f.path === `${PREFIX}/tasks.md`)!;
      expect(tasks.content).not.toMatch(/T-FOUND-/);
      expect(tasks.content).not.toMatch(/T-TEST-/);
      expect(tasks.content).not.toMatch(/T-NN\d/);
      const ids = Array.from(tasks.content.matchAll(/- \[ \] (T\d{3})/g)).map((m) => m[1]);
      expect(ids.length).toBeGreaterThan(0);
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    });

    it('emits ghost-component tasks in Phase 2 when domain layers lack controller/orchestrator/repo', () => {
      const plan: Plan = {
        ...minimalPlanFixture,
        domains: [
          {
            ...minimalPlanFixture.domains[0],
            components: minimalPlanFixture.domains[0].components.map((c) => ({
              ...c,
              type: 'domain-service' as const,
            })),
          },
        ],
      };
      const files = service.toMarkdownFiles(plan);
      const tasks = files.find((f) => f.path === `${PREFIX}/tasks.md`)!;
      expect(tasks.content).toContain('## Phase 2: Foundational');
      expect(tasks.content).toContain('(ghost)');
      expect(tasks.content).toMatch(/\(ghost\)\s+Scaffold the application-layer controller/);
      expect(tasks.content).toMatch(/\(ghost\)\s+Scaffold the use-case orchestrator/);
      expect(tasks.content).toMatch(/\(ghost\)\s+Scaffold the persistence repository/);
    });

    it('emits owned Tests + Implementation sub-phases in the Polish phase', () => {
      const plan: Plan = {
        ...minimalPlanFixture,
        successCriteria: [
          { id: 'SC-001', text: 'Users can complete a flow in under 5s.' },
          { id: 'SC-002', text: '95% of users finish the task without assistance.' },
        ],
      };
      const files = service.toMarkdownFiles(plan);
      const tasks = files.find((f) => f.path === `${PREFIX}/tasks.md`)!;
      expect(tasks.content).toMatch(/## Phase \d+: Polish & Cross-Cutting Concerns/);
      expect(tasks.content).toContain('### Tests for the polish phase');
      expect(tasks.content).toContain('### Implementation for the polish phase');
      expect(tasks.content).toContain('SC-001 measurement harness');
      expect(tasks.content).toContain('SC-002 measurement harness');
    });

    it('synthesises starter synthetic tasks scoped to the story bounded contexts (D6)', () => {
      const plan: Plan = {
        ...minimalPlanFixture,
        agentTasks: [],
        userStories: [
          {
            ...minimalPlanFixture.userStories[0],
            boundedContextIds: ['image-gen-pipeline', 'persona-edit-surface'],
            description:
              'Wire the image-generation pipeline and support persona-edit so the operator can re-roll.',
          },
        ],
      };
      const files = service.toMarkdownFiles(plan);
      const tasks = files.find((f) => f.path === `${PREFIX}/tasks.md`)!;
      expect(tasks.content).toContain('(synth)');
      expect(tasks.content).toMatch(/\(synth\)\s+\[US001\]\s+Wire the image-generation pipeline/);
      expect(tasks.content).toMatch(/\(synth\)\s+\[US001\]\s+Implement the persona-editing surface/);
    });

    it('renders Article 3 with an appended enforcement sentence when the LLM provided a vague line', () => {
      const vagueConstitution = {
        ...minimalPlanFixture.constitution!,
        articles: minimalPlanFixture.constitution!.articles.map((a) =>
          a.articleNumber === 3 ? { ...a, content: 'No tests before merge.' } : a,
        ),
      };
      const plan: Plan = { ...minimalPlanFixture, constitution: vagueConstitution };
      const files = service.toMarkdownFiles(plan);
      const constitution = files.find((f) => f.path === '.specify/memory/constitution.md')!;
      expect(constitution.content).toMatch(/## Article 3 — Test-First/);
      expect(constitution.content).toMatch(/CI gate blocks merges when coverage falls/);
    });

    it('emits the dropped marker for Article 2 when its content is empty', () => {
      const droppedConstitution = {
        ...minimalPlanFixture.constitution!,
        articles: minimalPlanFixture.constitution!.articles.map((a) =>
          a.articleNumber === 2 ? { ...a, content: '' } : a,
        ),
      };
      const plan: Plan = { ...minimalPlanFixture, constitution: droppedConstitution };
      const files = service.toMarkdownFiles(plan);
      const constitution = files.find((f) => f.path === '.specify/memory/constitution.md')!;
      expect(constitution.content).toContain('Dropped in this project');
      expect(constitution.content).toContain('no CLI surface is planned');
    });

    it('renders the constitution.md fallback pending marker when no constitution is attached', () => {
      const plan: Plan = { ...minimalPlanFixture, constitution: undefined };
      const files = service.toMarkdownFiles(plan);
      const constitution = files.find((f) => f.path === '.specify/memory/constitution.md')!;
      expect(constitution.content).toContain('⚠️ PENDING');
    });
  });

  describe('spec-kit export compatibility (frontmatter + markers)', () => {
    function withUserIdea(idea: string): Plan {
      return { ...minimalPlanFixture, meta: { ...minimalPlanFixture.meta, userIdea: idea } };
    }

    it('emits **Status**: Draft and **Input**: line in spec.md when userIdea is set', () => {
      const files = service.toMarkdownFiles(withUserIdea('Build a microblog with image generation.'));
      const spec = files.find((f) => f.path === `${PREFIX}/spec.md`)!;
      expect(spec).toBeTruthy();
      expect(spec.content).toContain('**Status**: Draft');
      expect(spec.content).toContain('**Input**: User description: "Build a microblog with image generation."');
      const statusIdx = spec.content.indexOf('**Status**: Draft');
      const inputIdx = spec.content.indexOf('**Input**:');
      const featureBranchIdx = spec.content.indexOf('**Feature Branch**');
      expect(statusIdx).toBeGreaterThan(-1);
      expect(statusIdx).toBeLessThan(inputIdx);
      expect(inputIdx).toBeLessThan(featureBranchIdx);
    });

    it('emits the placeholder **Input**: line when userIdea is missing', () => {
      const plan = { ...minimalPlanFixture };
      delete (plan.meta as { userIdea?: string }).userIdea;
      const files = service.toMarkdownFiles(plan);
      const spec = files.find((f) => f.path === `${PREFIX}/spec.md`)!;
      expect(spec.content).toContain(
        '**Input**: User description: "<original user idea not captured — regenerate to populate>"',
      );
      expect(spec.content).toContain('**Status**: Draft');
    });

    it('escapes embedded double-quotes and backslashes in the user idea', () => {
      const files = service.toMarkdownFiles(withUserIdea('She said "go" and use C:\\newlines'));
      const spec = files.find((f) => f.path === `${PREFIX}/spec.md`)!;
      expect(spec.content).toContain('**Input**: User description: "She said \\"go\\" and use C:\\\\newlines"');
    });

    it('renders italic *(mandatory)* markers on the Requirements and Success Criteria section headers', () => {
      const files = service.toMarkdownFiles(minimalPlanFixture);
      const spec = files.find((f) => f.path === `${PREFIX}/spec.md`)!;
      expect(spec.content).toContain('## Requirements *(mandatory)*');
      expect(spec.content).toContain('## Success Criteria *(mandatory)*');
      expect(spec.content).not.toMatch(/^## Requirements \(mandatory\)$/m);
      expect(spec.content).not.toMatch(/^## Success Criteria \(mandatory\)$/m);
    });

    it('emits the __SPECKIT_COMMAND_PLAN__ Note line and Structure Decision line in plan.md', () => {
      const files = service.toMarkdownFiles(minimalPlanFixture);
      const plan = files.find((f) => f.path === `${PREFIX}/plan.md`)!;
      expect(plan.content).toContain(
        '**Note**: This template is filled in by the `__SPECKIT_COMMAND_PLAN__` command; its definition describes the execution workflow.',
      );
      expect(plan.content).toContain(
        '**Structure Decision**: [Document the selected structure — see the per-layer `projectStructureTree` diagrams in `docs/10-architecture/`]',
      );
      const specLinkIdx = plan.content.indexOf('[./spec.md](./spec.md)');
      const noteIdx = plan.content.indexOf('**Note**:');
      expect(specLinkIdx).toBeGreaterThan(-1);
      expect(noteIdx).toBeGreaterThan(specLinkIdx);
    });

    it('emits the Fill ONLY blockquote intro above Complexity Tracking when tracking is populated AND a constitution gate fails', () => {
      const layer = minimalPlanFixture.architectureLayers[0];
      const plan: Plan = {
        ...minimalPlanFixture,
        architectureLayers: [
          {
            ...layer,
            constitutionCheck: ['❌ Article 2 — CLI surface missing for at least one bounded context'],
            complexityTracking: [
              {
                violation: 'Repository pattern',
                whyNeeded: 'Testability',
                simplerAlternativeRejected: 'Direct SQL',
              },
            ],
          },
          ...minimalPlanFixture.architectureLayers.slice(1),
        ],
      };
      const files = service.toMarkdownFiles(plan);
      const planMd = files.find((f) => f.path === `${PREFIX}/plan.md`)!;
      expect(planMd.content).toContain(
        '> **Fill ONLY if Constitution Check has violations that must be justified**',
      );
      const fillIdx = planMd.content.indexOf('Fill ONLY');
      const tableIdx = planMd.content.indexOf('| Layer | Violation');
      expect(fillIdx).toBeGreaterThan(-1);
      expect(tableIdx).toBeGreaterThan(fillIdx);
    });

    it('does NOT emit the Fill ONLY blockquote when Complexity Tracking is empty', () => {
      const files = service.toMarkdownFiles(minimalPlanFixture);
      const planMd = files.find((f) => f.path === `${PREFIX}/plan.md`)!;
      expect(planMd.content).not.toContain('Fill ONLY');
    });

    it('emits [US###] bracket tags on the task line in tasks.md (not parenthesised form)', () => {
      const plan: Plan = {
        ...minimalPlanFixture,
        agentTasks: [],
        userStories: [
          {
            ...minimalPlanFixture.userStories[0],
            description:
              'Wire the image-generation pipeline and support persona-edit so the operator can re-roll.',
          },
        ],
      };
      const files = service.toMarkdownFiles(plan);
      const tasks = files.find((f) => f.path === `${PREFIX}/tasks.md`)!;
      const matches = tasks.content.match(/- \[ \] T\d{3} (?:\[[P]\] |\([a-z-]+\) )?\[[A-Z]{2}\d{3}\] /g);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBeGreaterThan(0);
      expect(tasks.content).not.toMatch(/- \[ \] T\d{3} (?:(?:\[[P]\] |\([a-z-]+\) )?)\(US\d{3}\)/);
    });

    it('also uses [US###] in the Parallel Example block', () => {
      const files = service.toMarkdownFiles(minimalPlanFixture);
      const tasks = files.find((f) => f.path === `${PREFIX}/tasks.md`)!;
      expect(tasks.content).toContain('T101 [P] [US001] Build the Post aggregate');
      expect(tasks.content).toContain('T102 [P] [US001] Build the PostRepository');
      expect(tasks.content).toContain('T103     [US001] Wire the Post REST controller');
    });
  });

  describe('spec.md /speckit-analyze improvements', () => {
    function findSpec(plan: Plan): { path: string; content: string } {
      const files = service.toMarkdownFiles(plan);
      const file = files.find((f) => f.path === `${PREFIX}/spec.md`);
      expect(file).toBeTruthy();
      return file!;
    }

    function planWithFr010(needsClarification: boolean): Plan {
      return {
        ...minimalPlanFixture,
        functionalRequirements: [
          ...minimalPlanFixture.functionalRequirements,
          {
            id: 'FR-010',
            text: 'embedding model + dimension [NEEDS CLARIFICATION: which model and dimension?]',
            needsClarification,
          },
        ],
      };
    }

    it('renders the inline (resolved at generation time) paragraph for FR-010 and drops the [NEEDS CLARIFICATION] marker', () => {
      const { content } = findSpec(planWithFr010(true));
      expect(content).toContain('**FR-010** (resolved at generation time)');
      expect(content).toContain('Embedding Versioning');
      expect(content).not.toMatch(/\[NEEDS CLARIFICATION[^\]]*embedding/i);
      const fr010Idx = content.indexOf('**FR-010**');
      expect(fr010Idx).toBeGreaterThan(-1);
      const block = content.slice(fr010Idx, fr010Idx + 800);
      expect(block).toContain('MiniMax text-embedding-v1');
      expect(block).toContain('deterministic-embedding');
      expect(block).toContain('Schema migration');
      expect(block).toContain('Sample backfill');
    });

    it('renders FR-010 normally when the LLM did not flag it as needsClarification', () => {
      const { content } = findSpec(planWithFr010(false));
      expect(content).toContain('**FR-010** —');
      expect(content).not.toContain('(resolved at generation time)');
    });

    it('emits the new top-level spec-kit sections (Offline Behaviour, Accessibility, Glossary, Non-Goals, Open Questions, Preconditions & Constraints)', () => {
      const { content } = findSpec({
        ...minimalPlanFixture,
        offlineContract: {
          cacheableAssets: ['avatar-manifest.json'],
          degrade: [
            { capability: 'llm', mode: 'queue', reason: 'Queue requests for replay on reconnect.' },
            { capability: 'stt', mode: 'cached', reason: 'Use the cached STT bundle.' },
          ],
          uiIndicator: 'A persistent banner shows the offline state.',
          replayOnReconnect: ['queue:llm-turn'],
        },
        accessibilityRequirements: [
          { id: 'FR-A11Y-001', text: 'keyboard navigation across the avatar surface', needsClarification: false },
          { id: 'FR-A11Y-002', text: 'captions toggle persisted', needsClarification: false },
        ],
        agentTasks: [
          {
            ...minimalPlanFixture.agentTasks[0],
            description: 'NEEDS CLARIFICATION: which auth provider should we use?',
          },
        ],
        meta: {
          ...minimalPlanFixture.meta,
          operationalConstraints: {
            sidecarBind: '127.0.0.1',
            auth: 'none',
            multiTenantBan: 'enforced at sidecar listen address',
          },
        },
      });

      expect(content).toContain('## Offline Behaviour');
      expect(content).toContain('## Preconditions & Constraints');
      expect(content).toContain('## Non-Goals');
      expect(content).toContain('## Open Questions');
      expect(content).toContain('## Glossary');
      expect(content).toContain('### Accessibility');
      expect(content).toContain('FR-A11Y-001');
      expect(content).toContain('FR-A11Y-002');
      expect(content).toContain('Per-capability degradation matrix');
      expect(content).toContain('<!-- anchor: open-questions -->');
    });

    it('warns with the multi-tenant-ban marker when sidecarBind is 0.0.0.0', () => {
      const { content } = findSpec({
        ...minimalPlanFixture,
        meta: {
          ...minimalPlanFixture.meta,
          operationalConstraints: {
            sidecarBind: '0.0.0.0',
            auth: 'none',
            multiTenantBan: 'enforced at sidecar listen address',
          },
        },
      });
      expect(content).toContain('⚠️ MULTI-TENANT-BAN VIOLATION: sidecar binds 0.0.0.0');
    });

    it('renders ↔ FR- and ↔ SC- cross-reference bullets on each user story', () => {
      const { content } = findSpec({
        ...minimalPlanFixture,
        userStories: [
          {
            ...minimalPlanFixture.userStories[0],
            description:
              'Validate FR-001, FR-002, and SC-001 against the plan; the renderer should surface them as cross-refs.',
          },
        ],
        functionalRequirements: [
          { id: 'FR-001', text: 'a', needsClarification: false },
          { id: 'FR-002', text: 'b', needsClarification: false },
        ],
        successCriteria: [{ id: 'SC-001', text: 'c' }],
      });
      expect(content).toContain('↔ FR-001');
      expect(content).toContain('↔ FR-002');
      expect(content).toContain('↔ SC-001');
    });

    it('appends a US-007 transcript export skeleton when no US-007 is in the plan', () => {
      const { content } = findSpec(minimalPlanFixture);
      expect(content).toContain('### User Story US007 — Transcript export');
      expect(content).toContain('Transcript format:');
    });

    it('renders the Personality key entity as a first-class entry under Key Entities', () => {
      const { content } = findSpec({
        ...minimalPlanFixture,
        keyEntities: [
          {
            id: 'Personality',
            name: 'Personality',
            description: 'A user-authored persona document.',
            fields: [
              { name: 'voice', type: 'string', rules: ['≤ 2000 chars', 'DOMPurify-scrubbed'] },
            ],
            invariants: ['voice must round-trip the export pipeline unchanged'],
          },
          {
            id: 'Avatar',
            name: 'Avatar',
            description: 'An avatar record.',
            fields: [],
            invariants: [],
          },
        ],
      });
      const personalityIdx = content.indexOf('**Personality** _(first-class)_');
      const avatarIdx = content.indexOf('**Avatar**');
      expect(personalityIdx).toBeGreaterThan(-1);
      expect(avatarIdx).toBeGreaterThan(-1);
      expect(personalityIdx).toBeLessThan(avatarIdx);
      expect(content).toContain('`voice`: string _(rules: ≤ 2000 chars; DOMPurify-scrubbed)_');
      expect(content).toContain('voice must round-trip the export pipeline unchanged');
    });

    it('renders the Avatar Bundle Schema block when plan.meta.avatarBundleSpec is present', () => {
      const { content } = findSpec({
        ...minimalPlanFixture,
        meta: {
          ...minimalPlanFixture.meta,
          avatarBundleSpec: {
            manifestVersion: '1',
            manifestKeys: ['id', 'name', 'voiceUrl'],
            importValidatorRef: 'src/app/core/avatar-import.ts',
          },
        },
      });
      expect(content).toContain('### Avatar Bundle Schema');
      expect(content).toContain('**Manifest version:** `1`');
      expect(content).toContain('`id`, `name`, `voiceUrl`');
    });

    it('renders the Measurable Outcomes table with the Measurement Scenario column when any SC has one', () => {
      const { content } = findSpec({
        ...minimalPlanFixture,
        successCriteria: [
          { id: 'SC-001', text: 'A user can produce a valid Plan in under 90 seconds.' },
          { id: 'SC-003', text: 'A warm session reaches the same UX as a cold session within 3 minutes.' },
          { id: 'SC-005', text: 'boolean gate', measurementScenario: 'sample size n=10' },
        ],
      });
      expect(content).toContain('| ID | Outcome | Measurement Scenario |');
      expect(content).toContain('warm session, single avatar, 10 Mbps');
      expect(content).toContain('warm session = ≤3 min idle');
      expect(content).toContain('sample size n=10');
    });

    it('lifts the canonical edge-case FRs into the Functional Requirements when their trigger phrases appear in constraints', () => {
      const { content } = findSpec({
        ...minimalPlanFixture,
        architectureLayers: [
          {
            ...minimalPlanFixture.architectureLayers[0],
            constitutionCheck: ['Strict TypeScript', 'codegen:check in CI'],
          },
        ],
        systemOverview: {
          ...minimalPlanFixture.systemOverview,
          constraints: ['Domain has no framework imports', 'No secrets in production bundle'],
        },
      });
      expect(content).toContain('**FR-SEC-001**');
      expect(content).toContain('**FR-TS-001**');
      expect(content).toContain('**FR-NOFRAME-001**');
      expect(content).toContain('**FR-CGCHK-001**');
    });

    it('seeds ## Non-Goals and ## Glossary from the canonical defaults when the plan does not provide them', () => {
      const { content } = findSpec(minimalPlanFixture);
      expect(content).toContain('Multi-user / multi-tenant');
      expect(content).toContain('Voice / avatar marketplace');
      expect(content).toContain('bounded context');
      expect(content).toContain('sidecar');
      expect(content).toContain('Default seed — override via');
      expect(content).toContain('_(default seed)_');
    });

    it('uses plan-supplied glossary / non-goals when present and does not prepend the seed marker', () => {
      const { content } = findSpec({
        ...minimalPlanFixture,
        nonGoals: ['Cloud sync'],
        glossary: [{ term: 'plan', definition: 'an architecture plan artefact' }],
      });
      expect(content).toContain('Cloud sync');
      expect(content).not.toContain('Multi-user / multi-tenant');
      expect(content).toContain('| **plan** | an architecture plan artefact |');
      expect(content).not.toContain('_(default seed)_');
    });
  });

  describe('replaceVagueAdjectives', () => {
    it('downgrades "fast", "smooth", "intuitive", "robust", "seamless", "effortless", "natural" to [TODO: measure]', () => {
      const out = replaceVagueAdjectives('A fast, smooth, intuitive, robust, seamless, effortless, natural UX.');
      expect(out).toBe(
        'A [TODO: measure], [TODO: measure], [TODO: measure], [TODO: measure], [TODO: measure], [TODO: measure], [TODO: measure] UX.',
      );
    });

    it('leaves non-matching text intact', () => {
      const out = replaceVagueAdjectives('A measurable UX with predictable latency.');
      expect(out).toBe('A measurable UX with predictable latency.');
    });

    it('runs in toMarkdownFiles() post-processing so the bundle never carries vague adjectives', () => {
      const plan: Plan = {
        ...minimalPlanFixture,
        boundedContexts: [
          {
            ...minimalPlanFixture.boundedContexts[0],
            description: 'The runtime must feel fast and intuitive to the operator.',
          },
        ],
      };
      const files = service.toMarkdownFiles(plan);
      const offenders = files.filter((f) => /\b(fast|intuitive|smooth|robust|seamless|effortless|natural)\b/i.test(f.content));
      expect(offenders.length).toBe(0);
    });
  });
});

