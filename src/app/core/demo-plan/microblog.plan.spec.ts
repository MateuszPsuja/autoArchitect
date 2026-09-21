import { describe, expect, it } from 'vitest';
import { PlanSchema } from '../plan.schema';
import { isDemoPlan, MICROBLOG_DEMO_PLAN, MICROBLOG_DEMO_TOKEN_STATS } from './microblog.plan';

describe('MICROBLOG_DEMO_PLAN', () => {
  it('parses against the Plan schema', () => {
    expect(() => PlanSchema.parse(MICROBLOG_DEMO_PLAN)).not.toThrow();
  });

  it('has a Microblog Platform (Demo) identity', () => {
    expect(MICROBLOG_DEMO_PLAN.meta.title).toBe('Microblog Platform (Demo)');
    expect(MICROBLOG_DEMO_PLAN.meta.generatedAt).toBe('2026-09-15T00:00:00.000Z');
    expect(MICROBLOG_DEMO_PLAN.meta.model).toBe('demo-seed');
    expect(MICROBLOG_DEMO_PLAN.meta.featureSlug).toBe('microblog-demo');
  });

  it('contains bounded contexts across backend and shared', () => {
    const layers = new Set(MICROBLOG_DEMO_PLAN.boundedContexts.map((bc) => bc.layer));
    expect(layers.has('backend')).toBe(true);
    expect(layers.has('shared')).toBe(true);
  });

  it('contains the five architecture layers', () => {
    const ids = MICROBLOG_DEMO_PLAN.architectureLayers.map((l) => l.id);
    expect(ids).toContain('backend');
    expect(ids).toContain('backend-workers');
    expect(ids).toContain('frontend');
    expect(ids).toContain('shared');
    expect(ids).toContain('infra');
  });

  it('contains at least one component per backend layer enum', () => {
    const layers = new Set(
      MICROBLOG_DEMO_PLAN.domains.flatMap((d) => d.components).map((c) => c.layer),
    );
    expect(layers.has('domain')).toBe(true);
    expect(layers.has('application')).toBe(true);
    expect(layers.has('infrastructure')).toBe(true);
  });

  it('populates a directory path on every domain', () => {
    expect(MICROBLOG_DEMO_PLAN.domains.length).toBeGreaterThan(0);
    expect(
      MICROBLOG_DEMO_PLAN.domains.every((d) =>
        d.directoryPath.startsWith('backend/') ||
          d.directoryPath.startsWith('workers/') ||
          d.directoryPath.startsWith('frontend/'),
      ),
    ).toBe(true);
  });

  it('emits at least one backend sequenceDiagram for fan-out', () => {
    const backend = MICROBLOG_DEMO_PLAN.architectureLayers.find((l) => l.id === 'backend');
    expect(backend).toBeDefined();
    const combined = [
      backend!.dataFlowDiagram,
      backend!.apiContractDiagram ?? '',
      backend!.mermaidDiagram,
      backend!.componentTreeDiagram ?? '',
      backend!.moduleDependenciesDiagram ?? '',
    ].join('\n');
    expect(combined.includes('sequenceDiagram')).toBe(true);
    expect(combined).toMatch(/Fan[Oo]ut|fan[ -]?out|fanout|fans?[ -]?out/i);
  });

  it('sequenceDiagram arrows do not contain Mermaid-unsafe characters', () => {
    const arrowLineRegex = /^[A-Za-z][A-Za-z0-9 ]+(->>|-->>):(.*)$/;
    const UNSAFE = /[;{}<>?]/;
    const QUOTES = /["']/;

    const offenders: string[] = [];
    for (const layer of MICROBLOG_DEMO_PLAN.architectureLayers) {
      for (const [field, value] of [
        ['mermaidDiagram', layer.mermaidDiagram],
        ['componentTreeDiagram', layer.componentTreeDiagram],
        ['dataFlowDiagram', layer.dataFlowDiagram],
        ['moduleDependenciesDiagram', layer.moduleDependenciesDiagram],
        ['stateManagementDiagram', layer.stateManagementDiagram],
        ['apiContractDiagram', layer.apiContractDiagram],
      ] as const) {
        if (!value || !value.includes('sequenceDiagram')) continue;
        for (const line of value.split('\n')) {
          const trimmed = line.trim();
          if (!arrowLineRegex.test(trimmed)) continue;
          const message = arrowLineRegex.exec(trimmed)![2];
          if (UNSAFE.test(message) || QUOTES.test(message)) {
            offenders.push(`${layer.id}.${field}: "${trimmed}"`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('isDemoPlan matches by title and generatedAt', () => {
    expect(isDemoPlan(MICROBLOG_DEMO_PLAN)).toBe(true);
    expect(isDemoPlan(null)).toBe(false);
    expect(isDemoPlan(undefined)).toBe(false);
    expect(
      isDemoPlan({
        ...MICROBLOG_DEMO_PLAN,
        meta: { ...MICROBLOG_DEMO_PLAN.meta, title: 'Custom Plan' },
      }),
    ).toBe(false);
  });

  it('every userStory.boundedContextIds resolves to a real boundedContext', () => {
    const validIds = new Set(MICROBLOG_DEMO_PLAN.boundedContexts.map((bc) => bc.id));
    const referenced = MICROBLOG_DEMO_PLAN.userStories.flatMap((s) => s.boundedContextIds);
    expect(referenced.length).toBeGreaterThan(0);
    for (const id of referenced) {
      expect(validIds.has(id), `userStory references unknown boundedContext id: ${id}`).toBe(true);
    }
  });

  it('every architectureLayer has a populated technicalContext with all five fields', () => {
    const layers = MICROBLOG_DEMO_PLAN.architectureLayers;
    expect(layers.length).toBeGreaterThan(0);
    for (const layer of layers) {
      expect(layer.technicalContext, `${layer.id} missing technicalContext`).toBeDefined();
      const tc = layer.technicalContext!;
      expect(tc.storage.length).toBeGreaterThan(0);
      expect(tc.targetPlatform.length).toBeGreaterThan(0);
      expect(tc.performanceGoals.length).toBeGreaterThan(0);
      expect(tc.constraints.length).toBeGreaterThan(0);
      expect(tc.scaleScope.length).toBeGreaterThan(0);
    }
  });

  it('constitution has exactly nine articles numbered 1..9 in order', () => {
    const articles = MICROBLOG_DEMO_PLAN.constitution?.articles ?? [];
    expect(articles).toHaveLength(9);
    articles.forEach((article, index) => {
      expect(article.articleNumber).toBe(index + 1);
    });
  });
});

describe('MICROBLOG_DEMO_TOKEN_STATS', () => {
  it('has a non-empty model and timestamps', () => {
    expect(typeof MICROBLOG_DEMO_TOKEN_STATS.model).toBe('string');
    expect(MICROBLOG_DEMO_TOKEN_STATS.model.length).toBeGreaterThan(0);
    expect(typeof MICROBLOG_DEMO_TOKEN_STATS.generatedAt).toBe('string');
    expect(typeof MICROBLOG_DEMO_TOKEN_STATS.startedAt).toBe('string');
  });

  it('has non-negative integer token counts that sum correctly', () => {
    const { promptTokens, completionTokens, totalTokens } = MICROBLOG_DEMO_TOKEN_STATS;
    expect(Number.isInteger(promptTokens) && promptTokens >= 0).toBe(true);
    expect(Number.isInteger(completionTokens) && completionTokens >= 0).toBe(true);
    expect(totalTokens).toBe(promptTokens + completionTokens);
  });

  it('has a startedAt timestamp earlier than generatedAt', () => {
    const start = Date.parse(MICROBLOG_DEMO_TOKEN_STATS.startedAt!);
    const end = Date.parse(MICROBLOG_DEMO_TOKEN_STATS.generatedAt);
    expect(Number.isFinite(start)).toBe(true);
    expect(Number.isFinite(end)).toBe(true);
    expect(end).toBeGreaterThan(start);
  });

  it('shares generatedAt with the demo plan meta for consistency', () => {
    expect(MICROBLOG_DEMO_TOKEN_STATS.generatedAt).toBe(MICROBLOG_DEMO_PLAN.meta.generatedAt);
  });
});
