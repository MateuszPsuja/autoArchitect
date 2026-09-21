import { describe, expect, it } from 'vitest';
import {
  buildArchitectureBlueprint,
  buildTechStackDiagram,
  summariseArchitectureLayers,
} from './architecture-blueprint';
import type { Plan } from './plan.schema';

function makePlan(): Plan {
  return {
    meta: {
      title: 'Waitress Helper',
      summary: 'POC SPA for restaurant waitresses',
      generatedAt: '2026-01-01T00:00:00Z',
      model: 'test',
      featureNumber: 1,
      featureSlug: 'waitress-helper',
    },
    systemOverview: {
      purpose: 'Take and manage restaurant orders',
      context: 'Web app used by waitresses on tablets in restaurants',
      keyActors: ['Waitress', 'Manager'],
      constraints: ['offline-tolerant'],
      nfrs: ['< 1s response'],
      c4: {
        contextDiagram: 'A-->B',
        containerDiagram: 'C-->D',
      },
    },
    boundedContexts: [
      {
        id: 'ctx-orders',
        name: 'Orders',
        description: 'Order lifecycle and persistence',
        layer: 'backend',
        ubiquitousLanguage: { Order: 'A single customer request' },
      },
      {
        id: 'ctx-menu',
        name: 'Menu',
        description: 'Menu item catalogue and pricing',
        layer: 'backend',
        ubiquitousLanguage: { MenuItem: 'A dish or drink sold' },
      },
      {
        id: 'ctx-spa',
        name: 'Waitress Helper SPA',
        description: 'Single-page Angular UI used on tablets',
        layer: 'frontend',
        ubiquitousLanguage: { OrderView: 'Table-side order list' },
      },
      {
        id: 'ctx-shared',
        name: 'Shared Kernel',
        description: 'Value objects shared between contexts',
        layer: 'shared',
        ubiquitousLanguage: { Money: 'Amount + currency' },
      },
    ],
    architectureLayers: [
      {
        id: 'frontend',
        name: 'Frontend',
        description: 'Angular SPA layer',
        techStack: ['Angular 21', 'PrimeNG', 'TypeScript 5'],
        patterns: ['Signals', 'Standalone Components'],
        mermaidDiagram: '',
        directoryStructure: [],
      },
      {
        id: 'backend',
        name: 'Backend',
        description: 'API layer',
        techStack: ['NestJS 10', 'PostgreSQL 15', 'Drizzle'],
        patterns: ['Clean Architecture'],
        mermaidDiagram: '',
        directoryStructure: [],
      },
      {
        id: 'shared',
        name: 'Shared',
        description: 'Shared types',
        techStack: ['TypeScript', 'Zod'],
        patterns: [],
        mermaidDiagram: '',
        directoryStructure: [],
      },
      {
        id: 'infrastructure',
        name: 'Infrastructure',
        description: 'Deployment',
        techStack: ['Docker', 'Caddy'],
        patterns: [],
        mermaidDiagram: '',
        directoryStructure: [],
      },
    ],
    domains: [
      {
        id: 'dom-orders',
        name: 'Orders',
        description: 'Order aggregate',
        layer: 'backend',
        responsibilities: ['manage order items'],
        aggregates: [],
        domainEvents: [],
        directoryPath: 'src/contexts/orders',
        components: [
          { id: 'c-ord-agg', name: 'OrderAggregate', type: 'aggregate',
            description: 'Order root', layer: 'domain',
            responsibilities: ['enforce invariants'],
            inputs: ['command'], outputs: ['event'], publicApi: ['execute()'], dependencies: [],
            errorHandling: 'throws', acceptanceCriteria: ['x'], tddSpec: { unitTests: [], integrationTests: [] },
            targetFile: 'o.ts', outOfScope: ['y'] },
          { id: 'c-ord-handler', name: 'PlaceOrderHandler', type: 'use-case',
            description: 'orchestrates', layer: 'application',
            responsibilities: ['orchestrate'], inputs: ['cmd'], outputs: ['result'],
            publicApi: ['execute()'], dependencies: [], errorHandling: 'throws',
            acceptanceCriteria: ['x'], tddSpec: { unitTests: [], integrationTests: [] },
            targetFile: 'h.ts', outOfScope: ['y'] },
          { id: 'c-ord-repo', name: 'OrderRepository', type: 'repository',
            description: 'persists', layer: 'infrastructure',
            responsibilities: ['persist'], inputs: ['agg'], outputs: ['agg'],
            publicApi: ['save()'], dependencies: [], errorHandling: 'throws',
            acceptanceCriteria: ['x'], tddSpec: { unitTests: [], integrationTests: [] },
            targetFile: 'r.ts', outOfScope: ['y'] },
        ],
      },
      {
        id: 'dom-menu',
        name: 'Menu',
        description: 'Menu catalogue',
        layer: 'backend',
        responsibilities: ['list items'],
        aggregates: [],
        domainEvents: [],
        directoryPath: 'src/contexts/menu',
        components: [
          { id: 'c-menu-svc', name: 'MenuService', type: 'service',
            description: 'service', layer: 'application',
            responsibilities: ['list'], inputs: ['q'], outputs: ['items'],
            publicApi: ['list()'], dependencies: [], errorHandling: 'throws',
            acceptanceCriteria: ['x'], tddSpec: { unitTests: [], integrationTests: [] },
            targetFile: 'm.ts', outOfScope: ['y'] },
        ],
      },
    ],
    workflows: [],
    adrs: [],
    agentTasks: [],
    refinementChats: [],
    userStories: [],
    functionalRequirements: [],
    successCriteria: [],
  };
}

