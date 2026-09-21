import { computeActiveSectionList } from './pdf-section-planner';
import { ArchitectureLayer, Plan } from './plan.schema';
import { minimalPlanFixture } from '../testing/fixtures';

function buildLayer(overrides: Partial<ArchitectureLayer> = {}): ArchitectureLayer {
  const base: ArchitectureLayer = {
    id: 'layer-1',
    name: 'Layer 1',
    description: 'd',
    techStack: ['Stack'],
    patterns: [],
    mermaidDiagram: 'graph TD\nA-->B',
    directoryStructure: [
      { path: 'layer-1/src', description: 'root', agentInstructions: ['step 1'] },
    ],
    constitutionCheck: [],
    complexityTracking: [],
  };
  return { ...base, ...overrides };
}

function buildPlan(overrides: Partial<Plan> = {}): Plan {
  return { ...minimalPlanFixture, ...overrides } as Plan;
}

describe('computeActiveSectionList', () => {
  it('returns all 8 sections when workflows, adrs, and all layers have technicalContext or complexityTracking', () => {
    const plan = buildPlan({
      workflows: [
        { id: 'w1', name: 'W1', description: 'd', steps: ['s1'], domainIds: [] },
      ],
      adrs: [{ id: 'a1', title: 'A1', status: 'accepted', context: 'c', decision: 'd', consequences: [] }],
      architectureLayers: [
        buildLayer({
          id: 'frontend',
          technicalContext: {
            storage: 'browser',
            targetPlatform: 'browser',
            performanceGoals: '<200ms',
            constraints: 'none',
            scaleScope: '50k MAU',
          },
        }),
      ],
    });
    const result = computeActiveSectionList(plan);
    expect(result).toEqual([
      'System Overview',
      'Bounded Contexts',
      'Architecture Layers',
      'Per-Layer Spec Kit Highlights',
      'Domain Deep Dive',
      'Key Workflows',
      'Architecture Decisions (ADRs)',
      'Glossary & Appendix',
    ]);
  });

  it('skips Per-Layer Spec Kit Highlights when no layer has populated technicalContext AND no layer has non-empty complexityTracking', () => {
    const plan = buildPlan({
      architectureLayers: [buildLayer({ id: 'frontend' })],
    });
    const result = computeActiveSectionList(plan);
    expect(result).not.toContain('Per-Layer Spec Kit Highlights');
  });

  it('includes Per-Layer Spec Kit Highlights when a layer has technicalContext populated even if complexityTracking is empty', () => {
    const plan = buildPlan({
      architectureLayers: [
        buildLayer({
          id: 'backend',
          technicalContext: {
            storage: 'Postgres',
            targetPlatform: 'linux',
            performanceGoals: 'p95',
            constraints: '',
            scaleScope: '',
          },
        }),
      ],
    });
    const result = computeActiveSectionList(plan);
    expect(result).toContain('Per-Layer Spec Kit Highlights');
  });

  it('includes Per-Layer Spec Kit Highlights when a layer has non-empty complexityTracking', () => {
    const plan = buildPlan({
      architectureLayers: [
        buildLayer({
          id: 'backend',
          complexityTracking: [{ violation: 'extra layer', whyNeeded: 'why', simplerAlternativeRejected: 'simpler' }],
        }),
      ],
    });
    const result = computeActiveSectionList(plan);
    expect(result).toContain('Per-Layer Spec Kit Highlights');
  });

  it('skips Key Workflows when plan.workflows is empty', () => {
    const plan = buildPlan({ workflows: [] });
    const result = computeActiveSectionList(plan);
    expect(result).not.toContain('Key Workflows');
  });

  it('skips Architecture Decisions (ADRs) when plan.adrs is empty', () => {
    const plan = buildPlan({ adrs: [] });
    const result = computeActiveSectionList(plan);
    expect(result).not.toContain('Architecture Decisions (ADRs)');
  });

  it('includes Key Workflows and ADRs when both arrays are non-empty', () => {
    const plan = buildPlan({
      workflows: [{ id: 'w1', name: 'W1', description: 'd', steps: [], domainIds: [] }],
      adrs: [{ id: 'a1', title: 'A1', status: 'accepted', context: 'c', decision: 'd', consequences: [] }],
    });
    const result = computeActiveSectionList(plan);
    expect(result).toContain('Key Workflows');
    expect(result).toContain('Architecture Decisions (ADRs)');
  });

  it('treats undefined workflows/adrs arrays the same as empty arrays', () => {
    const plan = buildPlan({
      workflows: undefined as unknown as Plan['workflows'],
      adrs: undefined as unknown as Plan['adrs'],
    });
    const result = computeActiveSectionList(plan);
    expect(result).not.toContain('Key Workflows');
    expect(result).not.toContain('Architecture Decisions (ADRs)');
  });

  it('skips Per-Layer Spec Kit Highlights when no architectureLayers exist', () => {
    const plan = buildPlan();
    const result = computeActiveSectionList(plan);
    expect(result).not.toContain('Per-Layer Spec Kit Highlights');
  });
});
