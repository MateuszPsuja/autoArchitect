import { Injectable } from '@angular/core';
import mermaid from 'mermaid';
import {
  buildArchitectureBlueprint,
  buildTechStackDiagram,
} from './architecture-blueprint';
import { DiagramAuditReport } from './diagram-audit.service';
import { Plan } from './plan.schema';
import { AuditFinding } from './audit-runner.service';
import { sanitizeMermaidLabels } from './mermaid-label-sanitizer';
import { normalizeMermaidChart } from '../features/diagrams/mermaid-utils';

export type SynthesisedDiagramLocation = Extract<
  import('./diagram-audit.service').DiagramLocation,
  { scope: 'synthesised' }
>;

export interface LocalFixResult {
  plan: Plan;

  fixedPaths: string[];
}

const ALLOWED_MERMAID_TYPES = [
  'flowchart',
  'graph',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram-v2',
  'erDiagram',
] as const;

const DEFAULT_FALLBACK_BY_FIELD: Record<string, string> = {
  mermaidDiagram: 'flowchart TD\n  placeholder["Replace with a real overview diagram"]',
  componentTreeDiagram: 'classDiagram\n  class Placeholder',
  dataFlowDiagram: 'sequenceDiagram\n  participant UI\n  UI->>API: request',
  moduleDependenciesDiagram: 'graph LR\n  placeholder-->placeholder',
  stateManagementDiagram: 'stateDiagram-v2\n  [*] --> idle\n  idle --> loading',
  apiContractDiagram: 'sequenceDiagram\n  participant Caller\n  Caller->>Service: request',
  boundedContextMap: 'graph LR\n  placeholder-->placeholder',
};

@Injectable({ providedIn: 'root' })
export class LocalAuditFixer {

  tryFixInPlace(plan: Plan, findings: readonly AuditFinding[]): LocalFixResult {
    if (findings.length === 0) {
      return { plan, fixedPaths: [] };
    }
    let working: Plan = plan;
    const fixedPaths: string[] = [];

    for (const finding of findings) {
      if (finding.severity !== 'error') continue;
      const patched = this.tryPatchDiagram(working, finding.path);
      if (patched.changed) {
        working = patched.plan;
        fixedPaths.push(finding.path);
      }
    }

    return { plan: working, fixedPaths };
  }

  async tryFixSynthesised(
    plan: Plan,
    audit: DiagramAuditReport,
  ): Promise<{
    patches: Array<{ location: SynthesisedDiagramLocation; source: string }>;
  }> {
    const failures = audit.entries.filter((e) => e.status === 'failed');
    const synthFailures = failures.filter(
      (e) => e.location.scope === 'synthesised',
    );
    if (synthFailures.length === 0) {
      return { patches: [] };
    }



    const blueprintSource = buildArchitectureBlueprint(plan);
    const techStackSources = buildTechStackDiagram(plan);
    const renderableLayers = plan.architectureLayers.filter(
      (l) => Array.isArray(l?.techStack) && (l.techStack ?? []).some(Boolean),
    );

    const patches: Array<{ location: SynthesisedDiagramLocation; source: string }> = [];

    for (const entry of synthFailures) {
      const loc = entry.location;
      if (loc.scope !== 'synthesised') continue;
      const original = this.synthSourceFor(loc, blueprintSource, techStackSources, renderableLayers);
      if (typeof original !== 'string' || original.trim().length === 0) continue;
      let normalized: string;
      try {
        normalized = normalizeMermaidChart(original);
      } catch {
        continue;
      }
      if (normalized === original) continue;





      if (!(await safeParse(normalized))) continue;
      patches.push({ location: loc, source: normalized });
    }

    return { patches };
  }

  private synthSourceFor(
    location: SynthesisedDiagramLocation,
    blueprintSource: string,
    techStackSources: string[],
    renderableLayers: Plan['architectureLayers'],
  ): string | undefined {
    if (location.scope !== 'synthesised') return undefined;
    if (location.source === 'blueprint') return blueprintSource;
    if (location.source !== 'techStack') return undefined;
    const layerId = location.id.startsWith('techStack:')
      ? location.id.slice('techStack:'.length)
      : undefined;
    if (!layerId) return undefined;
    const idx = renderableLayers.findIndex((l) => l.id === layerId);
    if (idx === -1) return undefined;
    return techStackSources[idx];
  }

