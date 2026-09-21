import { Injectable } from '@angular/core';
import { Plan } from './plan.schema';

export type AuditSeverity = 'error' | 'warning' | 'info';

export interface AuditFinding {
  severity: AuditSeverity;
  path: string;
  message: string;
  fix: string;
}

const ALLOWED_MERMAID_TYPES = new Set([
  'flowchart',
  'graph',
  'sequencediagram',
  'classdiagram',
  'statediagram-v2',
  'erdiagram',
]);

const DIAGRAM_TYPE_INTENT: Record<string, ReadonlyArray<string>> = {
  mermaidDiagram: ['flowchart', 'graph'],
  componentTreeDiagram: ['flowchart', 'graph', 'classdiagram'],
  dataFlowDiagram: ['flowchart', 'graph', 'sequencediagram'],
  moduleDependenciesDiagram: ['flowchart', 'graph'],
  stateManagementDiagram: ['statediagram-v2', 'flowchart', 'graph'],
  apiContractDiagram: ['sequencediagram', 'classdiagram'],
};

const DIAGRAM_FIELDS = Object.keys(DIAGRAM_TYPE_INTENT) as Array<keyof typeof DIAGRAM_TYPE_INTENT>;

function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

@Injectable({ providedIn: 'root' })
export class AuditRunner {

  run(plan: Plan): AuditFinding[] {
    return [
      ...this.runMermaidAudit(plan),
      ...this.runPlanAudit(plan),
      ...this.runStageAudit(plan),
      ...this.runCitationAudit(plan),
    ];
  }

  runMermaidAudit(plan: Plan): AuditFinding[] {
    const findings: AuditFinding[] = [];

    const systemFields = [
      { value: plan.systemOverview.boundedContextMap, path: 'systemOverview.boundedContextMap' },
      { value: plan.systemOverview.c4.contextDiagram, path: 'systemOverview.c4.contextDiagram' },
      { value: plan.systemOverview.c4.containerDiagram, path: 'systemOverview.c4.containerDiagram' },
    ];

    for (const entry of systemFields) {
      if (typeof entry.value === 'string' && entry.value.length > 0) {
        this.auditDiagramString(entry.value, entry.path, findings);
      }
    }

    for (const layer of safeArray<Plan['architectureLayers'][number]>(plan.architectureLayers)) {
      for (const field of DIAGRAM_FIELDS) {
        const value = (layer as unknown as Record<string, unknown>)[field];
        if (typeof value === 'string') {
          this.auditDiagramString(value, `architectureLayers[${layer.id}].${field}`, findings);
        }
      }
    }

    return findings;
  }

  runPlanAudit(plan: Plan): AuditFinding[] {
    const findings: AuditFinding[] = [];
    const domains = safeArray<Plan['domains'][number]>(plan.domains);

    for (const domain of domains) {
      const components = safeArray<Plan['domains'][number]['components'][number]>(domain.components);
      for (const component of components) {
        if (component.tddSpec.unitTests.length < 2) {
          findings.push({
            severity: 'error',
            path: `domains[${domain.id}].components[${component.id}].tddSpec.unitTests`,
            message: `Component has only ${component.tddSpec.unitTests.length} unitTests, minimum is 2.`,
            fix: `Add at least one more unitTest entry to satisfy tddSpec.unitTests.min(2).`,
          });
        }
        if (component.tddSpec.integrationTests.length < 1) {
          findings.push({
            severity: 'error',
            path: `domains[${domain.id}].components[${component.id}].tddSpec.integrationTests`,
            message: `Component has no integrationTests, minimum is 1.`,
            fix: `Add at least one integrationTest entry to satisfy tddSpec.integrationTests.min(1).`,
          });
        }
      }
    }

    const layerIds = new Set(safeArray<Plan['architectureLayers'][number]>(plan.architectureLayers).map((l) => l.id));
    for (const bc of safeArray<Plan['boundedContexts'][number]>(plan.boundedContexts)) {
      if (!layerIds.has(bc.layer)) {
        findings.push({
          severity: 'error',
          path: `boundedContexts[${bc.id}].layer`,
          message: `Bounded context references unknown architectureLayer id "${bc.layer}".`,
          fix: `Set layer to one of: ${[...layerIds].join(', ')}.`,
        });
      }
    }
    for (const domain of domains) {
      if (!layerIds.has(domain.layer)) {
        findings.push({
          severity: 'error',
          path: `domains[${domain.id}].layer`,
          message: `Domain references unknown architectureLayer id "${domain.layer}".`,
          fix: `Set layer to one of: ${[...layerIds].join(', ')}.`,
        });
      }
    }

    return findings;
  }

