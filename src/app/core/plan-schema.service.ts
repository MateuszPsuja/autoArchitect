import { Injectable } from '@angular/core';
import { z, ZodError } from 'zod';
import {
  ArchitectureLayer,
  BoundedContext,
  BoundedContextChunkSchema,
  ConstitutionSchema,
  Domain,
  DomainChunkSchema,
  LayerChunkSchema,
  Plan,
  PlanSchema,
  ScaffoldSchema,
  TailSchema,
} from './plan.schema';
import { PdfDocument, PdfDocumentSchema, PdfPartialDocumentSchema } from './pdf-document.schema';
import { AuditFinding, AuditRunner } from './audit-runner.service';
import { ElementKind, UserEditSummary } from './diff/user-edit-summary';
import { sanitizeMermaidLabels } from './mermaid-label-sanitizer';

export type Scaffold = z.infer<typeof ScaffoldSchema>;
export type Tail = z.infer<typeof TailSchema>;

export type StageKind = 'scaffold' | 'layers' | 'domains' | 'tail';

export type PdfDocumentRepairReason =
  | 'single_section_root'
  | 'array_section_headings'
  | 'matrix_shape';

export interface PdfDocumentRepair {
  reason: PdfDocumentRepairReason;
  placeholderCount: number;
  originalHeading?: string;
  originalHeadings?: string[];
  rawBytes?: number;
  finishReason?: string;
  attemptCount?: number;
}

export type PdfDocumentRepairOutcome =
  | { kind: 'unchanged'; candidate: unknown }
  | { kind: 'repaired'; candidate: unknown; repair: PdfDocumentRepair }
  | { kind: 'unrecoverable'; reason: string };

export interface StageValidationFailure {
  success: false;
  fields: string[];
  message: string;
}

export type StageValidationResult<K extends StageKind, T> =
  | { success: true; kind: K; data: T }
  | StageValidationFailure;

export type MergeScaffoldResult =
  | { success: true; value: Plan; sanitisedCount?: number }
  | {
      success: false;
      error: string;
      field: 'layers' | 'domains' | 'final';
    };

const PLAN_WRAPPER_KEYS = ['plan', 'result', 'output', 'response', 'data'] as const;

const REQUIRED_PLAN_KEYS = [
  'meta',
  'systemOverview',
  'boundedContexts',
  'architectureLayers',
  'domains',
] as const;

const RAW_SNIPPET_LIMIT = 200;

export const STUB_MARKER = 'Auto-generated placeholder';

function sanitiseMermaidString(value: string): { value: string; changed: boolean } {
  const next = sanitizeMermaidLabels(value);
  return { value: next, changed: next !== value };
}

function sanitiseAndCount(
  fields: Record<string, string | undefined>,
): { sanitised: Record<string, string | undefined>; count: number } {
  let count = 0;
  const sanitised: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== 'string') {
      sanitised[key] = value;
      continue;
    }
    const result = sanitiseMermaidString(value);
    if (result.changed) count += 1;
    sanitised[key] = result.value;
  }
  return { sanitised, count };
}

