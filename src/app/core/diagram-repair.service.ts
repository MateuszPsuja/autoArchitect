import { Injectable, inject } from '@angular/core';
import { Plan } from './plan.schema';
import {
  DiagramAuditEntry,
  DiagramAuditReport,
  DiagramAuditService,
  DiagramLocation,
} from './diagram-audit.service';

export interface DiagramRepairResult {

  plan: Plan;

  repaired: DiagramAuditEntry[];

  residual: DiagramAuditEntry[];
}

type LlmInvoker = (promptText: string) => Promise<{ text: string }>;

const REPAIR_INSTRUCTION = `You are a Mermaid diagram syntax repair agent. The diagram below was rejected by Mermaid's parser. Return ONLY a corrected Mermaid diagram that will parse successfully.

Rules:
- Keep the same intent (nodes + relationships) where possible.
- Use a supported type on line 1: \`flowchart\`, \`graph\`, \`sequenceDiagram\`, \`classDiagram\`, \`stateDiagram-v2\`, or \`erDiagram\`.
- Every \`subgraph\` block MUST be terminated with exactly one matching \`end\` keyword. The most common failure the planner sees is a \`subgraph\` whose \`end\` was dropped — Mermaid then reports "Parse error on line N: Expecting SEMI, NEWLINE, ..., 'end'" at the next top-level token. Do not add a stray \`end\` after the diagram has already been fully closed either; the keyword counts must balance.
- In sequence diagrams, message text after ':' must not contain ';' (Mermaid's Note delimiter) — either rephrase the message or use the entity '&#59;'. Other punctuation ('{', '}', '[', ']', '<', '>', '?', '"', '\'') is fine raw inside a message and must NOT be entity-encoded (entity-encoding it produces broken output).
- Preserve the original diagram's substance — do not collapse it to a
  single "placeholder" node, even if the diagram is large. The user
  loses information if you replace real content with a placeholder;
  it's better to return a smaller but still representative diagram
  than an empty stub.
- Do NOT add commentary, do NOT wrap the answer in markdown fences.
- Return plain text containing only the Mermaid source.`;

@Injectable({ providedIn: 'root' })
export class DiagramRepairService {
  private readonly diagramAudit = inject(DiagramAuditService);

  async repairPlan(
    plan: Plan,
    audit: DiagramAuditReport,
    llmInvoker: LlmInvoker,
  ): Promise<DiagramRepairResult> {
    const failures = audit.entries.filter((entry) => entry.status === 'failed');
    if (failures.length === 0) {
      return { plan, repaired: [], residual: [] };
    }

    const repaired: DiagramAuditEntry[] = [];
    const residual: DiagramAuditEntry[] = [];
    let working = plan;

    for (const entry of failures) {
      try {
        const fixed = await this.repairOne(working, entry, llmInvoker);
        if (fixed.changed) {
          working = fixed.plan;
          repaired.push(entry);
        } else {
          residual.push(entry);
        }
      } catch {



        residual.push(entry);
      }
    }

    return { plan: working, repaired, residual };
  }

  private async repairOne(
    plan: Plan,
    entry: DiagramAuditEntry,
    llmInvoker: LlmInvoker,
  ): Promise<{ plan: Plan; changed: boolean }> {
    const currentValue = readDiagram(plan, entry.location);
    if (typeof currentValue !== 'string' || currentValue.trim().length === 0) {
      return { plan, changed: false };
    }

    const prompt = [
      REPAIR_INSTRUCTION,
      '',
      `Field: ${describeLocation(entry.location)}`,
      `Parser error: ${(entry.error ?? 'unknown').slice(0, 400)}`,
      '',
      'Current (broken) diagram:',
      '```mermaid',
      currentValue,
      '```',
    ].join('\n');

    const result = await llmInvoker(prompt);
    const cleaned = stripMermaidFences(result.text);
    if (!cleaned || cleaned === currentValue.trim()) {
      return { plan, changed: false };
    }



    const verified = await this.diagramAudit.auditPlan(writeDiagram(plan, entry.location, cleaned));
    const stillFailing = verified.entries.some(
      (e) => e.status === 'failed' && sameLocation(e.location, entry.location),
    );
    if (stillFailing) {
      return { plan, changed: false };
    }

    return { plan: writeDiagram(plan, entry.location, cleaned), changed: true };
  }
}

function describeLocation(location: DiagramLocation): string {
  if (location.scope === 'system') {
    return `systemOverview.${location.field}`;
  }
  if (location.scope === 'layer') {
    return `architectureLayers[${location.layerId}].${location.field}`;
  }



  return `synthesised:${location.id}`;
}

function sameLocation(a: DiagramLocation, b: DiagramLocation): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function stripMermaidFences(text: string): string {
  let trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    trimmed = trimmed.replace(/^```(?:mermaid)?\s*\n?/, '');
    trimmed = trimmed.replace(/\n?```\s*$/, '');
    trimmed = trimmed.trim();
  }
  return trimmed;
}

function readDiagram(plan: Plan, location: DiagramLocation): string | undefined {
  if (location.scope === 'system') {
    if (location.field === 'boundedContextMap') return plan.systemOverview.boundedContextMap;
    if (location.field === 'c4.contextDiagram') return plan.systemOverview.c4.contextDiagram;
    if (location.field === 'c4.containerDiagram') return plan.systemOverview.c4.containerDiagram;
    return undefined;
  }
  if (location.scope !== 'layer') return undefined;
  const layer = plan.architectureLayers.find((l) => l.id === location.layerId);
  if (!layer) return undefined;
  switch (location.field) {
    case 'mermaidDiagram':
      return layer.mermaidDiagram;
    case 'componentTreeDiagram':
      return layer.componentTreeDiagram;
    case 'dataFlowDiagram':
      return layer.dataFlowDiagram;
    case 'moduleDependenciesDiagram':
      return layer.moduleDependenciesDiagram;
    case 'stateManagementDiagram':
      return layer.stateManagementDiagram;
    case 'apiContractDiagram':
      return layer.apiContractDiagram;
    default:
      return undefined;
  }
}

function writeDiagram(plan: Plan, location: DiagramLocation, value: string): Plan {
  if (location.scope === 'synthesised') return plan;
  if (location.scope === 'system') {
    if (location.field === 'boundedContextMap') {
      return { ...plan, systemOverview: { ...plan.systemOverview, boundedContextMap: value } };
    }
    if (location.field === 'c4.contextDiagram') {
      return {
        ...plan,
        systemOverview: {
          ...plan.systemOverview,
          c4: { ...plan.systemOverview.c4, contextDiagram: value },
        },
      };
    }
    if (location.field === 'c4.containerDiagram') {
      return {
        ...plan,
        systemOverview: {
          ...plan.systemOverview,
          c4: { ...plan.systemOverview.c4, containerDiagram: value },
        },
      };
    }
    return plan;
  }
  return {
    ...plan,
    architectureLayers: plan.architectureLayers.map((layer) => {
      if (layer.id !== location.layerId) return layer;
      switch (location.field) {
        case 'mermaidDiagram':
          return { ...layer, mermaidDiagram: value };
        case 'componentTreeDiagram':
          return { ...layer, componentTreeDiagram: value };
        case 'dataFlowDiagram':
          return { ...layer, dataFlowDiagram: value };
        case 'moduleDependenciesDiagram':
          return { ...layer, moduleDependenciesDiagram: value };
        case 'stateManagementDiagram':
          return { ...layer, stateManagementDiagram: value };
        case 'apiContractDiagram':
          return { ...layer, apiContractDiagram: value };
        default:
          return layer;
      }
    }),
  };
}