  private auditDiagramString(
    value: string,
    path: string,
    findings: AuditFinding[],
  ): void {
    const firstLine = value.split('\n', 1)[0]?.trim() ?? '';
    const type = firstLine.split(/\s+/)[0]?.toLowerCase() ?? '';



    if (firstLine.startsWith('%%{init:')) {
      findings.push({
        severity: 'error',
        path,
        message: 'Diagram begins with a theme override directive that GitHub strips on render.',
        fix: "Remove the leading '%%{init: ...}%%' directive from the first line.",
      });
      return;
    }

    if (!type) {
      findings.push({
        severity: 'error',
        path,
        message: 'Diagram is empty.',
        fix: 'Declare one of the supported diagram types on the first line (flowchart, graph, sequenceDiagram, classDiagram, stateDiagram-v2, erDiagram).',
      });
      return;
    }

    if (!ALLOWED_MERMAID_TYPES.has(type)) {
      findings.push({
        severity: 'error',
        path,
        message: `Diagram uses unsupported type '${type}'.`,
        fix: `Replace '${type}' on the first line with one of: flowchart, graph, sequenceDiagram, classDiagram, stateDiagram-v2, erDiagram.`,
      });
      return;
    }

    const fieldName = path.split('.').pop() ?? '';
    const allowed = DIAGRAM_TYPE_INTENT[fieldName];
    if (allowed && !allowed.includes(type)) {
      findings.push({
        severity: 'warning',
        path,
        message: `Diagram type '${type}' is unusual for field '${fieldName}'.`,
        fix: `Consider using one of: ${allowed.join(', ')}.`,
      });
    }
  }

  runStageAudit(plan: Plan): AuditFinding[] {
    const findings: AuditFinding[] = [];

    const layerIds = new Set(safeArray<Plan['architectureLayers'][number]>(plan.architectureLayers).map((l) => l.id));

    const bcIds = new Set(safeArray<Plan['boundedContexts'][number]>(plan.boundedContexts).map((bc) => bc.id));
    const domainIds = new Set(safeArray<Plan['domains'][number]>(plan.domains).map((d) => d.id));

    for (const domain of safeArray<Plan['domains'][number]>(plan.domains)) {
      if (!layerIds.has(domain.layer)) {
        findings.push({
          severity: 'error',
          path: `domains[${domain.id}].layer`,
          message: `Domain layer '${domain.layer}' is not declared in architectureLayers.`,
          fix: `Add an entry to architectureLayers with id '${domain.layer}', or change the domain's layer to one of: ${[...layerIds].join(', ')}.`,
        });
      }
      for (const comp of safeArray<Plan['domains'][number]['components'][number]>(domain.components)) {
        if (!bcIds.has(comp.layer === 'presentation' ? '' : '') && comp.layer === 'presentation') {

        }
      }
    }

    for (const wf of safeArray<Plan['workflows'][number]>(plan.workflows)) {
      for (const domainId of safeArray<string>(wf.domainIds)) {
        if (!domainIds.has(domainId)) {
          findings.push({
            severity: 'error',
            path: `workflows[${wf.id}].domainIds`,
            message: `Workflow references unknown domain '${domainId}'.`,
            fix: `Add the missing domain, or remove the reference from workflows[${wf.id}].domainIds.`,
          });
        }
      }
    }

    return findings;
  }

