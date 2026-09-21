import { describe, expect, it } from 'vitest';
import {
  computeUserEditSummary,
  type AddedElement,
  type ElementRef,
  type UserEditSummary,
} from './user-edit-summary';
import { Plan } from '../plan.schema';
import { MICROBLOG_DEMO_PLAN } from '../demo-plan/microblog.plan';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function asPlan(value: unknown): Plan {
  return value as Plan;
}

describe('computeUserEditSummary', () => {
  it('returns null when current and baseline match and there are no overrides', () => {
    const baseline = clone(MICROBLOG_DEMO_PLAN);
    const current = clone(MICROBLOG_DEMO_PLAN);
    expect(computeUserEditSummary(current, baseline, {})).toBeNull();
  });

  it('captures markdown-only changes (overrides only)', () => {
    const baseline = clone(MICROBLOG_DEMO_PLAN);
    const current = clone(MICROBLOG_DEMO_PLAN);
    const summary = computeUserEditSummary(current, baseline, {
      'docs/architecture/frontend-architecture.md': '# edited',
    });
    expect(summary).not.toBeNull();
    expect(summary!.preservedFilePaths).toEqual(['docs/architecture/frontend-architecture.md']);
    expect(summary!.addedElements).toEqual([]);
    expect(summary!.removedElements).toEqual([]);
    expect(summary!.fieldChanges).toEqual([]);
    expect(summary!.naturalLanguageDigest).toContain('Markdown files');
    expect(summary!.naturalLanguageDigest).toContain('docs/architecture/frontend-architecture.md');
  });

  it('captures field-only modifications', () => {
    const baseline = clone(MICROBLOG_DEMO_PLAN);
    const current = clone(MICROBLOG_DEMO_PLAN);
    current.meta.summary = 'A new summary written by the user.';
    const summary = computeUserEditSummary(current, baseline, {});
    expect(summary).not.toBeNull();
    expect(summary!.fieldChanges.length).toBeGreaterThan(0);
    const metaChange = summary!.fieldChanges.find((c) => c.path === 'meta.summary');
    expect(metaChange).toBeDefined();
    expect(metaChange!.to).toBe('A new summary written by the user.');
  });

  it('captures added elements with the full element payload', () => {
    const baseline = clone(MICROBLOG_DEMO_PLAN);
    const current = clone(MICROBLOG_DEMO_PLAN);
    const newDomain = {
      id: 'payments',
      name: 'Payments',
      description: 'New domain added by user',
      layer: 'backend',
      responsibilities: ['Process payments'],
      aggregates: [],
      domainEvents: [],
      directoryPath: 'backend/payments/',
      components: [],
    };
    current.domains = [...current.domains, newDomain as unknown as Plan['domains'][number]];
    const summary = computeUserEditSummary(current, baseline, {});
    expect(summary).not.toBeNull();
    expect(summary!.addedElements).toHaveLength(1);
    expect(summary!.addedElements[0].kind).toBe('domain');
    expect(summary!.addedElements[0].id).toBe('payments');
    expect(summary!.addedElements[0].element).toBeDefined();
    expect((summary!.addedElements[0] as AddedElement).element).toBeDefined();
  });

  it('captures removed elements', () => {
    const baseline = clone(MICROBLOG_DEMO_PLAN);
    const current = clone(MICROBLOG_DEMO_PLAN);
    const removed = current.domains[0];
    current.domains = current.domains.slice(1);
    const summary = computeUserEditSummary(current, baseline, {});
    expect(summary).not.toBeNull();
    expect(summary!.removedElements).toHaveLength(1);
    const ref: ElementRef = summary!.removedElements[0];
    expect(ref.kind).toBe('domain');
    expect(ref.id).toBe(removed.id);
  });

  it('combines all three categories in one summary', () => {
    const baseline = clone(MICROBLOG_DEMO_PLAN);
    const current = clone(MICROBLOG_DEMO_PLAN);
    current.meta.summary = 'Edited summary';
    current.domains = current.domains.slice(1);
    const newDomain = {
      id: 'audit-log',
      name: 'Audit Log',
      description: 'New domain',
      layer: 'backend',
      responsibilities: ['Append-only audit trail'],
      aggregates: [],
      domainEvents: [],
      directoryPath: 'backend/audit_log/',
      components: [],
    };
    current.domains = [...current.domains, newDomain as unknown as Plan['domains'][number]];
    const summary = computeUserEditSummary(current, baseline, {
      'docs/foo.md': 'edited',
    });
    expect(summary).not.toBeNull();
    expect(summary!.preservedFilePaths).toContain('docs/foo.md');
    expect(summary!.addedElements).toHaveLength(1);
    expect(summary!.removedElements).toHaveLength(1);
    expect(summary!.fieldChanges.length).toBeGreaterThan(0);
  });

  it('treats a renamed id as a remove + add', () => {
    const baseline = clone(MICROBLOG_DEMO_PLAN);
    const current = clone(MICROBLOG_DEMO_PLAN);
    const originalId = current.domains[0].id;
    const renamed = { ...current.domains[0], id: 'renamed-id' };
    current.domains = [renamed, ...current.domains.slice(1)] as Plan['domains'];
    const summary = computeUserEditSummary(current, baseline, {});
    expect(summary).not.toBeNull();
    expect(summary!.removedElements.find((e) => e.id === originalId)).toBeDefined();
    expect(summary!.addedElements.find((a) => a.id === 'renamed-id')).toBeDefined();
  });

  it('truncates long descriptions in the digest', () => {
    const baseline = clone(MICROBLOG_DEMO_PLAN);
    const current = clone(MICROBLOG_DEMO_PLAN);
    const newDomain = {
      id: 'payments',
      name: 'Payments',
      description: 'X'.repeat(500),
      layer: 'backend',
      responsibilities: ['Process payments'],
      aggregates: [],
      domainEvents: [],
      directoryPath: 'backend/payments/',
      components: [],
    };
    current.domains = [...current.domains, newDomain as unknown as Plan['domains'][number]];
    const summary = computeUserEditSummary(current, baseline, {}) as UserEditSummary | null;
    expect(summary).not.toBeNull();
    expect(summary!.naturalLanguageDigest).toContain('…');
    expect(summary!.naturalLanguageDigest.length).toBeLessThan(500);
  });

  it('handles nested array field changes', () => {
    const baseline = clone(MICROBLOG_DEMO_PLAN);
    const current = clone(MICROBLOG_DEMO_PLAN);
    if (current.domains.length === 0) throw new Error('demo plan has no domains');
    const firstDomain = current.domains[0];
    firstDomain.responsibilities = ['Updated responsibility one', 'New responsibility two'];
    const summary = computeUserEditSummary(current, baseline, {});
    expect(summary).not.toBeNull();
    expect(summary!.fieldChanges.some((c) => c.path.startsWith('domains[0].responsibilities'))).toBe(true);
  });

  it('returns a digest with the most-restrictive sections first', () => {
    const baseline = clone(MICROBLOG_DEMO_PLAN);
    const current = clone(MICROBLOG_DEMO_PLAN);
    current.meta.summary = 'Edited';
    const summary = computeUserEditSummary(current, baseline, { 'docs/foo.md': 'x' });
    expect(summary).not.toBeNull();
    const digest = summary!.naturalLanguageDigest;
    const mdIdx = digest.indexOf('Markdown files');
    const removedIdx = digest.indexOf('Removed elements');
    const addedIdx = digest.indexOf('Added elements');
    const modifiedIdx = digest.indexOf('Modified fields');
    expect(mdIdx).toBeGreaterThan(-1);
    if (summary!.removedElements.length > 0) expect(removedIdx).toBeGreaterThan(mdIdx);
    if (summary!.addedElements.length > 0) expect(addedIdx).toBeGreaterThanOrEqual(removedIdx === -1 ? mdIdx : removedIdx);
    expect(modifiedIdx).toBeGreaterThan(mdIdx);
  });

  it('returns AddedElement.element carrying the full Plan-shaped element', () => {
    const baseline = clone(MICROBLOG_DEMO_PLAN);
    const current = clone(MICROBLOG_DEMO_PLAN);
    const layer = {
      id: 'observability',
      name: 'Observability',
      description: 'New layer',
      techStack: ['OpenTelemetry'],
      patterns: ['Distributed tracing'],
      mermaidDiagram: 'graph TD\n  A[Observability]',
      directoryStructure: [
        { path: 'observability/', description: 'x', agentInstructions: ['a', 'b', 'c'] },
      ],
    };
    current.architectureLayers = [
      ...current.architectureLayers,
      layer as unknown as Plan['architectureLayers'][number],
    ];
    const summary = computeUserEditSummary(asPlan(current), asPlan(baseline), {}) as UserEditSummary;
    expect(summary.addedElements).toHaveLength(1);
    const added = summary.addedElements[0];
    expect(added.kind).toBe('architectureLayer');
    expect(added.id).toBe('observability');
    expect((added as AddedElement).element).toBeDefined();
  });

  it('appends the TECH STACK LOCKED block when architectureLayers[].techStack is changed', () => {
    const baseline = clone(MICROBLOG_DEMO_PLAN);
    const current = clone(MICROBLOG_DEMO_PLAN);
    const layerIndex = current.architectureLayers.findIndex((l) => l.id === 'backend');
    if (layerIndex < 0) throw new Error('demo plan has no backend layer');
    current.architectureLayers[layerIndex].techStack = ['NestJS 11', 'PostgreSQL 16'];
    const summary = computeUserEditSummary(current, baseline, {});
    expect(summary).not.toBeNull();
    expect(summary!.naturalLanguageDigest).toContain('TECH STACK LOCKED');
    expect(summary!.naturalLanguageDigest).toContain('architectureLayers[].techStack');
    expect(summary!.naturalLanguageDigest).toContain('HARD requirements');
  });

  it('does not append the TECH STACK LOCKED block when no techStack change is present', () => {
    const baseline = clone(MICROBLOG_DEMO_PLAN);
    const current = clone(MICROBLOG_DEMO_PLAN);
    current.meta.summary = 'edited summary, no tech changes';
    const summary = computeUserEditSummary(current, baseline, {});
    expect(summary).not.toBeNull();
    expect(summary!.naturalLanguageDigest).not.toContain('TECH STACK LOCKED');
  });
});
