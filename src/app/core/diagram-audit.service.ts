import { Injectable } from '@angular/core';
import mermaid from 'mermaid';
import {
  buildArchitectureBlueprint,
  buildTechStackDiagram,
} from './architecture-blueprint';
import { normalizeMermaidChart } from '../features/diagrams/mermaid-utils';
import { Plan } from './plan.schema';

export type DiagramFieldName =
  | 'c4.contextDiagram'
  | 'c4.containerDiagram'
  | 'boundedContextMap'
  | 'mermaidDiagram'
  | 'componentTreeDiagram'
  | 'dataFlowDiagram'
  | 'moduleDependenciesDiagram'
  | 'stateManagementDiagram'
  | 'apiContractDiagram';

export type DiagramLocation =
  | {
      scope: 'system';
      field: Extract<
        DiagramFieldName,
        'c4.contextDiagram' | 'c4.containerDiagram' | 'boundedContextMap'
      >;
    }
  | {
      scope: 'layer';
      layerId: string;
      field: Exclude<
        DiagramFieldName,
        'c4.contextDiagram' | 'c4.containerDiagram' | 'boundedContextMap'
      >;
    }
  | {

      scope: 'synthesised';
      id: 'blueprint' | `techStack:${string}`;
      source: 'blueprint' | 'techStack';
    };

export type DiagramAuditStatus = 'passed' | 'failed' | 'skipped';

export interface DiagramAuditEntry {
  location: DiagramLocation;
  status: DiagramAuditStatus;
  error?: string;
  sourceLength?: number;

  diagnostic?: string;
}

export interface DiagramAuditReport {
  generatedAt: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  entries: DiagramAuditEntry[];

  repaired: number;
}

const REQUIRED_SYSTEM_FIELDS: ReadonlyArray<{
  field: 'c4.contextDiagram' | 'c4.containerDiagram';
}> = [{ field: 'c4.contextDiagram' }, { field: 'c4.containerDiagram' }];

const OPTIONAL_SYSTEM_FIELDS: ReadonlyArray<{
  field: 'boundedContextMap';
}> = [{ field: 'boundedContextMap' }];

const REQUIRED_LAYER_FIELDS: ReadonlyArray<{ field: 'mermaidDiagram' }> = [
  { field: 'mermaidDiagram' },
];

const OPTIONAL_LAYER_FIELDS: ReadonlyArray<{
  field:
    | 'componentTreeDiagram'
    | 'dataFlowDiagram'
    | 'moduleDependenciesDiagram'
    | 'stateManagementDiagram'
    | 'apiContractDiagram';
}> = [
  { field: 'componentTreeDiagram' },
  { field: 'dataFlowDiagram' },
  { field: 'moduleDependenciesDiagram' },
  { field: 'stateManagementDiagram' },
  { field: 'apiContractDiagram' },
];

const EMPTY_MESSAGE = 'empty or whitespace-only';

function locationKey(location: DiagramLocation): string {
  if (location.scope === 'system') return `system:${location.field}`;
  if (location.scope === 'layer') return `layer:${location.layerId}:${location.field}`;
  return `synthesised:${location.id}`;
}

@Injectable({ providedIn: 'root' })
export class DiagramAuditService {
  async auditPlan(plan: Plan | null): Promise<DiagramAuditReport> {
    const generatedAt = new Date().toISOString();
    if (!plan) {
      return {
        generatedAt,
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        entries: [],
        repaired: 0,
      };
    }

    const entries: DiagramAuditEntry[] = [];
    const sys = plan.systemOverview;
    for (const { field } of REQUIRED_SYSTEM_FIELDS) {
      if (field === 'c4.contextDiagram') {
        entries.push(await this.auditString(sys.c4.contextDiagram, { scope: 'system', field }));
      } else {
        entries.push(await this.auditString(sys.c4.containerDiagram, { scope: 'system', field }));
      }
    }
    for (const { field } of OPTIONAL_SYSTEM_FIELDS) {
      entries.push(await this.auditOptional(sys.boundedContextMap, { scope: 'system', field }));
    }

    for (const layer of plan.architectureLayers) {
      for (const { field } of REQUIRED_LAYER_FIELDS) {
        entries.push(
          await this.auditString(layer[field], { scope: 'layer', layerId: layer.id, field }),
        );
      }
      for (const { field } of OPTIONAL_LAYER_FIELDS) {
        entries.push(
          await this.auditOptional(layer[field], { scope: 'layer', layerId: layer.id, field }),
        );
      }
    }

    let passed = 0;
    let failed = 0;
    let skipped = 0;
    for (const entry of entries) {
      if (entry.status === 'passed') passed += 1;
      else if (entry.status === 'failed') failed += 1;
      else skipped += 1;
    }

    return {
      generatedAt,
      total: entries.length,
      passed,
      failed,
      skipped,
      entries,
      repaired: 0,
    };
  }

