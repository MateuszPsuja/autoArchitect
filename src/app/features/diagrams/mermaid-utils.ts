export function normalizeMermaidChart(chart: string): string {
  if (!chart) return chart ?? '';

  let c = chart.replace(/^\uFEFF/, '').trim();

  if (c.startsWith('```') && c.endsWith('```')) {
    c = c
      .replace(/^```\w*\n?/, '')
      .replace(/\n?```$/, '')
      .trim();
  }

  c = c.replace(/^\s*#{1,6}\s.*\n+/, '').trim();

  const sanitizeExistingMermaid = (source: string, escapeEdgeLabel: (s: string) => string) => {
    const lines = source.split(/\r?\n/).map((l) => l.trimEnd());





    const firstLine = lines[0]?.trim() ?? '';
    const isSequence = /^sequenceDiagram\b/i.test(firstLine);
    const sequenceArrowRegex = /^(\s*\w+(?:->>|-->>|->|-->|-x|-)\s*\w+\s*:\s*)(.+)$/;
    return lines
      .map((line) => {



        if (isSequence) {
          const m = line.match(sequenceArrowRegex);
          if (m) {
            return `${m[1]}${escapeEdgeLabel(m[2])}`;
          }
        }

        return line.replace(/-->(?:\|)(.*?)(?:\|)\s*/g, (_match, rawLabel: string) => {
          const unquoted = rawLabel.trim().replace(/^"([\s\S]*)"$/, '$1');
          return `-->|"${escapeEdgeLabel(unquoted)}"| `;
        });
      })
      .join('\n');
  };

  const diagramTypeRegex =
    /^\s*(?:graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|gantt|erDiagram|journey|pie|mindmap|timeline|gitgraph|requirementDiagram)\b/i;



  const lines = c
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const nodes = new Map<string, string>();
  let nodeIdx = 0;
  const nodeDefs: string[] = [];
  const edges: string[] = [];
  const arrowRegex = /^\s*(.+?)\s*->\s*(.+?)(?:\s*:\s*(.+))?$/;
  const escapeNodeLabel = (s: string) => applyMermaidEscapes(s, NODE_LABEL_ESCAPES);
  const escapeEdgeLabel = (s: string) => applyMermaidEscapes(s, EDGE_LABEL_ESCAPES);
  if (diagramTypeRegex.test(c)) {











    const graphHeaderMatch = c.match(/^(\s*(?:graph|flowchart)\s+(?:TD|LR|TB|RL|BT))\s*/i);
    const otherHeaderMatch =
      !graphHeaderMatch &&
      c.match(
        /^(\s*(?:sequenceDiagram|classDiagram|stateDiagram|gantt|erDiagram|journey|pie|mindmap|timeline|gitgraph|requirementDiagram)\b[^\n]*)\r?\n?/i,
      );

    const headerToken = graphHeaderMatch ?? otherHeaderMatch;
    if (headerToken) {
      const header = headerToken[1].trim();
      const body = c.slice(headerToken[0].length).trim();

      if (body.length > 0) {











        const looksLikeMermaid = /-->|->>|\b\w+\[|^subgraph\b/m.test(body);
        if (!looksLikeMermaid) {

          try {
            const parts = body
              .split(/;+/)
              .map((p) => p.trim())
              .filter(Boolean);
            const autoNodeDefs: string[] = [];
            const autoEdges: string[] = [];
            for (let i = 0; i < parts.length; i++) {
              const id = `n${i + 1}`;
              autoNodeDefs.push(`${id}["${escapeNodeLabel(parts[i])}"]`);
              if (i > 0) {
                autoEdges.push(`n${i} --> n${i + 1}`);
              }
            }
            return balanceSubgraphBlocks(
              `graph TD\n${[...autoNodeDefs, ...autoEdges].join('\n')}`,
            );
          } catch (e) {

          }
        }

        return balanceSubgraphBlocks(
          sanitizeExistingMermaid(`${header}\n${body}`, escapeEdgeLabel),
        );
      }
    }

    return balanceSubgraphBlocks(sanitizeExistingMermaid(c, escapeEdgeLabel));
  }
  const normalizeLabel = (label: string) => {
    let t = label.trim();
    if ((t.startsWith('[') && t.endsWith(']')) || (t.startsWith('(') && t.endsWith(')'))) {
      t = t.slice(1, -1).trim();
    }
    if (t.startsWith('"') && t.endsWith('"')) {
      t = t.slice(1, -1);
    }
    return t;
  };
  const getId = (label: string) => {
    const key = label;
    if (!nodes.has(key)) {
      nodeIdx += 1;
      const id = `n${nodeIdx}`;
      nodes.set(key, id);
      nodeDefs.push(`${id}["${escapeNodeLabel(label)}"]`);
    }
    return nodes.get(key)!;
  };

  for (const line of lines) {
    const m = line.match(arrowRegex);
    if (m) {
      const leftRaw = normalizeLabel(m[1]);
      const rightRaw = normalizeLabel(m[2]);
      const edgeLabel = m[3] ? m[3].trim() : '';
      const leftId = getId(leftRaw);
      const rightId = getId(rightRaw);
      if (edgeLabel) {
        edges.push(`${leftId} -->|"${escapeEdgeLabel(edgeLabel)}"| ${rightId}`);
      } else {
        edges.push(`${leftId} --> ${rightId}`);
      }
    } else {

      edges.push(line);
    }
  }

  if (nodeDefs.length || edges.length) {
    c = [...nodeDefs, ...edges].join('\n');
  }



  c = c.replace(/^\s+/, '');
  c = `graph TD\n${c}`;
  return balanceSubgraphBlocks(c);
}

function balanceSubgraphBlocks(source: string): string {
  const lines = source.split(/\r?\n/);
  const out: string[] = [];
  let depth = 0;

  for (const raw of lines) {
    const trimmed = raw.trim();

    if (trimmed.startsWith('%%')) {
      out.push(raw);
      continue;
    }

    const isSubgraph = /^subgraph\b/i.test(trimmed);
    const isEnd = /^end\s*$/i.test(trimmed);

    if (isSubgraph) {
      out.push(raw);
      depth += 1;
      continue;
    }
    if (isEnd) {
      if (depth <= 0) {
        continue;
      }
      depth -= 1;
      out.push(raw);
      continue;
    }
    out.push(raw);
  }

  while (depth > 0) {
    out.push('end');
    depth -= 1;
  }





  return out.join('\n');
}

interface EscapeTableEntry {
  char: string;
  replacement: string;
}

const EDGE_LABEL_ESCAPES: ReadonlyArray<EscapeTableEntry> = [









  { char: '"', replacement: '\\"' },
  { char: '\\', replacement: '\\\\' },
  { char: '\r', replacement: '' },
  { char: '\n', replacement: ' ' },
];

const NODE_LABEL_ESCAPES: ReadonlyArray<EscapeTableEntry> = [





  { char: '\\', replacement: '\\\\' },
  { char: '"', replacement: '\\"' },
  { char: '\r', replacement: '' },
  { char: '\n', replacement: ' ' },
];

function applyMermaidEscapes(s: string, table: ReadonlyArray<EscapeTableEntry>): string {
  const lookup = new Map<string, string>();
  for (const { char, replacement } of table) {
    lookup.set(char, replacement);
  }
  const out: string[] = [];
  for (let i = 0; i < s.length; i += 1) {



    if (s[i] === '&' && s[i + 1] === '#') {
      const semi = s.indexOf(';', i + 2);
      if (semi !== -1 && /^\d+$/.test(s.slice(i + 2, semi))) {
        out.push(String.fromCharCode(Number.parseInt(s.slice(i + 2, semi), 10)));
        i = semi;
        continue;
      }
    }
    const ch = s[i];
    if (ch === '&') {
      out.push('&amp;');
      continue;
    }
    const replacement = lookup.get(ch);
    if (replacement !== undefined) {
      out.push(replacement);
      continue;
    }
    out.push(ch);
  }
  return out.join('').trim();
}