describe('buildArchitectureBlueprint', () => {
  it('returns a single-node placeholder when the plan is empty', () => {
    const empty = {
      ...makePlan(),
      systemOverview: {
        ...makePlan().systemOverview,
        keyActors: [],
      },
      boundedContexts: [],
      domains: [],
    } as Plan;
    const out = buildArchitectureBlueprint(empty);
    expect(out).toMatch(/^graph TD\n/);
    expect(out).toContain('No architecture data yet');
  });

  it('renders a header subgraph for key actors', () => {
    const out = buildArchitectureBlueprint(makePlan());
    expect(out).toContain('subgraph S_actors["Key Actors"]');
    expect(out).toContain('"Waitress"');
    expect(out).toContain('"Manager"');
  });

  it('groups bounded contexts by layer into subgraphs', () => {
    const out = buildArchitectureBlueprint(makePlan());
    expect(out).toContain('subgraph S_ctx_1["Frontend Contexts"]');
    expect(out).toContain('subgraph S_ctx_2["Backend Contexts"]');
    expect(out).toContain('subgraph S_ctx_3["Shared Contexts"]');
    expect(out).toContain('Waitress Helper SPA');
    expect(out).toMatch(/Orders\nOrder lifecycle/);
    expect(out).toContain('Shared Kernel');
  });

  it('renders domains and at most N components per domain', () => {
    const out = buildArchitectureBlueprint(makePlan(), { componentsPerDomainLimit: 2 });
    expect(out).toContain('subgraph S_dom["Domains & Components"]');

    expect(out).toContain('OrderAggregate');
    expect(out).toContain('PlaceOrderHandler');
    expect(out).not.toContain('OrderRepository');
  });

  it('does not include the tech-stack subgraph in the main blueprint', () => {
    const out = buildArchitectureBlueprint(makePlan());
    expect(out).not.toContain('subgraph S_tech');

    expect(out).not.toContain('Angular 21');
    expect(out).not.toContain('PostgreSQL 15');
  });

  it('draws labeled actor->context edges and context->domain dotted edges', () => {
    const out = buildArchitectureBlueprint(makePlan());

    expect(out).toMatch(/-->/);
    expect(out).toContain('"uses"');

    expect(out).toMatch(/-\.->/);
    expect(out).toContain('"implemented by"');

    expect(out).not.toMatch(/linkStyle \d+ stroke:#0284c7/);
    expect(out).not.toMatch(/linkStyle \d+ stroke:#7c3aed/);
  });

  it('applies layer-specific colours to architecture subgraphs', () => {
    const out = buildArchitectureBlueprint(makePlan());
    expect(out).toContain('classDef cluster');
    expect(out).toMatch(/clusterPalette0\s+fill:#e0f2fe/);
    expect(out).toMatch(/clusterPalette1\s+fill:#dcfce7/);
    expect(out).toMatch(/clusterPalette2\s+fill:#fef3c7/);
    expect(out).toMatch(/clusterDomain\s+fill:#ede9fe/);
    expect(out).toMatch(/class S_ctx_1 clusterPalette0/);
  });

  it('declares an explicit color on every emitted classDef so cluster titles never inherit the base-theme grey', () => {
    const out = buildArchitectureBlueprint(makePlan());
    const classDefs = out.split('\n').filter((l) => l.startsWith('classDef '));
    expect(classDefs.length).toBeGreaterThan(0);
    for (const def of classDefs) {
      expect(def).toMatch(/,color:#?[0-9a-fA-F]+/);
    }
  });

  it('escapes characters that are unsafe in Mermaid quoted labels', () => {
    const plan = makePlan();
    plan.boundedContexts[0].name = 'Orders "core"';
    plan.boundedContexts[0].description = 'A | B / C & D';
    const out = buildArchitectureBlueprint(plan);
    expect(out).toContain('Orders \\"core\\"');



    expect(out.startsWith('graph TD')).toBe(true);
  });

  it('truncates overly long context descriptions', () => {
    const plan = makePlan();
    plan.boundedContexts[0].description =
      'A very long description that should be truncated to a much shorter form for display purposes because context nodes must stay compact so the diagram remains readable at a glance';
    const out = buildArchitectureBlueprint(plan, { contextDescriptionLimit: 40 });
    expect(out).toContain('…');
  });

  it('respects the maxNodes cap to protect against pathological plans', () => {
    const plan = makePlan();

    for (let i = 0; i < 50; i++) {
      plan.boundedContexts.push({
        id: `extra-${i}`,
        name: `Extra ${i}`,
        description: 'd',
        layer: 'backend',
        ubiquitousLanguage: { x: 'y' },
      });
    }
    const out = buildArchitectureBlueprint(plan, { maxNodes: 20 });

    const nodeLines = out.split('\n').filter((l) => /^n\d+\[/.test(l)).length;
    expect(nodeLines).toBeLessThanOrEqual(20);
  });
});

describe('summariseArchitectureLayers', () => {
  it('returns rows of {name, tech, patterns} skipping empty layers', () => {
    const summary = summariseArchitectureLayers(makePlan().architectureLayers);
    expect(summary.length).toBeGreaterThan(0);
    for (const row of summary) {
      expect(typeof row.name).toBe('string');
      expect(Array.isArray(row.tech)).toBe(true);
      expect(Array.isArray(row.patterns)).toBe(true);
    }
  });
});

describe('buildTechStackDiagram', () => {
  it('returns a 1-element placeholder array when no layers declare a techStack', () => {
    const plan = makePlan();
    plan.architectureLayers = plan.architectureLayers.map((l) => ({ ...l, techStack: [] }));
    const out = buildTechStackDiagram(plan);
    expect(Array.isArray(out)).toBe(true);
    expect(out.length).toBe(1);
    expect(out[0].startsWith('graph TD')).toBe(true);
    expect(out[0]).toContain('No tech stack declared yet');
  });

  it('emits one independent diagram per layer that has techStack', () => {
    const out = buildTechStackDiagram(makePlan());
    expect(out.length).toBe(4);
    expect(out.some((g) => g.includes('subgraph S_tech_1["Frontend"]'))).toBe(true);
    expect(out.some((g) => g.includes('subgraph S_tech_2["Backend"]'))).toBe(true);
    expect(out.some((g) => g.includes('subgraph S_tech_3["Shared"]'))).toBe(true);
    expect(out.some((g) => g.includes('subgraph S_tech_4["Infrastructure"]'))).toBe(true);
  });

  it('renders each per-layer diagram with direction TD for top alignment', () => {
    const out = buildTechStackDiagram(makePlan());
    expect(out.length).toBeGreaterThan(0);
    for (const graph of out) {
      expect(graph.startsWith('graph TD')).toBe(true);
      expect(graph).toContain('direction TD');
    }
  });

  it('keeps each per-layer diagram self-contained (no cross-layer edges)', () => {
    const out = buildTechStackDiagram(makePlan());
    for (const graph of out) {



      const subgraphMatches = graph.match(/subgraph\s+S_tech_\d+/g) ?? [];
      expect(subgraphMatches.length).toBe(1);
    }
  });

  it('renders each techStack item as a cylinder-shaped node', () => {
    const out = buildTechStackDiagram(makePlan());

    expect(out.some((g) => g.includes('[("Angular 21")]'))).toBe(true);
    expect(out.some((g) => g.includes('[("PrimeNG")]'))).toBe(true);
    expect(out.some((g) => g.includes('[("PostgreSQL 15")]'))).toBe(true);
    expect(out.some((g) => g.includes('[("Docker")]'))).toBe(true);
  });

  it('includes each layer’s patterns in a stadium-shaped node', () => {
    const out = buildTechStackDiagram(makePlan());

    expect(
      out.some((g) => /\(\["Patterns\nSignals\nStandalone Components"\]?\)/.test(g)),
    ).toBe(true);
    expect(out.some((g) => g.includes('Clean Architecture'))).toBe(true);
  });

  it('applies per-layer classDef colours for tech items', () => {
    const out = buildTechStackDiagram(makePlan());
    const all = out.join('\n');

    expect(all).toContain('classDef techItemPalette0');
    expect(all).toContain('classDef techItemPalette1');
    expect(all).toContain('classDef techItemPalette2');
    expect(all).toContain('classDef techItemPalette3');
  });

  it('declares an explicit color on every emitted classDef in the per-layer tech-stack diagrams', () => {
    const out = buildTechStackDiagram(makePlan());
    for (const graph of out) {
      const classDefs = graph.split('\n').filter((l) => l.startsWith('classDef '));
      for (const def of classDefs) {
        expect(def).toMatch(/,color:#?[0-9a-fA-F]+/);
      }
    }
  });
});