  async auditPlanWithSynthesised(plan: Plan | null): Promise<DiagramAuditReport> {
    const baseReport = await this.auditPlan(plan);
    if (!plan) return baseReport;

    const entries = [...baseReport.entries];

    const blueprintSource = buildArchitectureBlueprint(plan);
    entries.push(
      await this.auditString(blueprintSource, {
        scope: 'synthesised',
        id: 'blueprint',
        source: 'blueprint',
      }),
    );



    const techStackSources = buildTechStackDiagram(plan);
    const renderableLayers = plan.architectureLayers.filter(
      (l) => Array.isArray(l?.techStack) && (l.techStack ?? []).some(Boolean),
    );
    for (let i = 0; i < renderableLayers.length; i += 1) {
      const layer = renderableLayers[i];
      const source = techStackSources[i];
      if (!layer || typeof source !== 'string') continue;
      entries.push(
        await this.auditString(source, {
          scope: 'synthesised',
          id: `techStack:${layer.id}`,
          source: 'techStack',
        }),
      );
    }

    let passed = 0;
    let failed = 0;
    let skipped = 0;
    for (const entry of entries) {
      if (entry.status === 'passed') passed += 1;
      else if (entry.status === 'failed') failed += 1;
      else skipped += 1;
    }

    return {
      ...baseReport,
      total: entries.length,
      passed,
      failed,
      skipped,
      entries,
    };
  }

  private async auditString(value: string, location: DiagramLocation): Promise<DiagramAuditEntry> {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return {
        location,
        status: 'failed',
        error: EMPTY_MESSAGE,
        sourceLength: value.length,
      };
    }



    const unsafe = detectUnsafeSequenceMessage(value);
    const normalized = normalizeMermaidChart(value);
    const result = await this.parse(normalized, location, value.length);
    if (result.status === 'failed' && unsafe) {
      return { ...result, diagnostic: unsafe };
    }
    return result;
  }

  private async auditOptional(
    value: string | undefined,
    location: DiagramLocation,
  ): Promise<DiagramAuditEntry> {
    if (value === undefined) {
      return { location, status: 'skipped' };
    }
    return this.auditString(value, location);
  }

  private async parse(
    chart: string,
    location: DiagramLocation,
    sourceLength: number,
  ): Promise<DiagramAuditEntry> {
    try {
      const m = mermaid as unknown as { parse?: (s: string) => Promise<unknown> };
      const parseFn =
        m.parse ??
        (mermaid as unknown as { mermaidAPI?: { parse?: (s: string) => Promise<unknown> } })
          .mermaidAPI?.parse;
      if (typeof parseFn === 'function') {
        await parseFn(chart);
      } else {
        await mermaid.render(`audit-${locationKey(location)}`, chart);
      }
      return { location, status: 'passed', sourceLength };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        location,
        status: 'failed',
        error: message.slice(0, 500),
        sourceLength,
      };
    }
  }
}

function detectUnsafeSequenceMessage(chart: string): string | null {
  const lines = chart.split(/\r?\n/);
  const header = lines[0]?.trim() ?? '';
  if (!/^sequenceDiagram\b/i.test(header)) return null;
  const arrowRegex = /^(\s*\w+(?:->>|-->>|->|-->|-x|-)\s*\w+\s*:\s*)(.+)$/;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    const m = line.match(arrowRegex);
    if (!m) continue;
    const semiIdx = firstRawSemicolonOutsideEntities(m[2]);
    if (semiIdx !== -1) {
      const entity = '&#59;';
      return `line ${i + 1}: unsafe character ";" in message — escape as ${entity} or rephrase`;
    }
  }
  return null;
}

function firstRawSemicolonOutsideEntities(message: string): number {
  for (let i = 0; i < message.length; i += 1) {
    if (message[i] === '&' && message[i + 1] === '#') {
      const semi = message.indexOf(';', i + 2);
      if (semi !== -1 && /^\d+$/.test(message.slice(i + 2, semi))) {
        i = semi;
        continue;
      }
    }
    if (message[i] === ';') return i;
  }
  return -1;
}
