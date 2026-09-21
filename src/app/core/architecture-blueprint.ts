import {
  ArchitectureLayer,
  BoundedContext,
  Domain,
  DomainComponent,
  Plan,
} from './plan.schema';

function escapeNodeLabel(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeEdgeLabel(text: string): string {
  const AMP = '&' + 'amp;';
  const PIPE = '&#' + '124;';
  const SLASH = '&#' + '47;';
  const QUOT = '&' + 'quot;';
  const LT = '&' + 'lt;';
  const GT = '&' + 'gt;';
  return text
    .replace(/&/g, AMP)
    .replace(/\|/g, PIPE)
    .replace(/\//g, SLASH)
    .replace(/"/g, QUOT)
    .replace(/</g, LT)
    .replace(/>/g, GT)
    .replace(/\\/g, '\\\\')
    .replace(/\r/g, '')
    .replace(/\n/g, ' ')
    .trim();
}

function truncate(text: string, max: number): string {
  const t = (text ?? '').toString().trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  const sliced = t.slice(0, max - 1);
  const lastSpace = sliced.lastIndexOf(' ');
  return (lastSpace > 30 ? sliced.slice(0, lastSpace) : sliced).trimEnd() + '…';
}

function joinLines(...parts: string[]): string {
  return parts
    .map((p) => (p ?? '').toString().trim())
    .filter((p) => p.length > 0)
    .map(escapeNodeLabel)
    .join('\n');
}

function groupContextsByLayer(
  contexts: BoundedContext[],
  layers: ArchitectureLayer[],
): Array<{ key: string; title: string; contexts: BoundedContext[]; layerIndex: number }> {
  const groups: Array<{ key: string; title: string; contexts: BoundedContext[]; layerIndex: number }> = [];
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const items = contexts.filter((c) => c.layer === layer.id);
    if (items.length > 0) {
      groups.push({
        key: layer.id,
        title: `${layer.name} Contexts`,
        contexts: items,
        layerIndex: i,
      });
    }
  }
  const knownLayerIds = new Set(layers.map((l) => l.id));
  const remaining = contexts.filter((c) => !knownLayerIds.has(c.layer));
  if (remaining.length > 0) {
    groups.push({ key: 'other', title: 'Other Contexts', contexts: remaining, layerIndex: -1 });
  }
  return groups;
}

function findDomainForContext(
  context: BoundedContext,
  domains: Domain[],
): Domain | undefined {
  const ctxName = (context.name ?? '').toLowerCase();
  if (!ctxName) {
    return domains.find((d) => d.id === context.id);
  }
  return (
    domains.find((d) => (d.name ?? '').toLowerCase() === ctxName) ??
    domains.find((d) => (d.name ?? '').toLowerCase().includes(ctxName)) ??
    domains.find((d) => d.id === context.id) ??
    domains.find((d) => d.layer === context.layer)
  );
}

function componentTypeLabel(type: DomainComponent['type']): string {
  switch (type) {
    case 'ui-component': return 'UI';
    case 'service': return 'Service';
    case 'store': return 'Store';
    case 'repository': return 'Repository';
    case 'aggregate': return 'Aggregate';
    case 'domain-service': return 'Domain Service';
    case 'use-case': return 'Use Case';
    case 'controller': return 'Controller';
    case 'utility': return 'Utility';
    default: return 'Component';
  }
}

export interface ArchitectureBlueprintOptions {

  contextDescriptionLimit?: number;

  componentsPerDomainLimit?: number;

  maxNodes?: number;
}

const DEFAULTS: Required<ArchitectureBlueprintOptions> = {
  contextDescriptionLimit: 80,
  componentsPerDomainLimit: 2,
  maxNodes: 80,
};

interface PaletteSlot {
  shapeOpen: string;
  shapeClose: string;
  fill: string;
  stroke: string;
  textColor: string;
  cluster: string;
  clusterStroke: string;
}

const PALETTE: readonly PaletteSlot[] = [

  { shapeOpen: '(',  shapeClose: ')',  fill: '#f0f9ff', stroke: '#0284c7', textColor: '#0c4a6e', cluster: '#e0f2fe', clusterStroke: '#0ea5e9' },

  { shapeOpen: '[',  shapeClose: ']',  fill: '#f0fdf4', stroke: '#16a34a', textColor: '#14532d', cluster: '#dcfce7', clusterStroke: '#16a34a' },

  { shapeOpen: '[/', shapeClose: '/]', fill: '#fffbeb', stroke: '#d97706', textColor: '#78350f', cluster: '#fef3c7', clusterStroke: '#d97706' },

  { shapeOpen: '{{', shapeClose: '}}', fill: '#f1f5f9', stroke: '#475569', textColor: '#0f172a', cluster: '#f1f5f9', clusterStroke: '#475569' },

  { shapeOpen: '([', shapeClose: '])', fill: '#f5f3ff', stroke: '#7c3aed', textColor: '#4c1d95', cluster: '#ede9fe', clusterStroke: '#7c3aed' },

  { shapeOpen: '[(', shapeClose: ')]', fill: '#fff1f2', stroke: '#e11d48', textColor: '#881337', cluster: '#ffe4e6', clusterStroke: '#e11d48' },
];

function paletteIndexFor(layerIndex: number): number {
  if (layerIndex < 0) return 1; 

  return layerIndex % PALETTE.length;
}

export function buildArchitectureBlueprint(
  plan: Plan,
  options: ArchitectureBlueprintOptions = {},
): string {
  const opts = { ...DEFAULTS, ...options };

  const actors = (plan.systemOverview?.keyActors ?? [])
    .map((a) => (a ?? '').toString().trim())
    .filter(Boolean);

  const contexts = Array.isArray(plan.boundedContexts) ? plan.boundedContexts : [];
  const domains = Array.isArray(plan.domains) ? plan.domains : [];
  const layers = Array.isArray(plan.architectureLayers) ? plan.architectureLayers : [];

  if (actors.length === 0 && contexts.length === 0 && domains.length === 0) {
    return 'graph TD\nA["No architecture data yet — generate a plan first."]';
  }

  const lines: string[] = ['graph TD'];
  const idRegistry = new Map<string, string>();
  const classRegistry = new Map<string, string>(); 

  const edges: string[] = [];
  const subgroupNames: string[] = [];
  let idCounter = 0;

  const newId = (logicalKey: string): string => {
    const existing = idRegistry.get(logicalKey);
    if (existing) return existing;
    idCounter += 1;
    const id = `n${idCounter}`;
    idRegistry.set(logicalKey, id);
    return id;
  };

  const wouldExceedLimit = () => idCounter >= opts.maxNodes;

  if (actors.length > 0 && !wouldExceedLimit()) {
    lines.push('subgraph S_actors["Key Actors"]');
    lines.push('direction LR');
    for (const actor of actors) {
      if (wouldExceedLimit()) break;
      const id = newId(`actor::${actor}`);
      lines.push(`${id}{{"${escapeNodeLabel(actor)}"}}`);
      classRegistry.set(id, 'layerActor');
    }
    lines.push('end');
    subgroupNames.push('S_actors');
  }

  const grouped = groupContextsByLayer(contexts, layers);
  let subgroupLetter = 0;
  const contextIdById = new Map<string, string>();

  for (const group of grouped) {
    if (wouldExceedLimit()) break;
    subgroupLetter += 1;
    const subgroupId = `S_ctx_${subgroupLetter}`;
    lines.push(`subgraph ${subgroupId}["${escapeNodeLabel(group.title)}"]`);

    const paletteIdx = paletteIndexFor(group.layerIndex);
    const palette = PALETTE[paletteIdx];

    for (const ctx of group.contexts) {
      if (wouldExceedLimit()) break;
      const ctxKey = `ctx::${ctx.id}`;
      const id = newId(ctxKey);
      contextIdById.set(ctx.id, id);
      const desc = truncate(ctx.description ?? '', opts.contextDescriptionLimit);
      const label = joinLines(ctx.name, desc);

      const shape = `${palette.shapeOpen}"${label}"${palette.shapeClose}`;
      classRegistry.set(id, `layerPalette${paletteIdx}`);
      lines.push(`${id}${shape}`);
    }
    lines.push('end');
    subgroupNames.push(subgroupId);
  }

  if (domains.length > 0 && !wouldExceedLimit()) {
    lines.push('subgraph S_dom["Domains & Components"]');
    for (const domain of domains) {
      if (wouldExceedLimit()) break;
      const domId = newId(`dom::${domain.id}`);
      const domDesc = truncate(domain.description ?? '', 60);
      const domLabel = joinLines(domain.name, domDesc);
      lines.push(`${domId}(["${domLabel}"])`);
      classRegistry.set(domId, 'layerDomain');

      const comps = (domain.components ?? []).slice(0, opts.componentsPerDomainLimit);
      for (const comp of comps) {
        if (wouldExceedLimit()) break;
        const compId = newId(`comp::${comp.id}`);
        const typeTag = componentTypeLabel(comp.type);
        const compLabel = joinLines(comp.name, typeTag);
        lines.push(`${compId}["${compLabel}"]`);
        classRegistry.set(compId, 'layerComponent');
        edges.push(`${domId} --- ${compId}`);
      }
    }
    lines.push('end');
    subgroupNames.push('S_dom');
  }

  const actorIds = actors
    .map((a) => idRegistry.get(`actor::${a}`))
    .filter(Boolean) as string[];
  const contextIds = Array.from(contextIdById.values()).filter(Boolean);
  let usesCount = 0;
  for (const actorId of actorIds) {
    if (contextIds.length === 0) break;
    edges.push(`${actorId} -->|"${escapeEdgeLabel('uses')}"| ${contextIds[0]}`);
    usesCount += 1;
  }

  for (const ctx of contexts) {
    const ctxId = contextIdById.get(ctx.id);
    if (!ctxId) continue;
    const domain = findDomainForContext(ctx, domains);
    if (!domain) continue;
    const domId = idRegistry.get(`dom::${domain.id}`);
    if (!domId) continue;
    edges.push(
      `${ctxId} -.->|"${escapeEdgeLabel('implemented by')}"| ${domId}`,
    );
  }









  lines.push('linkStyle default stroke:#94a3b8,stroke-width:1px');
  if (subgroupNames.includes('S_actors'))   lines.push('classDef clusterActors fill:#f1f5f9,stroke:#94a3b8,stroke-width:1px,color:#0f172a');
  if (subgroupNames.includes('S_dom'))      lines.push('classDef clusterDomain fill:#ede9fe,stroke:#7c3aed,stroke-width:1.5px,color:#0f172a');





  for (let i = 0; i < grouped.length; i++) {
    const palIdx = paletteIndexFor(grouped[i].layerIndex);
    const slot = PALETTE[palIdx];
    const subgroupId = `S_ctx_${i + 1}`;
    if (!subgroupNames.includes(subgroupId)) continue;
    lines.push(
      `classDef clusterPalette${palIdx} fill:${slot.cluster},stroke:${slot.clusterStroke},stroke-width:1.5px,color:#0f172a`,
    );
    lines.push(`class ${subgroupId} clusterPalette${palIdx}`);
  }

  if (subgroupNames.includes('S_actors'))   lines.push('class S_actors clusterActors');
  if (subgroupNames.includes('S_dom'))      lines.push('class S_dom clusterDomain');



  lines.push('classDef layerActor     fill:#f8fafc,stroke:#475569,stroke-width:1.5px,color:#0f172a');
  lines.push('classDef layerOther     fill:#f9fafb,stroke:#6b7280,stroke-width:1.5px,color:#1f2937');
  lines.push('classDef layerDomain    fill:#f5f3ff,stroke:#7c3aed,stroke-width:1.5px,color:#4c1d95');
  lines.push('classDef layerComponent fill:#ecfeff,stroke:#0891b2,stroke-width:1px,color:#164e63');
  for (let i = 0; i < PALETTE.length; i++) {
    const slot = PALETTE[i];
    lines.push(
      `classDef layerPalette${i} fill:${slot.fill},stroke:${slot.stroke},stroke-width:1.5px,color:${slot.textColor}`,
    );
  }

  const byClass = new Map<string, string[]>();
  for (const [id, cls] of classRegistry) {
    if (!byClass.has(cls)) byClass.set(cls, []);
    byClass.get(cls)!.push(id);
  }
  for (const [cls, ids] of byClass) {
    lines.push(`class ${ids.join(',')} ${cls}`);
  }

  if (edges.length > 0) {





    lines.push(...edges);
  }

  return lines.join('\n');
}

export function summariseArchitectureLayers(
  layers: ArchitectureLayer[],
): Array<{ name: string; tech: string[]; patterns: string[] }> {
  return (layers ?? [])
    .filter((l) => !!l?.name)
    .map((l) => ({
      name: l.name,
      tech: (l.techStack ?? []).filter(Boolean),
      patterns: (l.patterns ?? []).filter(Boolean),
    }));
}

function techStyleFor(layerIndex: number) {
  const slot = PALETTE[paletteIndexFor(layerIndex)];
  return {
    fill: slot.fill,
    stroke: slot.stroke,
    cluster: slot.cluster,
    clusterStroke: slot.clusterStroke,
  };
}

export interface TechStackDiagramOptions {

  techLabelLimit?: number;

  maxNodes?: number;
}

const TECH_DEFAULTS: Required<TechStackDiagramOptions> = {
  techLabelLimit: 36,
  maxNodes: 80,
};

export function buildTechStackDiagram(
  plan: Plan,
  options: TechStackDiagramOptions = {},
): string[] {
  const opts = { ...TECH_DEFAULTS, ...options };
  const layers = Array.isArray(plan.architectureLayers) ? plan.architectureLayers : [];

  const renderable = layers.filter(
    (l) => Array.isArray(l?.techStack) && (l.techStack ?? []).some(Boolean),
  );
  if (renderable.length === 0) {
    return ['graph TD\nA["No tech stack declared yet."]'];
  }

  const graphs: string[] = [];
  let nextNodeIndex = 0;

  renderable.forEach((layer, idx) => {
    const lines: string[] = ['graph TD'];

    const newId = (): string => {
      nextNodeIndex += 1;
      return `n${nextNodeIndex}`;
    };

    const subgroupId = `S_tech_${idx + 1}`;
    lines.push(`subgraph ${subgroupId}["${escapeNodeLabel(layer.name)}"]`);
    lines.push('direction TD');

    const style = techStyleFor(idx);
    const desc = truncate(layer.description ?? '', 80);
    const headerLabel = joinLines(layer.name, desc);
    const headerId = newId();
    lines.push(`${headerId}["${headerLabel}"]`);

    const techIds: string[] = [];

    for (const raw of layer.techStack ?? []) {
      if (nextNodeIndex >= opts.maxNodes) break;
      const tech = (raw ?? '').toString().trim();
      if (!tech) continue;
      const techId = newId();
      const label = truncate(tech, opts.techLabelLimit);
      lines.push(`${techId}[("${escapeNodeLabel(label)}")]`);
      techIds.push(techId);
      lines.push(`${headerId} --- ${techId}`);
    }

    const patterns = (layer.patterns ?? []).filter(Boolean);
    if (patterns.length > 0 && nextNodeIndex < opts.maxNodes) {
      const patternsId = newId();
      const patternsLabel = joinLines('Patterns', ...patterns);
      lines.push(`${patternsId}(["${patternsLabel}"])`);
      lines.push(`${headerId} --- ${patternsId}`);
    }

    lines.push('end');

    lines.push(
      `classDef ${subgroupId} fill:${style.cluster},stroke:${style.clusterStroke},stroke-width:1.5px,color:#0f172a`,
    );
    lines.push(`class ${subgroupId} ${subgroupId}`);

    if (techIds.length > 0) {
      const cls = `techItemPalette${paletteIndexFor(idx)}`;
      lines.push(
        `classDef ${cls} fill:${style.fill},stroke:${style.stroke},stroke-width:1.5px,color:#0f172a`,
      );
      lines.push(`class ${techIds.join(',')} ${cls}`);
    }

    lines.push('classDef techHeader fill:#ffffff,stroke:#94a3b8,stroke-width:1px,color:#0f172a');
    lines.push(`class ${headerId} techHeader`);

    lines.push('linkStyle default stroke:#94a3b8,stroke-width:1px');

    graphs.push(lines.join('\n'));
  });

  return graphs;
}