function sanitiseId(raw: string): string {
  return raw
    .replace(/[^a-z0-9-]/gi, '-')
    .toLowerCase()
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

@Injectable({ providedIn: 'root' })
export class PlanSchemaService {

  static isPlan(value: unknown): value is Plan {
    return PlanSchema.safeParse(value).success;
  }

  readonly schema = PlanSchema;





  readonly jsonSchema = z.toJSONSchema(PlanSchema, { unrepresentable: 'any' });

  readonly pdfSchema = PdfDocumentSchema;
  readonly pdfJsonSchema = z.toJSONSchema(PdfDocumentSchema);

  validate(
    candidate: unknown,
  ): { success: true; plan: Plan } | { success: false; fields: string[]; message: string } {
    const result = this.schema.safeParse(candidate);

    if (result.success) {
      return { success: true, plan: result.data };
    }

    return {
      success: false,
      fields: this.flattenErrorPaths(result.error),
      message: 'Plan schema validation failed.',
    };
  }

  validatePlan(
    candidate: unknown,
    raw?: string,
  ): { success: true; plan: Plan } | { success: false; fields: string[]; message: string } {
    const unwrapped = this.unwrapPlanCandidate(candidate);
    const result = this.schema.safeParse(unwrapped);

    if (result.success) {
      return { success: true, plan: result.data };
    }

    const fields = this.flattenErrorPaths(result.error);
    return {
      success: false,
      fields,
      message: this.composeMessage(fields, raw),
    };
  }

  validatePdfDocument(
    candidate: unknown,
  ):
    | { success: true; document: PdfDocument }
    | { success: false; fields: string[]; message: string } {
    const result = this.pdfSchema.safeParse(candidate);

    if (result.success) {
      return { success: true, document: result.data };
    }

    const fields = this.flattenErrorPaths(result.error);
    return {
      success: false,
      fields,
      message: this.composeSchemaFailureMessage(fields),
    };
  }

  validatePdfSections(
    candidate: unknown,
  ):
    | { success: true; sections: import('./pdf-document.schema').PdfSection[] }
    | { success: false; fields: string[]; message: string } {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return {
        success: false,
        fields: ['(root): Invalid input: expected object'],
        message: 'Partial PdfDocument must be an object with a `sections` array.',
      };
    }
    const repaired = this.repairPdfDocumentTuples(candidate);
    const result = PdfPartialDocumentSchema.safeParse(repaired);
    if (result.success) {
      return { success: true, sections: result.data.sections };
    }
    const fields = this.flattenErrorPaths(result.error);
    return {
      success: false,
      fields,
      message: this.composeSchemaFailureMessage(fields, repaired),
    };
  }

  validatePdfDocumentWithUnwrap(
    candidate: unknown,
    planContext?: { title?: string; summary?: string },
  ):
    | { success: true; document: PdfDocument; repair?: PdfDocumentRepair }
    | { success: false; fields: string[]; message: string; repair?: PdfDocumentRepair } {
    const sectionRepair = this.repairPdfDocumentSectionRoot(candidate, planContext);
    let repair: PdfDocumentRepair | undefined;
    let working: unknown = candidate;
    if (sectionRepair.kind === 'repaired') {
      working = sectionRepair.candidate;
      repair = sectionRepair.repair;
    }
    const forms = this.expandCandidateForms(working);
    const repaired = this.repairPdfDocumentTuples(working);
    let matrixRepairInfo: { paddingCount: number; truncatingCount: number; columnCount: number } | undefined;
    if (repaired !== working) {
      forms.push(repaired);
      const repairedUnwrapped = this.expandCandidateForms(repaired);
      for (const form of repairedUnwrapped) {
        if (!forms.includes(form)) forms.push(form);
      }
      matrixRepairInfo = this.collectMatrixShapeRepairInfo(repaired);
    }
    let lastFields: string[] = [];
    for (const form of forms) {
      const result = this.pdfSchema.safeParse(form);
      if (result.success) {
        const composed: PdfDocumentRepair | undefined = this.composeRepairWithMatrix(repair, matrixRepairInfo);
        return { success: true, document: result.data, ...(composed ? { repair: composed } : {}) };
      }
      lastFields = this.flattenErrorPaths(result.error);
    }

    return {
      success: false,
      fields: lastFields,
      message: this.composeSchemaFailureMessage(lastFields, working),
      ...(repair ? { repair } : {}),
    };
  }

  private composeRepairWithMatrix(
    sectionRepair: PdfDocumentRepair | undefined,
    matrixRepairInfo: { paddingCount: number; truncatingCount: number; columnCount: number } | undefined,
  ): PdfDocumentRepair | undefined {
    if (!matrixRepairInfo) return sectionRepair;
    const sectionIsMatrix = sectionRepair?.reason === 'matrix_shape';
    if (sectionRepair && !sectionIsMatrix) return sectionRepair;
    const matrixRepair: PdfDocumentRepair = {
      reason: 'matrix_shape',
      placeholderCount: matrixRepairInfo.paddingCount + matrixRepairInfo.truncatingCount,
    };
    return sectionIsMatrix ? sectionRepair : matrixRepair;
  }

  private collectMatrixShapeRepairInfo(
    candidate: unknown,
  ): { paddingCount: number; truncatingCount: number; columnCount: number } | undefined {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
    const sections = (candidate as Record<string, unknown>)['sections'];
    if (!Array.isArray(sections)) return undefined;
    let paddingCount = 0;
    let truncatingCount = 0;
    let columnCount = 0;
    for (const section of sections) {
      if (!section || typeof section !== 'object' || Array.isArray(section)) continue;
      const blocks = (section as Record<string, unknown>)['blocks'];
      if (!Array.isArray(blocks)) continue;
      for (const block of blocks) {
        const info = (block as Record<string, unknown> | null)?.['__matrixShapeRepair'] as
          | { paddingCount: number; truncatingCount: number; columnCount: number }
          | undefined;
        if (info) {
          paddingCount += info.paddingCount;
          truncatingCount += info.truncatingCount;
          columnCount = info.columnCount;
        }
      }
    }
    if (paddingCount === 0 && truncatingCount === 0) return undefined;
    return { paddingCount, truncatingCount, columnCount };
  }

  private probePdfCandidateShape(candidate: unknown): string {
    if (candidate === null || candidate === undefined) {
      return `value: ${candidate === null ? 'null' : 'undefined'}`;
    }
    if (Array.isArray(candidate)) {
      const firstItem = candidate[0];
      const firstKeys =
        firstItem && typeof firstItem === 'object' && !Array.isArray(firstItem)
          ? `; first item keys: [${Object.keys(firstItem as Record<string, unknown>).join(', ')}]`
          : '';
      const typeSummary = this.summariseArrayItemTypes(candidate);
      return `array length=${candidate.length}${firstKeys}${typeSummary}`;
    }
    if (typeof candidate !== 'object') {
      const preview = String(candidate).slice(0, 80).replace(/\s+/g, ' ');
      return `${typeof candidate} "${preview}"`;
    }
    const record = candidate as Record<string, unknown>;
    const keys = Object.keys(record);
    const summary = keys
      .slice(0, 10)
      .map((k) => {
        const v = record[k];
        if (v === null) return `${k}=null`;
        if (Array.isArray(v)) {
          return `${k}=array(len=${v.length})`;
        }
        if (typeof v === 'object') {
          const innerKeys = Object.keys(v as Record<string, unknown>).slice(0, 6).join(', ');
          const more =
            Object.keys(v as Record<string, unknown>).length > 6 ? ', …' : '';
          return `${k}=object{${innerKeys}${more}}`;
        }
        if (typeof v === 'string') {
          const preview = v.length > 40 ? v.slice(0, 40).replace(/\s+/g, ' ') + '…' : v.replace(/\s+/g, ' ');
          return `${k}=string(${v.length}) "${preview}"`;
        }
        return `${k}=${typeof v}`;
      })
      .join('\n  ');
    const more = keys.length > 10 ? `\n  …and ${keys.length - 10} more keys` : '';
    return `object keys: [${keys.join(', ')}]\n  ${summary}${more}`;
  }

  private summariseArrayItemTypes(arr: readonly unknown[]): string {
    if (arr.length === 0) return '';
    const sample = arr.slice(0, 5);
    const lines = sample.map((item, i) => {
      if (item === null) return `  [${i}] null`;
      if (Array.isArray(item)) return `  [${i}] array(len=${item.length})`;
      if (typeof item === 'object') {
        const innerKeys = Object.keys(item as Record<string, unknown>).slice(0, 6).join(', ');
        const more =
          Object.keys(item as Record<string, unknown>).length > 6 ? ', …' : '';
        return `  [${i}] object{${innerKeys}${more}}`;
      }
      if (typeof item === 'string') {
        const preview = item.length > 60 ? item.slice(0, 60).replace(/\s+/g, ' ') + '…' : item.replace(/\s+/g, ' ');
        return `  [${i}] string(${item.length}) "${preview}"`;
      }
      return `  [${i}] ${typeof item}`;
    });
    const more = arr.length > 5 ? `\n  …and ${arr.length - 5} more items` : '';
    return `\n  item types:\n${lines.join('\n')}${more}`;
  }

  private repairPdfDocumentSectionRoot(
    candidate: unknown,
    planContext?: { title?: string; summary?: string },
  ): PdfDocumentRepairOutcome {
    if (!candidate || typeof candidate !== 'object') {
      return { kind: 'unrecoverable', reason: 'candidate is not an object or array' };
    }

    if (Array.isArray(candidate)) {
      return this.repairArrayOfSectionHeadings(candidate, planContext);
    }

    const record = candidate as Record<string, unknown>;
    const keys = Object.keys(record);
    const documentKeys = new Set([
      'title',
      'subtitle',
      'generatedAt',
      'executiveSummary',
      'sections',
    ]);
    const hasAnyDocumentKey = keys.some((k) => documentKeys.has(k));
    if (hasAnyDocumentKey) return { kind: 'unchanged', candidate };

    const heading = record['heading'];
    const blocks = record['blocks'];
    if (typeof heading !== 'string' || heading.length === 0) {
      return { kind: 'unrecoverable', reason: 'no document-shaped root and no PdfSection heading/blocks pair' };
    }
    if (!Array.isArray(blocks)) {
      return { kind: 'unrecoverable', reason: 'heading present but blocks is not an array' };
    }

    const executiveSummary = this.synthesiseExecutiveSummary(blocks) ??
      this.synthesisePlaceholderSummary(planContext, heading);
    const trimmedHeading = heading.length > 120 ? heading.slice(0, 120).trimEnd() : heading;

    const realSection = {
      heading: trimmedHeading,
      blocks,
    };
    const paddingBlocks = this.collectPaddingBlocks(blocks, 2);
    const sections: Array<{ heading: string; blocks: unknown[] }> = [realSection];
    let paddingIdx = 0;
    while (sections.length < 3) {
      const nextIdx = sections.length + 1;
      const realBlock = paddingBlocks[paddingIdx % paddingBlocks.length];
      paddingIdx += 1;
      sections.push({
        heading: `Section ${nextIdx} — additional context`,
        blocks: [
          {
            kind: 'paragraph',
            text: this.synthesisePlaceholderParagraph({
              planContext,
              realBlock,
              sectionIndex: nextIdx,
            }),
          },
        ],
      });
    }

    const placeholderCount = sections.length - 1;
    const repaired = {
      title: trimmedHeading,
      subtitle: undefined,
      generatedAt: new Date().toISOString(),
      executiveSummary,
      sections,
    };
    return {
      kind: 'repaired',
      candidate: repaired,
      repair: {
        reason: 'single_section_root',
        placeholderCount,
        originalHeading: trimmedHeading,
      },
    };
  }

  private repairArrayOfSectionHeadings(
    candidate: unknown[],
    planContext?: { title?: string; summary?: string },
  ): PdfDocumentRepairOutcome {
    const headings = candidate
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((h) => (h.length > 120 ? h.slice(0, 120).trimEnd() : h));
    if (headings.length === 0) {
      return { kind: 'unrecoverable', reason: 'array candidate contains no non-empty string headings' };
    }
    let paddingIdx = 0;
    const sections: Array<{ heading: string; blocks: unknown[] }> = headings.map((heading) => {
      const text = this.synthesisePlaceholderParagraph({
        planContext,
        heading,
        sectionIndex: paddingIdx + 1,
      });
      paddingIdx += 1;
      return {
        heading,
        blocks: [{ kind: 'paragraph', text }],
      };
    });
    while (sections.length < 3) {
      const nextIdx = sections.length + 1;
      sections.push({
        heading: `Section ${nextIdx} — additional context`,
        blocks: [
          {
            kind: 'paragraph',
            text: this.synthesisePlaceholderParagraph({
              planContext,
              sectionIndex: nextIdx,
            }),
          },
        ],
      });
    }
    const title = headings[0];
    const summary = this.synthesisePlaceholderSummary(planContext, headings.join('; '));
    const executiveSummary = summary.length > 400 ? summary.slice(0, 400).trimEnd() + '…' : summary;
    return {
      kind: 'repaired',
      candidate: {
        title,
        subtitle: undefined,
        generatedAt: new Date().toISOString(),
        executiveSummary,
        sections,
      },
      repair: {
        reason: 'array_section_headings',
        placeholderCount: sections.length,
        originalHeadings: headings.slice(),
      },
    };
  }

  private synthesiseExecutiveSummary(blocks: readonly unknown[]): string | undefined {
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      const record = block as Record<string, unknown>;
      if (record['kind'] === 'paragraph' && typeof record['text'] === 'string') {
        const text = record['text'].trim();
        if (text.length >= 20) {
          return text.length > 400 ? text.slice(0, 400).trimEnd() + '…' : text;
        }
      }
    }
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      const record = block as Record<string, unknown>;
      if (record['kind'] === 'bullets' && Array.isArray(record['items'])) {
        const items = (record['items'] as unknown[])
          .filter((s): s is string => typeof s === 'string')
          .join(' ');
        if (items.length >= 20) {
          return items.length > 400 ? items.slice(0, 400).trimEnd() + '…' : items;
        }
      }
    }
    return undefined;
  }

  private collectPaddingBlocks(blocks: readonly unknown[], count: number): unknown[] {
    const usable: unknown[] = [];
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      const record = block as Record<string, unknown>;
      if (record['kind'] === 'paragraph' && typeof record['text'] === 'string') {
        const text = record['text'].trim();
        if (text.length >= 1) usable.push(record);
      } else if (record['kind'] === 'bullets' && Array.isArray(record['items'])) {
        const items = (record['items'] as unknown[]).filter((s): s is string => typeof s === 'string');
        if (items.length > 0) usable.push(record);
      }
    }
    if (usable.length === 0) return [];
    const out: unknown[] = [];
    for (let i = 0; i < count; i += 1) {
      out.push(usable[(i + 1) % usable.length] ?? usable[0]);
    }
    return out;
  }

  private synthesisePlaceholderParagraph(opts: {
    planContext?: { title?: string; summary?: string };
    realBlock?: unknown;
    heading?: string;
    sectionIndex: number;
  }): string {
    const fromReal = this.textFromRealBlock(opts.realBlock);
    if (fromReal) {
      const trimmed = fromReal.length > 220 ? fromReal.slice(0, 220).trimEnd() + '…' : fromReal;
      return opts.heading ? `${trimmed} [Section: ${opts.heading}]` : trimmed;
    }
    const base = opts.planContext?.summary?.trim();
    if (base && base.length >= 1) {
      const excerpt = base.length > 200 ? base.slice(0, 200).trimEnd() + '…' : base;
      return opts.heading ? `${excerpt} [Section: ${opts.heading}]` : excerpt;
    }
    const title = opts.planContext?.title?.trim();
    if (title) {
      return opts.heading
        ? `Plan: ${title}. Section "${opts.heading}" content will be expanded in a subsequent export.`
        : `Plan: ${title}. Additional context will be expanded in a subsequent export.`;
    }
    return opts.heading
      ? `Section "${opts.heading}" content will be expanded in a subsequent export.`
      : `Additional context will be expanded in a subsequent export.`;
  }

  private synthesisePlaceholderSummary(
    planContext: { title?: string; summary?: string } | undefined,
    fallbackHint: string,
  ): string {
    const summary = planContext?.summary?.trim();
    if (summary && summary.length >= 1) {
      const built = `Plan: ${summary}`;
      return built.length >= 20 ? built : `${built} — ${fallbackHint}`.trim();
    }
    const title = planContext?.title?.trim();
    if (title) {
      const built = `Plan distilled from the active plan titled "${title}". ${fallbackHint}`.trim();
      return built.length >= 20 ? built : `${built} Additional context will be expanded in a subsequent export.`;
    }
    const built = `Plan distilled from the active plan. ${fallbackHint}`.trim();
    return built.length >= 20
      ? built
      : `${built} Additional context will be expanded in a subsequent export.`;
  }

  private textFromRealBlock(block: unknown): string | undefined {
    if (!block || typeof block !== 'object') return undefined;
    const record = block as Record<string, unknown>;
    if (record['kind'] === 'paragraph' && typeof record['text'] === 'string') {
      const text = record['text'].trim();
      if (text.length >= 1) return text;
    }
    if (record['kind'] === 'bullets' && Array.isArray(record['items'])) {
      const items = (record['items'] as unknown[])
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (items.length > 0) return items.join('; ');
    }
    return undefined;
  }

  private repairPdfDocumentTuples(candidate: unknown): unknown {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return candidate;
    }
    const record = candidate as Record<string, unknown>;
    if (!Array.isArray(record['sections'])) {
      return candidate;
    }
    const sections = record['sections'] as unknown[];
    const repairedSections = sections.map((section) => {
      if (!section || typeof section !== 'object' || Array.isArray(section)) return section;
      const sectionRecord = section as Record<string, unknown>;
      if (!Array.isArray(sectionRecord['blocks'])) return section;
      const blocks = sectionRecord['blocks'] as unknown[];
      const repairedBlocks = blocks.map((block) => this.repairPdfBlock(block));
      return { ...sectionRecord, blocks: repairedBlocks };
    });
    return { ...record, sections: repairedSections };
  }

  private repairPdfBlock(block: unknown): unknown {
    if (!block || typeof block !== 'object' || Array.isArray(block)) return block;
    const record = block as Record<string, unknown>;
    if (record['kind'] === 'keyValueTable' && Array.isArray(record['rows'])) {
      const rows = record['rows'] as unknown[];
      const repaired = rows.map((row) => this.collapseTuple(row));
      return { ...record, rows: repaired };
    }
    if (record['kind'] === 'glossary' && Array.isArray(record['entries'])) {
      const entries = record['entries'] as unknown[];
      const repaired = entries.map((entry) => this.collapseTuple(entry));
      return { ...record, entries: repaired };
    }
    if (record['kind'] === 'matrix' && Array.isArray(record['columns']) && Array.isArray(record['rows'])) {
      const columns = record['columns'] as unknown[];
      const rows = record['rows'] as unknown[];
      const colCount = columns.length;
      let paddingCount = 0;
      let truncatingCount = 0;
      const repairedRows = rows.map((row) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
        const rowRecord = row as Record<string, unknown>;
        if (!Array.isArray(rowRecord['cells'])) return row;
        const cells = rowRecord['cells'] as unknown[];
        if (cells.length === colCount) return row;
        if (cells.length < colCount) {
          paddingCount += colCount - cells.length;
          const padded = cells.slice();
          while (padded.length < colCount) padded.push('');
          return { ...rowRecord, cells: padded };
        }
        truncatingCount += cells.length - colCount;
        return { ...rowRecord, cells: cells.slice(0, colCount) };
      });
      const changed = paddingCount > 0 || truncatingCount > 0;
      if (!changed) return block;
      const next: Record<string, unknown> = { ...record, rows: repairedRows };
      (next as Record<string, unknown>)['__matrixShapeRepair'] = {
        paddingCount,
        truncatingCount,
        columnCount: colCount,
      };
      return next;
    }
    return block;
  }

  private collapseTuple(tuple: unknown): unknown {
    if (!Array.isArray(tuple)) return tuple;
    if (tuple.length === 2) return tuple;
    const [first, ...rest] = tuple;
    if (typeof first !== 'string') return tuple;
    if (rest.some((item) => typeof item !== 'string')) return tuple;
    if (tuple.length < 2) return tuple;
    const joined = rest.filter((s) => typeof s === 'string').join('; ');
    return [first, joined];
  }

  private composeSchemaFailureMessage(fields: readonly string[], candidate?: unknown): string {
    const preview = fields.slice(0, 4).map((f) => `  • ${f}`).join('\n');
    const more = fields.length > 4 ? `\n  …and ${fields.length - 4} more` : '';
    const probe =
      candidate !== undefined
        ? `\n\nCandidate shape (where the required fields actually are):\n${this.probePdfCandidateShape(candidate)}`
        : '';
    return `PdfDocument schema validation failed (${fields.length} issue${fields.length === 1 ? '' : 's'}):\n${preview}${more}${probe}`;
  }

  unwrapPlanCandidate(candidate: unknown): unknown {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return candidate;
    }
    const record = candidate as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length !== 1) return candidate;
    const key = keys[0];
    if (!(PLAN_WRAPPER_KEYS as readonly string[]).includes(key)) return candidate;
    const inner = record[key];
    return inner && typeof inner === 'object' && !Array.isArray(inner) ? inner : candidate;
  }

  private expandCandidateForms(candidate: unknown): unknown[] {
    const forms: unknown[] = [];
    const seen = new Set<object>();

    const push = (value: unknown): void => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (seen.has(value)) return;
        seen.add(value);
      }
      forms.push(value);
    };

    push(candidate);

    const collectObjects = (value: unknown, depth: number): void => {
      if (depth > 5) return;
      if (!Array.isArray(value)) return;
      for (const item of value) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          push(item);
          const unwrapped = this.unwrapPlanCandidate(item);
          if (unwrapped !== item) {
            push(unwrapped);
            if (Array.isArray(unwrapped)) {
              collectObjects(unwrapped, depth + 1);
            }
          }
        } else if (Array.isArray(item)) {
          collectObjects(item, depth + 1);
        }
      }
    };

    collectObjects(candidate, 0);

    const unwrapped = this.unwrapPlanCandidate(candidate);
    if (unwrapped !== candidate) {
      push(unwrapped);
      if (Array.isArray(unwrapped)) {
        collectObjects(unwrapped, 0);
      }
    } else if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      const keys = Object.keys(candidate as Record<string, unknown>);
      if (keys.length === 1) {
        const inner = (candidate as Record<string, unknown>)[keys[0]];
        if (inner && typeof inner === 'object') {
          push(inner);
          if (Array.isArray(inner)) {
            collectObjects(inner, 0);
          }
        }
      }
    }

    return forms;
  }

  validateScaffold(candidate: unknown): StageValidationResult<'scaffold', Scaffold> {
    const candidates = this.expandCandidateForms(candidate);
    let lastFailure: StageValidationFailure | null = null;
    for (const form of candidates) {
      const result = ScaffoldSchema.safeParse(form);
      if (result.success) {
        return { success: true, kind: 'scaffold', data: result.data };
      }
      const fields = this.flattenErrorPaths(result.error);
      lastFailure = {
        success: false as const,
        fields,
        message: 'Scaffold validation failed.',
      };
    }
    return (
      lastFailure ?? {
        success: false as const,
        fields: ['(root): Invalid input'],
        message: 'Scaffold validation failed.',
      }
    );
  }

  validateLayerChunk(candidate: unknown): StageValidationResult<'layers', ArchitectureLayer[]> {
    const forms = this.expandCandidateForms(candidate);
    let lastFailure: StageValidationFailure | null = null;
    for (const form of forms) {
      const result = LayerChunkSchema.safeParse(form);
      if (result.success) {
        const layers = Array.isArray(result.data) ? result.data : [result.data];
        return { success: true, kind: 'layers', data: layers };
      }
      const fields = this.flattenErrorPaths(result.error);
      lastFailure = {
        success: false as const,
        fields,
        message: 'Layer chunk validation failed.',
      };
    }
    return (
      lastFailure ?? {
        success: false as const,
        fields: ['(root): Invalid input'],
        message: 'Layer chunk validation failed.',
      }
    );
  }

  validateDomainChunk(candidate: unknown): StageValidationResult<'domains', Domain[]> {
    const forms = this.expandCandidateForms(candidate);
    let lastFailure: StageValidationFailure | null = null;
    for (const form of forms) {
      const result = DomainChunkSchema.safeParse(form);
      if (result.success) {
        const domains = Array.isArray(result.data) ? result.data : [result.data];
        return { success: true, kind: 'domains', data: domains };
      }
      const fields = this.flattenErrorPaths(result.error);
      lastFailure = {
        success: false as const,
        fields,
        message: 'Domain chunk validation failed.',
      };
    }
    return (
      lastFailure ?? {
        success: false as const,
        fields: ['(root): Invalid input'],
        message: 'Domain chunk validation failed.',
      }
    );
  }

  validateLayerChunkForIds(
    candidate: unknown,
    allowedIds: readonly string[],
  ): StageValidationResult<'layers', ArchitectureLayer[]> {
    const allowed = new Set(allowedIds.map(sanitiseId));
    const base = this.validateLayerChunk(candidate);
    if (!base.success) {
      return base;
    }
    if (base.data.length === 0) {
      return {
        success: false as const,
        fields: ['layers'],
        message: 'Layer chunk returned zero layers; expected at least one matching id.',
      };
    }
    const drifted: string[] = [];
    for (const layer of base.data) {
      if (!allowed.has(sanitiseId(layer.id))) {
        drifted.push(layer.id);
      }
    }
    if (drifted.length > 0) {
      return {
        success: false as const,
        fields: drifted.map((id) => `layers[?].id`),
        message: `Layer id ${drifted
          .map((id) => `"${id}"`)
          .join(', ')} was not requested; expected one of ${[...allowed]
          .map((id) => `"${id}"`)
          .join(', ')}.`,
      };
    }
    return base;
  }

  validateDomainChunkForIds(
    candidate: unknown,
    allowedIds: readonly string[],
  ): StageValidationResult<'domains', Domain[]> {
    const allowed = new Set(allowedIds.map(sanitiseId));
    const base = this.validateDomainChunk(candidate);
    if (!base.success) {
      return base;
    }
    if (base.data.length === 0) {
      return {
        success: false as const,
        fields: ['domains'],
        message: 'Domain chunk returned zero domains; expected at least one matching id.',
      };
    }
    const drifted: string[] = [];
    for (const domain of base.data) {
      if (!allowed.has(sanitiseId(domain.id))) {
        drifted.push(domain.id);
      }
    }
    if (drifted.length > 0) {
      return {
        success: false as const,
        fields: drifted.map((id) => `domains[?].id`),
        message: `Domain id ${drifted
          .map((id) => `"${id}"`)
          .join(', ')} was not requested; expected one of ${[...allowed]
          .map((id) => `"${id}"`)
          .join(', ')}.`,
      };
    }
    return base;
  }

  validateTail(candidate: unknown): StageValidationResult<'tail', Tail> {
    const forms = this.expandCandidateForms(candidate);
    let lastFailure: StageValidationFailure | null = null;
    for (const form of forms) {
      const result = TailSchema.safeParse(form);
      if (result.success) {
        return { success: true, kind: 'tail', data: result.data };
      }
      const fields = this.flattenErrorPaths(result.error);
      lastFailure = {
        success: false as const,
        fields,
        message: 'Tail validation failed.',
      };
    }
    return (
      lastFailure ?? {
        success: false as const,
        fields: ['(root): Invalid input'],
        message: 'Tail validation failed.',
      }
    );
  }

  validateBoundedContexts(candidate: unknown): { success: true; kind: 'boundedContexts'; data: BoundedContext[] } | StageValidationFailure {
    const forms = this.expandCandidateForms(candidate);
    let lastFailure: StageValidationFailure | null = null;
    for (const form of forms) {
      const result = BoundedContextChunkSchema.safeParse(form);
      if (result.success) {
        const contexts = Array.isArray(result.data) ? result.data : [result.data];
        return { success: true, kind: 'boundedContexts', data: contexts };
      }
      const fields = this.flattenErrorPaths(result.error);
      lastFailure = {
        success: false as const,
        fields,
        message: 'Bounded contexts validation failed.',
      };
    }
    return (
      lastFailure ?? {
        success: false as const,
        fields: ['(root): Invalid input'],
        message: 'Bounded contexts validation failed.',
      }
    );
  }

  mergeScaffold(stages: {
    scaffold: Scaffold;
    layers: unknown[];
    domains: unknown[];
    tail: Tail;
  }): MergeScaffoldResult {
    const { scaffold, layers, domains, tail } = stages;
    const validatedLayers: ArchitectureLayer[] = layers.flatMap((layer) => {
      const r = LayerChunkSchema.safeParse(this.unwrapPlanCandidate(layer));
      if (!r.success) {
        return [];
      }
      return Array.isArray(r.data) ? r.data : [r.data];
    });
    if (validatedLayers.length === 0 && layers.length > 0) {
      const firstError = layers
        .map((layer) => LayerChunkSchema.safeParse(this.unwrapPlanCandidate(layer)))
        .find((r) => !r.success);
      const paths = firstError && !firstError.success
        ? this.flattenErrorPaths(firstError.error).join(', ')
        : 'unknown';
      return {
        success: false,
        error: `Layer chunk did not match ArchitectureLayer schema: ${paths}`,
        field: 'layers',
      };
    }

    const validatedDomains: Domain[] = domains.flatMap((domain) => {
      const r = DomainChunkSchema.safeParse(this.unwrapPlanCandidate(domain));
      if (!r.success) {
        return [];
      }
      return Array.isArray(r.data) ? r.data : [r.data];
    });
    if (validatedDomains.length === 0 && domains.length > 0) {
      const firstError = domains
        .map((domain) => DomainChunkSchema.safeParse(this.unwrapPlanCandidate(domain)))
        .find((r) => !r.success);
      const paths = firstError && !firstError.success
        ? this.flattenErrorPaths(firstError.error).join(', ')
        : 'unknown';
      return {
        success: false,
        error: `Domain chunk did not match Domain schema: ${paths}`,
        field: 'domains',
      };
    }









    const normalisedWorkflows = (tail.workflows ?? []).map((w) => ({
      ...w,
      steps: Array.isArray((w as { steps?: unknown }).steps) ? (w as { steps: unknown[] }).steps : [],
      domainIds: Array.isArray((w as { domainIds?: unknown }).domainIds)
        ? (w as { domainIds: unknown[] }).domainIds
        : [],
    }));

    const systemOverviewFields = sanitiseAndCount({
      boundedContextMap: scaffold.systemOverview.boundedContextMap,
      contextDiagram: scaffold.systemOverview.c4.contextDiagram,
      containerDiagram: scaffold.systemOverview.c4.containerDiagram,
    });

    const candidate = {
      meta: scaffold.meta,
      systemOverview: {
        ...scaffold.systemOverview,
        boundedContextMap: systemOverviewFields.sanitised['boundedContextMap'],
        c4: {
          contextDiagram: systemOverviewFields.sanitised['contextDiagram'] as string,
          containerDiagram: systemOverviewFields.sanitised['containerDiagram'] as string,
        },
      },
      boundedContexts: scaffold.boundedContexts,
      architectureLayers: validatedLayers,
      domains: validatedDomains,
      userStories: tail.userStories ?? [],
      functionalRequirements: tail.functionalRequirements ?? [],
      successCriteria: tail.successCriteria ?? [],
      constitution: tail.constitution,
      workflows: normalisedWorkflows,
      adrs: tail.adrs,
      agentTasks: tail.agentTasks,
    };

    const finalParse = PlanSchema.safeParse(candidate);
    if (!finalParse.success) {
      return {
        success: false,
        error: `Merged plan did not pass final schema: ${this.flattenErrorPaths(finalParse.error).join(', ')}`,
        field: 'final',
      };
    }
    return {
      success: true,
      value: finalParse.data,
      sanitisedCount: systemOverviewFields.count,
    };
  }

  boundedContextProject(scaffold: Scaffold): Array<Pick<BoundedContext, 'id' | 'name'>> {
    return scaffold.boundedContexts.map((bc) => ({ id: bc.id, name: bc.name }));
  }

  mergeRegeneratedSectioned(
    base: Plan,
    partial: {
      architectureLayers?: unknown[];
      domains?: unknown[];
      boundedContexts?: unknown[];
      workflows?: unknown[];
      adrs?: unknown[];
      agentTasks?: unknown[];
      userStories?: unknown[];
      functionalRequirements?: unknown[];
      successCriteria?: unknown[];
      constitution?: unknown;
      additionalLayers?: unknown[];
      additionalDomains?: unknown[];
      additionalBoundedContexts?: unknown[];
    },
    options: { removedBoundedContextIds?: ReadonlySet<string> } = {},
  ): { ok: true; plan: Plan; sanitisedCount: number } | { ok: false; reason: string } {
    const validatedLayers = (partial.architectureLayers ?? []).flatMap((value) => {
      const r = LayerChunkSchema.safeParse(this.unwrapPlanCandidate(value));
      if (!r.success) return [];
      return Array.isArray(r.data) ? r.data : [r.data];
    });
    const validatedDomains = (partial.domains ?? []).flatMap((value) => {
      const r = DomainChunkSchema.safeParse(this.unwrapPlanCandidate(value));
      if (!r.success) return [];
      return Array.isArray(r.data) ? r.data : [r.data];
    });
    const validatedAdditionalLayers = this.flattenAdditionsChunks(
      partial.additionalLayers,
      LayerChunkSchema,
    );
    const validatedAdditionalDomains = this.flattenAdditionsChunks(
      partial.additionalDomains,
      DomainChunkSchema,
    );
    const baseById = new Map<string, ArchitectureLayer>();
    for (const layer of base.architectureLayers) baseById.set(layer.id, layer);
    const existingLayerIds = new Set<string>();
    for (const layer of base.architectureLayers) existingLayerIds.add(sanitiseId(layer.id));
    for (const layer of validatedLayers) existingLayerIds.add(sanitiseId(layer.id));
    const newLayerEntries: ArchitectureLayer[] = [];
    const seenLayerIds = new Set<string>();
    for (const layer of validatedAdditionalLayers) {
      const norm = sanitiseId(layer.id);
      if (existingLayerIds.has(norm) || seenLayerIds.has(norm)) continue;
      seenLayerIds.add(norm);
      existingLayerIds.add(norm);
      newLayerEntries.push(layer as ArchitectureLayer);
    }
    const rebuiltLayers: ArchitectureLayer[] =
      validatedLayers.length > 0
        ? validatedLayers.map((layer) =>
            baseById.get(layer.id)
              ? ({ ...baseById.get(layer.id), ...layer, id: layer.id } as ArchitectureLayer)
              : (layer as ArchitectureLayer),
          )
        : base.architectureLayers;
    const mergedLayers: ArchitectureLayer[] = newLayerEntries.length > 0
      ? [...rebuiltLayers, ...newLayerEntries]
      : rebuiltLayers;
    const baseDomainById = new Map<string, Domain>();
    for (const domain of base.domains) baseDomainById.set(domain.id, domain);
    const existingDomainIds = new Set<string>();
    for (const domain of base.domains) existingDomainIds.add(sanitiseId(domain.id));
    for (const domain of validatedDomains) existingDomainIds.add(sanitiseId(domain.id));
    const newDomainEntries: Domain[] = [];
    const seenDomainIds = new Set<string>();
    for (const domain of validatedAdditionalDomains) {
      const norm = sanitiseId(domain.id);
      if (existingDomainIds.has(norm) || seenDomainIds.has(norm)) continue;
      seenDomainIds.add(norm);
      existingDomainIds.add(norm);
      newDomainEntries.push(domain as Domain);
    }
    const rebuiltDomains: Domain[] =
      validatedDomains.length > 0
        ? validatedDomains.map((domain) =>
            baseDomainById.get(domain.id)
              ? ({ ...baseDomainById.get(domain.id), ...domain, id: domain.id } as Domain)
              : (domain as Domain),
          )
        : base.domains;
    const mergedDomains: Domain[] = newDomainEntries.length > 0
      ? [...rebuiltDomains, ...newDomainEntries]
      : rebuiltDomains;
    let mergedBoundedContexts: BoundedContext[] = base.boundedContexts;
    if (partial.boundedContexts !== undefined) {
      const validatedBoundedContexts = partial.boundedContexts.flatMap((value) => {
        const r = BoundedContextChunkSchema.safeParse(this.unwrapPlanCandidate(value));
        if (!r.success) return [];
        return Array.isArray(r.data) ? r.data : [r.data];
      });
      const baseBcById = new Map<string, BoundedContext>();
      for (const bc of base.boundedContexts) baseBcById.set(bc.id, bc);
      const newBcIds = new Set<string>();
      const deduped: BoundedContext[] = [];
      for (const bc of validatedBoundedContexts) {
        if (newBcIds.has(bc.id)) continue;
        newBcIds.add(bc.id);
        const existing = baseBcById.get(bc.id);
        deduped.push(
          existing
            ? ({ ...existing, ...bc, id: bc.id } as BoundedContext)
            : (bc as BoundedContext),
        );
      }
      const preservedFromBase = base.boundedContexts.filter(
        (bc) => !newBcIds.has(bc.id) && !options.removedBoundedContextIds?.has(bc.id),
      );
      mergedBoundedContexts =
        deduped.length > 0 || preservedFromBase.length > 0
          ? [...deduped, ...preservedFromBase]
          : base.boundedContexts;
    }
    if (partial.additionalBoundedContexts !== undefined) {
      const validatedAdditionalBoundedContexts = this.flattenAdditionsChunks(
        partial.additionalBoundedContexts,
        BoundedContextChunkSchema,
      );
      if (validatedAdditionalBoundedContexts.length > 0) {
        const existingBcIds = new Set<string>();
        for (const bc of mergedBoundedContexts) existingBcIds.add(sanitiseId(bc.id));
        const newBcEntries: BoundedContext[] = [];
        const seenBcIds = new Set<string>();
        for (const bc of validatedAdditionalBoundedContexts) {
          const norm = sanitiseId(bc.id);
          if (existingBcIds.has(norm) || seenBcIds.has(norm)) continue;
          if (options.removedBoundedContextIds?.has(bc.id)) continue;
          seenBcIds.add(norm);
          existingBcIds.add(norm);
          newBcEntries.push(bc as BoundedContext);
        }
        if (newBcEntries.length > 0) {
          mergedBoundedContexts = [...mergedBoundedContexts, ...newBcEntries];
        }
      }
    }
    const normalisedWorkflows: Plan['workflows'] = partial.workflows
      ? (partial.workflows as unknown as Plan['workflows']).map((w) => ({
          ...w,
          steps: Array.isArray((w as { steps?: unknown }).steps) ? (w as { steps: string[] }).steps : [],
          domainIds: Array.isArray((w as { domainIds?: unknown }).domainIds)
            ? (w as { domainIds: string[] }).domainIds
            : [],
        }))
      : base.workflows;
    const normalisedAdrs: Plan['adrs'] = partial.adrs
      ? (partial.adrs as unknown as Plan['adrs']).map((a) => ({
          ...a,
          consequences: Array.isArray((a as { consequences?: unknown }).consequences)
            ? (a as { consequences: string[] }).consequences
            : [],
        }))
      : base.adrs;
    const systemOverviewFields = sanitiseAndCount({
      boundedContextMap: base.systemOverview.boundedContextMap,
      contextDiagram: base.systemOverview.c4.contextDiagram,
      containerDiagram: base.systemOverview.c4.containerDiagram,
    });

    const candidate: Plan = {
      ...base,
      systemOverview: {
        ...base.systemOverview,
        boundedContextMap: systemOverviewFields.sanitised['boundedContextMap'],
        c4: {
          contextDiagram: systemOverviewFields.sanitised['contextDiagram'] as string,
          containerDiagram: systemOverviewFields.sanitised['containerDiagram'] as string,
        },
      },
      boundedContexts: mergedBoundedContexts,
      architectureLayers: mergedLayers,
      domains: mergedDomains,
      userStories: partial.userStories ? (partial.userStories as Plan['userStories']) : base.userStories,
      functionalRequirements: partial.functionalRequirements
        ? (partial.functionalRequirements as Plan['functionalRequirements'])
        : base.functionalRequirements,
      successCriteria: partial.successCriteria
        ? (partial.successCriteria as Plan['successCriteria'])
        : base.successCriteria,
      constitution: partial.constitution
        ? ((ConstitutionSchema.safeParse(partial.constitution).success
            ? (partial.constitution as Plan['constitution'])
            : base.constitution) ?? base.constitution)
        : base.constitution,
      workflows: normalisedWorkflows,
      adrs: normalisedAdrs,
      agentTasks: partial.agentTasks ? (partial.agentTasks as Plan['agentTasks']) : base.agentTasks,
    };
    const result = PlanSchema.safeParse(candidate);
    if (!result.success) {
      return {
        ok: false,
        reason: `Merged regenerated plan failed validation: ${this.flattenErrorPaths(result.error).join(', ')}`,
      };
    }
    return {
      ok: true,
      plan: result.data,
      sanitisedCount: systemOverviewFields.count,
    };
  }

  reconcileStructuralChanges(
    merged: Plan,
    editSummary: UserEditSummary,
  ): { plan: Plan; adjustments: number } {
    let workingPlan = merged;
    let adjustments = 0;

    const arraysByKind: Record<ElementKind, keyof Plan> = {
      architectureLayer: 'architectureLayers',
      domain: 'domains',
      boundedContext: 'boundedContexts',
      adr: 'adrs',
      workflow: 'workflows',
      agentTask: 'agentTasks',
    };

    for (const removed of editSummary.removedElements) {
      const fieldKey = arraysByKind[removed.kind];
      const list = workingPlan[fieldKey] as unknown as Array<{ id: string }>;
      if (!Array.isArray(list)) continue;
      const filtered = list.filter((entry) => entry && entry.id !== removed.id);
      if (filtered.length !== list.length) {
        adjustments += list.length - filtered.length;
        workingPlan = { ...workingPlan, [fieldKey]: filtered } as Plan;
      }
    }

    for (const added of editSummary.addedElements) {
      const fieldKey = arraysByKind[added.kind];
      const list = workingPlan[fieldKey] as unknown as Array<{ id: string }>;
      if (!Array.isArray(list)) continue;
      if (list.some((entry) => entry && entry.id === added.id)) continue;
      const injectionResult = this.tryInjectElement(added.kind, list, added.element);
      if (injectionResult) {
        adjustments += 1;
        workingPlan = { ...workingPlan, [fieldKey]: injectionResult } as Plan;
      }
    }

    return { plan: workingPlan, adjustments };
  }

  flattenAdditionsChunks<T extends { id: string }>(
    chunks: unknown[] | undefined,
    schema: z.ZodTypeAny,
  ): T[] {
    if (!chunks || chunks.length === 0) return [];
    const out: T[] = [];
    for (const chunk of chunks) {
      const unwrapped = this.unwrapPlanCandidate(chunk);
      const candidate = this.normaliseAdditionsChunk(unwrapped);
      const r = schema.safeParse(candidate);
      if (!r.success) continue;
      const items = Array.isArray(r.data) ? r.data : [r.data];
      for (const item of items) {
        if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string') {
          out.push(item as T);
        }
      }
    }
    return out;
  }

  private normaliseAdditionsChunk(raw: unknown): unknown {
    if (!raw || typeof raw !== 'object') return raw;
    const out: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
    const deriveId = (name: unknown, fallback?: string): string | undefined => {
      if (typeof name === 'string' && name.trim()) {
        return name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');
      }
      return fallback;
    };
    const ensureArray = (v: unknown, def: unknown[] = []): unknown[] => (Array.isArray(v) ? v : def);
    if (Array.isArray(out['aggregates'])) {
      out['aggregates'] = (out['aggregates'] as unknown[]).map((agg) => {
        if (!agg || typeof agg !== 'object') return agg;
        const a = agg as Record<string, unknown>;
        const next: Record<string, unknown> = { ...a };
        if (typeof next['id'] !== 'string' || !next['id']) {
          next['id'] =
            deriveId(next['name'], 'aggregate-' + Math.random().toString(36).slice(2, 8)) ?? 'aggregate';
        }
        if (typeof next['description'] !== 'string' || !next['description']) {
          const n = typeof next['name'] === 'string' ? next['name'] : 'aggregate';
          next['description'] = `Aggregate root that manages the ${n} consistency boundary.`;
        }
        if (typeof next['rootEntity'] !== 'string' || !next['rootEntity']) {
          next['rootEntity'] = typeof next['name'] === 'string' ? next['name'] : 'Entity';
        }
        next['valueObjects'] = ensureArray(next['valueObjects'], ['ValueObject']);
        next['commands'] = ensureArray(next['commands'], ['Handle']);
        next['domainEvents'] = ensureArray(next['domainEvents'], ['EventRaised']);
        next['invariants'] = ensureArray(next['invariants'], ['Invariant']);
        return next;
      });
    }
    if (Array.isArray(out['components'])) {
      out['components'] = (out['components'] as unknown[]).map((comp) => {
        if (!comp || typeof comp !== 'object') return comp;
        const c = comp as Record<string, unknown>;
        const next: Record<string, unknown> = { ...c };
        if (typeof next['id'] !== 'string' || !next['id']) {
          next['id'] =
            deriveId(next['name'], 'component-' + Math.random().toString(36).slice(2, 8)) ??
            'component';
        }
        next['responsibilities'] = ensureArray(next['responsibilities'], ['Implement behaviour']);
        next['inputs'] = ensureArray(next['inputs'], ['input: void']);
        next['outputs'] = ensureArray(next['outputs'], ['output: void']);
        next['publicApi'] = ensureArray(next['publicApi'], ['invoke()']);
        next['errorHandling'] = typeof next['errorHandling'] === 'string' && next['errorHandling']
          ? next['errorHandling']
          : 'Throws a typed domain error on failure.';
        next['acceptanceCriteria'] = ensureArray(next['acceptanceCriteria'], ['Acceptance criterion']);
        next['outOfScope'] = ensureArray(next['outOfScope'], ['Nothing out of scope.']);
        if (!next['tddSpec'] || typeof next['tddSpec'] !== 'object') {
          next['tddSpec'] = {
            unitTests: [
              {
                description: 'returns the expected output',
                given: ['valid input'],
                when: 'invoke is called',
                then: ['returns expected result'],
              },
              {
                description: 'rejects invalid input',
                given: ['invalid input'],
                when: 'invoke is called',
                then: ['throws a typed error'],
              },
            ],
            integrationTests: [
              {
                description: 'integrates with dependencies',
                given: ['real dependencies'],
                when: 'invoke is called',
                then: ['returns integrated result'],
              },
            ],
          };
        }
        if (typeof next['targetFile'] !== 'string' || !next['targetFile']) {
          const idStr = String(next['id']);
          next['targetFile'] = `src/app/${idStr}/${idStr.replace(/-/g, '_')}.ts`;
        }
        return next;
      });
    }
    if (Array.isArray(out['domainEvents'])) {
      out['domainEvents'] = (out['domainEvents'] as unknown[]).map((evt) => {
        if (!evt || typeof evt !== 'object') return evt;
        const e = evt as Record<string, unknown>;
        if (typeof e['id'] !== 'string' || !e['id']) {
          e['id'] = deriveId(e['name'], 'event-' + Math.random().toString(36).slice(2, 8)) ?? 'event';
        }
        return e;
      });
    }
    return out;
  }

  private tryInjectElement(
    kind: ElementKind,
    list: unknown[],
    element: unknown,
  ): unknown[] | null {
    if (!element || typeof element !== 'object') return null;
    const candidate = [...list, element];
    if (kind === 'architectureLayer') {
      const r = LayerChunkSchema.safeParse(this.unwrapPlanCandidate(candidate));
      if (!r.success) return null;
      return Array.isArray(r.data) ? r.data : [r.data];
    }
    if (kind === 'domain') {
      const r = DomainChunkSchema.safeParse(this.unwrapPlanCandidate(candidate));
      if (!r.success) return null;
      return Array.isArray(r.data) ? r.data : [r.data];
    }
    if (kind === 'boundedContext') {
      const r = BoundedContextChunkSchema.safeParse(this.unwrapPlanCandidate(candidate));
      if (!r.success) return null;
      return Array.isArray(r.data) ? r.data : [r.data];
    }
    return candidate;
  }

  buildLayerStub(layerId: string): ArchitectureLayer {
    const name = this.toTitleCase(layerId);
    const safeId = sanitiseId(layerId);
    return {
      id: safeId,
      name,
      description:
        `Auto-generated placeholder for the '${safeId}' architecture layer. ` +
        `The planner was unable to produce detailed content for this layer ` +
        `within its retry budget (likely because the LLM output was truncated, ` +
        `returned invalid JSON, or failed schema validation). ` +
        `Replace this stub with concrete layer content before shipping the plan.`,
      techStack: ['TBD — populate after detailed layer design'],
      patterns: ['TBD — populate after detailed layer design'],
      mermaidDiagram: `graph TD\n  ${this.safeMermaidId(safeId)}["${name} layer placeholder"]`,
      summary:
        `Placeholder summary for the '${safeId}' layer. Replace with the ` +
        `layer's primary responsibility and technical approach.`,
      directoryStructure: [
        {
          path: `${safeId}/`,
          description: `Placeholder directory for the '${safeId}' architecture layer.`,
          agentInstructions: [
            `Replace this placeholder with concrete module structure for the '${safeId}' layer.`,
            `Document the public interface of the '${safeId}' layer modules in the project README.`,
            `Ensure the '${safeId}' layer passes the architecture lint before merge.`,
          ],
        },
      ],
    };
  }

  buildDomainStub(domainId: string, layerId: string): Domain {
    const name = this.toTitleCase(domainId);
    const safeId = sanitiseId(domainId);
    const safeLayer = sanitiseId(layerId);
    return {
      id: safeId,
      name,
      description:
        `Auto-generated placeholder for the '${safeId}' domain. ` +
        `The planner was unable to produce detailed content for this domain ` +
        `within its retry budget. Replace this stub with concrete domain ` +
        `aggregates, events, and components before shipping the plan.`,
      layer: safeLayer,
      responsibilities: [`TBD — populate the responsibilities of the '${safeId}' domain.`],
      aggregates: [],
      domainEvents: [],
      directoryPath: `${safeLayer}/${safeId}/`,
      components: [
        {
          id: `${safeId}-placeholder`,
          name: `${name} Placeholder`,
          description: `Placeholder component for the '${safeId}' domain.`,
          type: 'service',
          layer: 'application',
          responsibilities: [
            `Implement the placeholder behaviour for the '${safeId}' domain.`,
          ],
          inputs: [`placeholderInput: TBD`],
          outputs: [`placeholderOutput: TBD`],
          dependencies: [],
          publicApi: [`placeholder(input: TBD): TBD`],
          errorHandling:
            'Propagate errors via the standard planner error surface (ProjectStore.setError).',
          acceptanceCriteria: [
            `Replaces this placeholder component with a real implementation.`,
            `Satisfies the TDD coverage targets listed in this plan.`,
          ],
          tddSpec: {
            unitTests: [
              {
                description: `Placeholder unit test: '${safeId}' returns successfully.`,
                given: [`a placeholder input`],
                when: `the '${safeId}' placeholder is invoked`,
                then: [`the placeholder returns successfully`],
              },
              {
                description: `Placeholder unit test: '${safeId}' handles invalid input.`,
                given: [`an invalid placeholder input`],
                when: `the '${safeId}' placeholder is invoked`,
                then: [`the placeholder surfaces an actionable error`],
              },
            ],
            integrationTests: [
              {
                description: `Placeholder integration test: '${safeId}' end-to-end.`,
                given: [`a placeholder input`],
                when: `the '${safeId}' placeholder is invoked end-to-end`,
                then: [`the placeholder completes without throwing`],
              },
            ],
          },
          targetFile: `${safeLayer}/${safeId}/${safeId}.service.ts`,
          outOfScope: [`Replace this placeholder component with a real implementation.`],
        },
      ],
    };
  }

  validateMergedPlan(plan: Plan): AuditFinding[] {
    return new AuditRunner().run(plan);
  }

  replacePlanField(
    plan: Plan,
    path: string,
    replacement: unknown,
  ):
    | { ok: true; plan: Plan; sanitisedCount: number }
    | { ok: false; reason: 'unknown_path' | 'invalid_replacement' } {
    if (path === 'meta') {
      if (!replacement || typeof replacement !== 'object' || Array.isArray(replacement)) {
        return { ok: false, reason: 'invalid_replacement' };
      }
      const metaResult = PlanSchema.shape.meta.safeParse(replacement);
      if (!metaResult.success) return { ok: false, reason: 'invalid_replacement' };
      return { ok: true, plan: { ...plan, meta: metaResult.data }, sanitisedCount: 0 };
    }

    if (path === 'systemOverview') {
      if (!replacement || typeof replacement !== 'object' || Array.isArray(replacement)) {
        return { ok: false, reason: 'invalid_replacement' };
      }
      const sysResult = PlanSchema.shape.systemOverview.safeParse(replacement);
      if (!sysResult.success) return { ok: false, reason: 'invalid_replacement' };
      return { ok: true, plan: { ...plan, systemOverview: sysResult.data }, sanitisedCount: 0 };
    }

    if (path === 'systemOverview.boundedContextMap') {
      if (typeof replacement !== 'string' || replacement.length === 0) {
        return { ok: false, reason: 'invalid_replacement' };
      }
      const { value, changed } = sanitiseMermaidString(replacement);
      return {
        ok: true,
        plan: {
          ...plan,
          systemOverview: { ...plan.systemOverview, boundedContextMap: value },
        },
        sanitisedCount: changed ? 1 : 0,
      };
    }

    if (path === 'systemOverview.c4.contextDiagram') {
      if (typeof replacement !== 'string' || replacement.length === 0) {
        return { ok: false, reason: 'invalid_replacement' };
      }
      const { value, changed } = sanitiseMermaidString(replacement);
      return {
        ok: true,
        plan: {
          ...plan,
          systemOverview: {
            ...plan.systemOverview,
            c4: { ...plan.systemOverview.c4, contextDiagram: value },
          },
        },
        sanitisedCount: changed ? 1 : 0,
      };
    }

    if (path === 'systemOverview.c4.containerDiagram') {
      if (typeof replacement !== 'string' || replacement.length === 0) {
        return { ok: false, reason: 'invalid_replacement' };
      }
      const { value, changed } = sanitiseMermaidString(replacement);
      return {
        ok: true,
        plan: {
          ...plan,
          systemOverview: {
            ...plan.systemOverview,
            c4: { ...plan.systemOverview.c4, containerDiagram: value },
          },
        },
        sanitisedCount: changed ? 1 : 0,
      };
    }

    const arrayMatch = /^(\w+)\[([^\]]+)\]\.(.+)$/.exec(path);
    if (arrayMatch) {
      const [, arrayName, rawId, field] = arrayMatch;
      if (!isPlanTopLevelArray(arrayName)) return { ok: false, reason: 'unknown_path' };
      const id = rawId;
      const list = (plan as unknown as Record<string, unknown[]>)[arrayName];
      if (!Array.isArray(list)) return { ok: false, reason: 'unknown_path' };
      const idx = list.findIndex((entry) => {
        return (
          entry &&
          typeof entry === 'object' &&
          (entry as { id?: string }).id === id
        );
      });
      if (idx === -1) return { ok: false, reason: 'unknown_path' };
      const updated = { ...(list[idx] as Record<string, unknown>), [field]: replacement };
      const elementSchema = arrayElementSchemaFor(arrayName);
      if (elementSchema) {
        const elementResult = elementSchema.safeParse(updated);
        if (!elementResult.success) return { ok: false, reason: 'invalid_replacement' };
      }
      const nextList = list.slice();
      nextList[idx] = updated;
      return {
        ok: true,
        plan: { ...plan, [arrayName]: nextList } as Plan,
        sanitisedCount: 0,
      };
    }

    if (path === 'boundedContexts' || path === 'workflows' || path === 'adrs' || path === 'agentTasks') {
      const schema = arraySchemaFor(path);
      if (!schema) return { ok: false, reason: 'unknown_path' };
      const arrResult = schema.safeParse(replacement);
      if (!arrResult.success) return { ok: false, reason: 'invalid_replacement' };
      return { ok: true, plan: { ...plan, [path]: arrResult.data } as Plan, sanitisedCount: 0 };
    }

    return { ok: false, reason: 'unknown_path' };
  }

  toJsonSchema(): object {
    return this.jsonSchema;
  }

  toPdfDocumentJsonSchema(): object {
    return this.pdfJsonSchema;
  }

  private toTitleCase(id: string): string {
    return id
      .split('-')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ') || id;
  }

  private safeMermaidId(id: string): string {
    return id.replace(/[^a-zA-Z0-9]/g, '_') || 'placeholder';
  }

  private composeMessage(fields: string[], raw?: string): string {
    const everyRequiredMissing = REQUIRED_PLAN_KEYS.every((key) =>
      fields.some((field) => field.startsWith(`${key}:`)),
    );
    if (!everyRequiredMissing) {
      return 'Plan schema validation failed.';
    }
    const snippet = this.buildRawSnippet(raw);
    const escapedSnippet = snippet.replace(/\r?\n/g, '\\n');
    return (
      'The model returned a JSON object, but none of the required plan keys were present. ' +
      'The LLM likely wrapped the plan in another object (for example {"plan": {...}}); ' +
      'the parser tried to unwrap known wrapper keys but the payload did not match the schema. ' +
      `Raw output begins with: ${escapedSnippet}`
    );
  }

  private buildRawSnippet(raw: string | undefined): string {
    if (!raw) return '';
    const trimmed = raw.trim();
    if (trimmed.length <= RAW_SNIPPET_LIMIT) {
      return trimmed;
    }
    return `${trimmed.slice(0, RAW_SNIPPET_LIMIT)}...`;
  }

  private flattenErrorPaths(error: ZodError): string[] {
    return error.issues.map((issue) => {
      const path = issue.path.join('.') || '(root)';
      return `${path}: ${issue.message}`;
    });
  }
}

