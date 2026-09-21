/**
 * Pure, idempotent sanitiser for LLM-produced Mermaid source.
 *
 * Wraps unsafe node / edge labels in double quotes so that special characters
 * (`(`, `)`, `[`, `]`, `{`, `}`, `|`, `#`, backtick, `:`, `;`, `,`, `<`, `>`,
 * `"`, `\`) inside the label don't get re-interpreted as Mermaid shape, edge,
 * subgraph, or comment syntax.
 *
 * Idempotency is required because Zod transforms apply on every `safeParse`
 * and the active plan is re-parsed when it is rehydrated from `localStorage`
 * after a reload.  Calling `sanitizeMermaidLabels` twice on the same input
 * must yield the same string as calling it once.
 */
const UNSAFE_LABEL_CHAR_REGEX = /[()[\]{}|#`\\:;,<>\/]/;

const NODE_SHAPE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['[(', ')]'],
  ['((', '))'],
  ['{{', '}}'],
  ['[/', '/]'],
  ['[\\', '\\]'],
  ['[/', '\\]'],
  ['[\\', '/]'],
  ['[', ']'],
  ['(', ')'],
  ['{', '}'],
];

const CONTROL_LINE_REGEX =
  /^(?:subgraph|end|classDef|class|style|linkStyle|direction|click)\b/i;

const SEQUENCE_ARROW_REGEX =
  /^(\s*\S+\s*(?:->>|-->>|->|-->|-x|-)\s*\S+\s*:\s*)(.+)$/;

const EDGE_LABEL_REGEX = /(-->)\|([^|\n]*)\|/g;

const WORD_OR_DOT = /^[\w][\w.]*/;

function escapeLabelText(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === '\\') {
      out += '\\\\';
      continue;
    }
    if (ch === '"') {
      out += '\\"';
      continue;
    }
    out += ch;
  }
  return out;
}

function isAlreadyQuoted(content: string): boolean {
  return content.length >= 2 && content.startsWith('"') && content.endsWith('"');
}

function hasUnsafeChar(content: string): boolean {
  return UNSAFE_LABEL_CHAR_REGEX.test(content);
}

function tryQuoteShape(
  line: string,
  cursor: number,
  idToken: string,
): { replacement: string; nextCursor: number } | null {
  for (const [open, close] of NODE_SHAPE_PAIRS) {
    if (!line.startsWith(open, cursor)) continue;
    const contentStart = cursor + open.length;
    const closerIdx = line.indexOf(close, contentStart);
    if (closerIdx === -1) continue;
    const content = line.slice(contentStart, closerIdx);
    const fullMatch = idToken + open + content + close;
    if (isAlreadyQuoted(content) || !hasUnsafeChar(content)) {
      return { replacement: fullMatch, nextCursor: closerIdx + close.length };
    }
    const quoted = `${idToken}${open}"${escapeLabelText(content)}"${close}`;
    return { replacement: quoted, nextCursor: closerIdx + close.length };
  }
  return null;
}

function sanitiseLineShape(line: string): string {
  let out = '';
  let i = 0;
  while (i < line.length) {
    const remaining = line.slice(i);
    const idMatch = WORD_OR_DOT.exec(remaining);
    if (!idMatch) {
      out += line[i];
      i += 1;
      continue;
    }
    const cursor = i + idMatch[0].length;
    const shaped = tryQuoteShape(line, cursor, idMatch[0]);
    if (shaped) {
      out += shaped.replacement;
      i = shaped.nextCursor;
      continue;
    }
    out += idMatch[0];
    i = cursor;
  }
  return out;
}

function sanitiseEdgeLabels(line: string): string {
  return line.replace(EDGE_LABEL_REGEX, (match, arrow: string, label: string) => {
    const trimmed = label.trim();
    if (isAlreadyQuoted(trimmed) || !hasUnsafeChar(trimmed)) {
      return match;
    }
    return `${arrow}|"${escapeLabelText(trimmed)}"|`;
  });
}

function isSequenceMessageLine(line: string): boolean {
  if (line.trimStart().startsWith('%%')) return false;
  return SEQUENCE_ARROW_REGEX.test(line);
}

function sanitiseLine(line: string, isSequence: boolean): string {
  const trimmed = line.trim();
  if (!trimmed) return line;
  if (trimmed.startsWith('%%')) return line;
  if (CONTROL_LINE_REGEX.test(trimmed)) return line;

  if (isSequence && isSequenceMessageLine(line)) {
    return line;
  }
  return sanitiseEdgeLabels(sanitiseLineShape(line));
}

export function sanitizeMermaidLabels(chart: string): string {
  if (!chart) return chart;
  const lines = chart.split('\n');
  const firstLine = (lines[0] ?? '').trim();
  const isSequence = /^sequenceDiagram\b/i.test(firstLine);
  return lines.map((line) => sanitiseLine(line, isSequence)).join('\n');
}