  private tryPatchDiagram(plan: Plan, path: string): { plan: Plan; changed: boolean } {
    const resolved = resolvePlanPath(plan, path);
    if (!resolved) return { plan, changed: false };
    const { owner, key, value } = resolved;
    if (typeof value !== 'string' || value.length === 0) {
      return { plan, changed: false };
    }
    const sanitised = sanitizeMermaidLabels(value);
    if (sanitised !== value) {
      return { plan: writeBack(plan, owner, key, sanitised), changed: true };
    }
    const firstLine = value.split('\n', 1)[0]?.trim() ?? '';
    if (firstLine.startsWith('%%{init:')) {



      const stripped = value.replace(/^%%\{init:[^]*?\}%%\s*\n?/, '');
      const replacement =
        (stripped.trim().split('\n', 1)[0] ?? '') ||
        DEFAULT_FALLBACK_BY_FIELD[key] ||
        'flowchart TD';
      const nextValue =
        replacement +
        (stripped.includes('\n') ? '\n' + stripped.split('\n').slice(1).join('\n') : '');
      return { plan: writeBack(plan, owner, key, nextValue), changed: true };
    }
    const type = firstLine.split(/\s+/)[0]?.toLowerCase() ?? '';
    if (!type) {
      const fallback = DEFAULT_FALLBACK_BY_FIELD[key] ?? 'flowchart TD';
      return { plan: writeBack(plan, owner, key, fallback), changed: true };
    }
    if (UNSAFE_CHAR_DIAGRAM_TYPES.has(type)) {





      let normalized: string;
      try {
        normalized = normalizeMermaidChart(value);
      } catch {
        return { plan, changed: false };
      }
      if (normalized !== value) {
        return { plan: writeBack(plan, owner, key, normalized), changed: true };
      }
    }
    if (!ALLOWED_MERMAID_TYPES.includes(type as (typeof ALLOWED_MERMAID_TYPES)[number])) {



      const lines = value.split('\n');
      const safeLine = (DEFAULT_FALLBACK_BY_FIELD[key] ?? 'flowchart TD').split('\n', 1)[0];
      lines[0] = safeLine;
      return { plan: writeBack(plan, owner, key, lines.join('\n')), changed: true };
    }
    return { plan, changed: false };
  }
}

const UNSAFE_CHAR_DIAGRAM_TYPES = new Set(['sequencediagram']);

async function safeParse(chart: string): Promise<boolean> {
  try {
    const m = mermaid as unknown as { parse?: (s: string) => Promise<unknown> };
    const parseFn =
      m.parse ??
      (mermaid as unknown as { mermaidAPI?: { parse?: (s: string) => Promise<unknown> } })
        .mermaidAPI?.parse;
    if (typeof parseFn === 'function') {
      await parseFn(chart);
    } else {
      await mermaid.render(`audit-${Math.random().toString(36).slice(2)}`, chart);
    }
    return true;
  } catch {
    return false;
  }
}

interface PathResolution {

  owner: Record<string, unknown>;
  key: string;
  value: unknown;
}

function resolvePlanPath(plan: Plan, path: string): PathResolution | null {





  if (path === 'systemOverview.boundedContextMap') {
    return {
      owner: plan.systemOverview as unknown as Record<string, unknown>,
      key: 'boundedContextMap',
      value: plan.systemOverview.boundedContextMap,
    };
  }
  if (path === 'systemOverview.c4.contextDiagram') {
    return {
      owner: plan.systemOverview.c4 as unknown as Record<string, unknown>,
      key: 'contextDiagram',
      value: plan.systemOverview.c4.contextDiagram,
    };
  }
  if (path === 'systemOverview.c4.containerDiagram') {
    return {
      owner: plan.systemOverview.c4 as unknown as Record<string, unknown>,
      key: 'containerDiagram',
      value: plan.systemOverview.c4.containerDiagram,
    };
  }
  const layerMatch = /^architectureLayers\[([^\]]+)\]\.(.+)$/.exec(path);
  if (layerMatch) {
    const layerId = layerMatch[1];
    const field = layerMatch[2];
    const layer = plan.architectureLayers.find((l) => l.id === layerId);
    if (!layer) return null;
    return {
      owner: layer as unknown as Record<string, unknown>,
      key: field,
      value: (layer as unknown as Record<string, unknown>)[field],
    };
  }
  return null;
}

function writeBack(plan: Plan, owner: Record<string, unknown>, key: string, value: unknown): Plan {
  const next = { ...owner, [key]: value };



  if (owner === (plan.systemOverview as unknown as Record<string, unknown>)) {
    return { ...plan, systemOverview: next as Plan['systemOverview'] };
  }
  if (owner === (plan.systemOverview.c4 as unknown as Record<string, unknown>)) {
    return {
      ...plan,
      systemOverview: { ...plan.systemOverview, c4: next as Plan['systemOverview']['c4'] },
    };
  }

  const layerId = (owner as { id?: string }).id;
  if (!layerId) return plan;
  const layers = Array.isArray(plan.architectureLayers) ? plan.architectureLayers : [];
  return {
    ...plan,
    architectureLayers: layers.map((l) =>
      l.id === layerId ? ({ ...l, ...next } as Plan['architectureLayers'][number]) : l,
    ),
  };
}
