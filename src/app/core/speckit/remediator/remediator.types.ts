import { Plan } from '../../plan.schema';

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type ExportStageFn = (plan: Plan, files: ReadonlyArray<MarkdownFile>) => Finding[];

export interface DraftSlice {
  path: string;
  content: string;
}

export type FixKind =
  | 'plan-patch'
  | 'markdown-replace'
  | 'task-insert'
  | 'task-split'
  | 'constitution-replace'
  | 'doc-insert'
  | 'noop';

export interface Fix {
  kind: FixKind;
  payload: unknown;
}

export interface Finding {
  id: string;
  severity: Severity;
  message: string;
  fix?: Fix;
}

export interface RemediationReport {
  findings: Finding[];
  applied: Finding[];
  skipped: Finding[];
}

export interface ExportPassResult {
  files: Array<{ path: string; content: string }>;
  report: RemediationReport;
}

export interface MarkdownFile {
  path: string;
  content: string;
}

export interface Patch {
  file:
    | 'spec.md'
    | 'plan.md'
    | 'tasks.md'
    | 'checklist.md'
    | 'data-model.md'
    | 'constitution.md'
    | '*';
  selector: string;
  op: 'append' | 'replace' | 'prepend' | 'remove';
  content?: string;
}

export interface HSelectorMatch {
  file: string;
  heading: string;
  depth: number;
  /** Lower-cased, whitespace-collapsed content hash for stability. */
  hash: string;
}

export function computeHeadingHash(heading: string): string {
  return heading.trim().toLowerCase().replace(/\s+/g, ' ');
}
