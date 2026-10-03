/**
 * Canonical list of allowed Mermaid diagram types. Exported in both
 * camelCase (the documented form used in audit error messages and
 * `local-audit-fixer.service.ts`'s includes() check) and lowercase
 * (the form produced by `.toLowerCase()` on the first token, which
 * `audit-runner.service.ts` checks against the equivalent lowercase
 * set). Two forms are kept to preserve byte-identical behaviour at
 * both call sites — the consumers' case-handling differs.
 */

export const ALLOWED_MERMAID_TYPES = [
  'flowchart',
  'graph',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram-v2',
  'erDiagram',
] as const;

export type AllowedMermaidType = (typeof ALLOWED_MERMAID_TYPES)[number];

export const ALLOWED_MERMAID_TYPES_LOWER = [
  'flowchart',
  'graph',
  'sequencediagram',
  'classdiagram',
  'statediagram-v2',
  'erdiagram',
] as const;

export const ALLOWED_MERMAID_TYPE_SET: ReadonlySet<string> = new Set(
  ALLOWED_MERMAID_TYPES_LOWER,
);