const PLAN_TOP_LEVEL_ARRAYS = new Set(['boundedContexts', 'workflows', 'adrs', 'agentTasks']);

function isPlanTopLevelArray(name: string): boolean {
  return PLAN_TOP_LEVEL_ARRAYS.has(name);
}

function arraySchemaFor(name: string): z.ZodType<unknown[]> | null {
  switch (name) {
    case 'boundedContexts':
      return PlanSchema.shape.boundedContexts as unknown as z.ZodType<unknown[]>;
    case 'workflows':
      return PlanSchema.shape.workflows as unknown as z.ZodType<unknown[]>;
    case 'adrs':
      return PlanSchema.shape.adrs as unknown as z.ZodType<unknown[]>;
    case 'agentTasks':
      return PlanSchema.shape.agentTasks as unknown as z.ZodType<unknown[]>;
    default:
      return null;
  }
}

function arrayElementSchemaFor(name: string): z.ZodTypeAny | null {
  const fieldSchema = (PlanSchema.shape as Record<string, z.ZodTypeAny>)[name];
  if (!fieldSchema) return null;
  const inner = unwrapZodDefault(fieldSchema);
  if (!inner) return null;
  const element = (inner as unknown as { element?: z.ZodTypeAny }).element;
  return element ?? null;
}

function unwrapZodDefault(schema: z.ZodTypeAny): z.ZodTypeAny | null {
  const def = (schema as { _def?: { innerType?: z.ZodTypeAny } })._def;
  if (def && def.innerType) return def.innerType;
  return schema;
}