  runCitationAudit(plan: Plan): AuditFinding[] {
    const findings: AuditFinding[] = [];

    const bcIds = new Set(safeArray<Plan['boundedContexts'][number]>(plan.boundedContexts).map((bc) => bc.id));
    const domainIds = new Set(safeArray<Plan['domains'][number]>(plan.domains).map((d) => d.id));
    const allComponentIds = new Set<string>();
    const domainEventIdsByDomain = new Map<string, Set<string>>();
    const aggregateIdsByDomain = new Map<string, Set<string>>();
    for (const domain of safeArray<Plan['domains'][number]>(plan.domains)) {
      const events = new Set<string>();
      const aggregates = new Set<string>();
      for (const agg of safeArray<Plan['domains'][number]['aggregates'][number]>(domain.aggregates)) {
        aggregates.add(agg.id);
        for (const evtId of safeArray<string>(agg.domainEvents)) {
          events.add(evtId);
        }
      }
      for (const evt of safeArray<Plan['domains'][number]['domainEvents'][number]>(domain.domainEvents)) {
        events.add(evt.id);
      }
      domainEventIdsByDomain.set(domain.id, events);
      aggregateIdsByDomain.set(domain.id, aggregates);
      for (const comp of safeArray<Plan['domains'][number]['components'][number]>(domain.components)) {
        allComponentIds.add(comp.id);
      }
    }

    for (const domain of safeArray<Plan['domains'][number]>(plan.domains)) {
      const allowedEvents = domainEventIdsByDomain.get(domain.id) ?? new Set();
      const allowedAggregates = aggregateIdsByDomain.get(domain.id) ?? new Set();

      for (const comp of safeArray<Plan['domains'][number]['components'][number]>(domain.components)) {
        const compId = comp.id;



        for (const dep of safeArray<string>(comp.dependencies)) {
          if (!allComponentIds.has(dep)) {
            findings.push({
              severity: 'warning',
              path: `domains[${domain.id}].components[${compId}].dependencies`,
              message: `Component dependency '${dep}' does not match any component in the plan.`,
              fix: `Add a component with id '${dep}', or remove the dependency reference.`,
            });
          }
        }



        if (!comp.publicApi || comp.publicApi.length === 0) {
          findings.push({
            severity: 'warning',
            path: `domains[${domain.id}].components[${compId}].publicApi`,
            message: 'Component publicApi is empty.',
            fix: 'List at least one method signature for this component.',
          });
        }

        const inputs = safeArray<string>(comp.inputs);
        const outputs = safeArray<string>(comp.outputs);
        for (const ref of [...inputs, ...outputs]) {
          if (allowedAggregates.has(ref) || allowedEvents.has(ref)) {
            continue;
          }



          findings.push({
            severity: 'warning',
            path: `domains[${domain.id}].components[${compId}]`,
            message: `Identifier '${ref}' in inputs/outputs is not a known aggregate or domain event in domain '${domain.id}'.`,
            fix: `Verify '${ref}' is a domain term — otherwise add it to aggregates or domainEvents.`,
          });
        }
      }
    }

    for (const adr of safeArray<Plan['adrs'][number]>(plan.adrs)) {
      if (!adr.context && !adr.decision) {
        findings.push({
          severity: 'warning',
          path: `adrs[${adr.id}]`,
          message: 'ADR has empty context and decision.',
          fix: 'Populate context and decision with a real architectural trade-off.',
        });
      }
    }

    for (const wf of safeArray<Plan['workflows'][number]>(plan.workflows)) {
      for (const domainId of safeArray<string>(wf.domainIds)) {
        if (!domainIds.has(domainId)) {
          findings.push({
            severity: 'error',
            path: `workflows[${wf.id}].domainIds`,
            message: `Workflow references unknown domain '${domainId}'.`,
            fix: `Add a domain with id '${domainId}', or remove the reference from workflows[${wf.id}].domainIds.`,
          });
        }
      }
    }

    const map = plan.systemOverview.boundedContextMap;
    if (typeof map === 'string' && map.length > 0) {
      for (const bcId of bcIds) {

        const bracketed = `[${bcId}]`;
        if (!map.includes(bracketed) && !map.includes(`"${bcId}"`)) {

          findings.push({
            severity: 'info',
            path: 'systemOverview.boundedContextMap',
            message: `Bounded context '${bcId}' is not visible in the boundedContextMap diagram.`,
            fix: `Add a node labelled '[${bcId}]' to the boundedContextMap, or remove the context from boundedContexts.`,
          });
        }
      }
    }

    return findings;
  }
}
