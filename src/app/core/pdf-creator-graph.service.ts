import { Injectable, inject } from '@angular/core';
import { Plan } from './plan.schema';
import { PdfDocumentRepair, PlanSchemaService } from './plan-schema.service';
import { PlannerError } from './planner-error.model';
import {
  PromptBuilderService,
  resolveSkillsForStage,
} from './prompt-builder.service';
import { PdfDocument } from './pdf-document.schema';
import { parseFirstJsonObjectResult } from './json-output-parser';
import { AgentsStore } from './agents.store';
import { ProjectStore } from './project.store';

export interface PdfCreatorInvokerResult {
  text: string;
  empty: boolean;

  fallbackError?: string;

  chunksSeen?: number;
  finishReason?: string;

  bailout?: { reason: 'wall_clock_cap'; elapsedMs: number; chunksSeen: number };
}

export interface PdfCreatorRunConfig {
  maxRetries?: number;

  llmInvoker: (promptText: string) => Promise<PdfCreatorInvokerResult>;
}

export interface PdfCreatorRunResult {
  document: PdfDocument | null;
  error: PlannerError | null;
  attempts: number;
  repair: PdfDocumentRepair | null;
}

export interface RunOneCallOptions extends PdfCreatorRunConfig {
  renderPrompt: (retrySection: string) => Promise<string>;
  planContext?: { title?: string; summary?: string };
  onAttemptStart?: () => void;
  onAttemptFinish?: () => void;
  /** When true, the call validates the LLM output as a partial PdfDocument
   * (`{sections: [...]}`) instead of a full one. The returned `document` is a
   * synthetic PdfDocument wrapping the parsed sections. */
  acceptPartialDocument?: boolean;
}

@Injectable({ providedIn: 'root' })
export class PdfCreatorGraphService {
  private readonly agents = inject(AgentsStore);
  private readonly projectStore = inject(ProjectStore);

  constructor(
    private readonly promptBuilder: PromptBuilderService,
    private readonly schemaService: PlanSchemaService,
  ) {}

  async generate(plan: Plan, options: PdfCreatorRunConfig): Promise<PdfCreatorRunResult> {
    const schema = this.schemaService.toPdfDocumentJsonSchema();
    const skills = resolveSkillsForStage(this.agents, 'pdf');

    return this.runOneCallInternal({
      renderPrompt: async (retrySection: string) => {
        const retryBody = retrySection.startsWith('RETRY INSTRUCTIONS')
          ? retrySection.replace(/^RETRY INSTRUCTIONS[^\n]*\n/, '')
          : retrySection;
        const prompt = await this.promptBuilder.buildPdfCreatorPrompt(
          plan,
          schema,
          retryBody,
          skills,
        );
        return prompt.format({});
      },
      planContext: { title: plan.meta?.title, summary: plan.meta?.summary },
      ...options,
    });
  }

  async runOneCall(options: RunOneCallOptions): Promise<PdfCreatorRunResult> {
    return this.runOneCallInternal(options);
  }

  private async runOneCallInternal(options: RunOneCallOptions): Promise<PdfCreatorRunResult> {
    const maxRetries = options.maxRetries ?? 2;
    let retryContext = '';
    let attempts = 0;

    const activityId = this.projectStore.startActivity({
      stage: 'pdf',
      agentId: null,
      skillId: null,
      label: null,
      kind: 'pdf',
    });

    try {
      let emptyResponses = 0;
      let lastChunksSeen = 0;
      let lastFinishReason: string | undefined;
      for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
        attempts = attempt;
        const retrySection = retryContext
          ? `RETRY INSTRUCTIONS — fix all issues listed below before returning:\n${retryContext}`
          : '';
        const renderedPrompt = await options.renderPrompt(retrySection);

        let result: PdfCreatorInvokerResult;
        try {
          options.onAttemptStart?.();
          result = await options.llmInvoker(renderedPrompt);
          options.onAttemptFinish?.();
        } catch (error) {
          options.onAttemptFinish?.();
          const message = error instanceof Error ? error.message : String(error);
          if (attempt > maxRetries) {
            return {
              document: null,
              attempts,
              error: { type: 'provider_error', message },
              repair: null,
            };
          }
          retryContext = `LLM call failed: ${message}`;
          continue;
        }

        if (result.bailout) {
          lastFinishReason = result.finishReason ?? lastFinishReason;
          return {
            document: null,
            attempts,
            error: {
              type: 'provider_error',
              message: composeBailoutMessage(result.bailout, result.finishReason),
              raw: result.text.slice(-120).replace(/\s+/g, ' '),
            },
            repair: null,
          };
        }

        if (result.empty) {
          if (result.fallbackError) {
            return {
              document: null,
              attempts,
              error: {
                type: 'provider_error',
                message: result.fallbackError,
              },
              repair: null,
            };
          }
          emptyResponses += 1;
          lastChunksSeen = result.chunksSeen ?? 0;
          lastFinishReason = result.finishReason ?? lastFinishReason;

          if (emptyResponses > 1) {
            return {
              document: null,
              attempts,
              error: {
                type: 'provider_error',
                message: composeEmptyResponseMessage(attempts, {
                  chunksSeen: lastChunksSeen,
                  finishReason: lastFinishReason,
                }),
              },
              repair: null,
            };
          }
          retryContext = this.composeEmptyResponseContext();
          continue;
        }

        if (result.finishReason) {
          lastFinishReason = result.finishReason;
        }

        const raw = result.text;
        const parsed = parseFirstJsonObjectResult(raw);
        if (!parsed.ok) {
          if (
            parsed.kind === 'truncated' &&
            (result.finishReason === 'length' ||
              result.finishReason === 'max_tokens' ||
              result.finishReason === 'model_length' ||
              result.finishReason === 'unknown' ||
              raw.length >= 32_000)
          ) {
            return {
              document: null,
              attempts,
              error: this.buildLengthTruncationFailure(parsed, raw, result.finishReason),
              repair: null,
            };
          }
          if (attempt > maxRetries) {
            return {
              document: null,
              attempts,
              error: this.buildParseFailure(parsed, raw, result.finishReason, result.chunksSeen),
              repair: null,
            };
          }
          retryContext = this.composeRetryContext(parsed, raw);
          continue;
        }

        const validated = options.acceptPartialDocument
          ? this.validatePartialInRun(parsed.value, options.planContext, raw.length, lastFinishReason, attempts)
          : this.schemaService.validatePdfDocumentWithUnwrap(parsed.value, options.planContext);

        const wrongShapeRepair =
          validated.repair &&
          (validated.repair.reason === 'single_section_root' ||
            validated.repair.reason === 'array_section_headings' ||
            validated.repair.reason === 'matrix_shape');
        const repairWithMeta = validated.repair
          ? {
              ...validated.repair,
              rawBytes: raw.length,
              finishReason: lastFinishReason,
              attemptCount: attempts,
            }
          : null;

        if (validated.success) {
          if (!wrongShapeRepair || attempt > maxRetries) {
            return {
              document: validated.document,
              error: null,
              attempts,
              repair: repairWithMeta,
            };
          }
          if (attempt > maxRetries) {
            return {
              document: validated.document,
              error: null,
              attempts,
              repair: repairWithMeta,
            };
          }
          retryContext = this.composeSchemaRetryContext(
            [],
            `LLM emitted ${validated.repair!.reason} instead of a full PdfDocument`,
            validated.repair,
          );
          continue;
        }

        if (attempt > maxRetries) {
          return {
            document: null,
            attempts,
            error: {
              type: 'schema_validation',
              message: validated.message,
              fields: validated.fields,
            },
            repair: repairWithMeta,
          };
        }
        retryContext = this.composeSchemaRetryContext(
          validated.fields,
          validated.message,
          validated.repair,
        );
      }

      return {
        document: null,
        attempts,
        error: {
          type: 'provider_error',
          message: 'PDF creator graph exhausted all retries.',
        },
        repair: null,
      };
    } finally {
      this.projectStore.finishActivity(activityId);
    }
  }

  private composeRetryContext(
    parsed: Extract<ReturnType<typeof parseFirstJsonObjectResult>, { ok: false }>,
    raw: string,
  ): string {
    if (parsed.kind === 'truncated') {
      const prior = raw.length;
      return (
        `Your previous PDF-creator JSON was truncated at ${prior} chars (response ended mid-string). ` +
        'Hard budget: ≤ 24 KB / 24 000 chars of JSON. To shrink: ' +
        '(1) drop optional sections — Workflows (Section 7) and Glossary & Appendix (Section 9) are the first to go; ' +
        '(2) per-domain cap is 3 events; ' +
        '(3) bullets ≤ 5 items, each ≤ 80 chars; ' +
        '(4) paragraph ≤ 180 chars; ' +
        '(5) max 6 sections total. ' +
        '(6) do NOT emit `<think>...</think>` or `<thinking>...</thinking>` reasoning blocks — they waste tokens and the parser cannot recover the JSON if it is truncated mid-write. ' +
        'Start with { on line 1 and close every bracket and string.'
      );
    }
    if (parsed.kind === 'no_start') {
      return (
        'Your previous response contained no JSON object. ' +
        'Return ONLY a single balanced JSON object starting with { on line 1.'
      );
    }
    return (
      `Your previous JSON had a syntax error near position ${parsed.position}. ` +
      'Re-emit a clean JSON object. Rules: ' +
      '(1) Every string value MUST use straight double-quotes around the value; any literal double-quote INSIDE a string MUST be escaped as \\" (e.g. write \\"quoted term\\", not "quoted term"). ' +
      '(2) Do not include any commentary, reasoning, or prose outside the JSON object — the response must START with { on line 1 and END with } as the final character. ' +
      '(3) Do not include backticks or markdown fences. ' +
      '(4) Do NOT emit a preamble: no "let me plan", no section-by-section block counts (e.g. "blocks 8. Architecture Decisions (ADRs): 3 blocks × 3 ADRs + 1 callout = 10 blocks"), no planning summaries, no enumeration of sections or block budgets. Plan silently — your response begins with `{` and ends with `}`. A leading preamble breaks parsing even when the JSON itself is valid. ' +
      'Tail of your previous response for reference: "' +
      raw.slice(-120).replace(/\s+/g, ' ').replace(/"/g, '\\"') +
      '"'
    );
  }

  private composeEmptyResponseContext(): string {
    return (
      'Your previous response was empty — no tokens at all. ' +
      'Confirm the provider is healthy, then return ONLY a single balanced JSON ' +
      'object starting with { on line 1 and ending with } as the final character. ' +
      'Do not emit analysis or commentary first.'
    );
  }


  private composeSchemaRetryContext(
    fields: readonly string[],
    message: string,
    repair?: PdfDocumentRepair,
  ): string {
    const VALID_KINDS =
      'paragraph, bullets, numbered, keyValueTable, mermaidRef, callout, glossary, matrix';

    const unknownKind = fields.some((f) => /Invalid discriminator value/i.test(f));
    if (unknownKind) {
      return (
        `Schema issues: ${fields.join(', ')}. ` +
        `Unknown block kind. Use only: ${VALID_KINDS}.`
      );
    }

    const rootIsArray = /expected object, received array/i.test(message);
    if (rootIsArray) {
      return (
        `Schema issues: ${fields.join(', ')}. ` +
        'The response was an array at the root. Return ONE balanced JSON object starting with `{` on line 1, not an array — do not wrap the document in `[ ... ]`.'
      );
    }

    const rootIsSection = fields.some(
      (f) => /\(root\): Invalid input/i.test(f) && /expected object, received (undefined|array|null)/i.test(f),
    );
    const missingRequired = fields.some((f) =>
      /title: Invalid input: expected string|generatedAt: Invalid input: expected string|executiveSummary: Invalid input: expected string|sections: Invalid input: expected array/i.test(f),
    );
    if (rootIsSection && missingRequired) {
      return (
        `Schema issues: ${fields.join(', ')}. ` +
        'Your previous response was shaped like a single PdfSection `{heading, blocks}` rather than a full PdfDocument. ' +
        'Wrap it as `{title, subtitle?, generatedAt, executiveSummary, sections: [<your-section>]}`. ' +
        '`title` should be the plan title (≤ 120 chars), `generatedAt` an ISO 8601 timestamp, ' +
        '`executiveSummary` a 40–400 character summary, `sections` an array of 3–12 sections — your previous `{heading, blocks}` becomes the first entry.'
      );
    }

    const singleSectionRoot = repair?.reason === 'single_section_root';
    if (singleSectionRoot) {
      return (
        `Schema issues: ${fields.join(', ')}. ` +
        'Your previous response was shaped like a single PdfSection `{heading, blocks}` rather than a full PdfDocument. ' +
        'Wrap it as `{title, subtitle?, generatedAt, executiveSummary, sections: [<your-section>, …at least 2 more sections…]}`. ' +
        'You need at least 3 sections in the `sections` array; the `executiveSummary` must be 40–400 characters; the `title` is the plan title (≤ 120 chars).'
      );
    }

    const arrayHeadings = repair?.reason === 'array_section_headings';
    if (arrayHeadings) {
      const headingList = (repair.originalHeadings ?? []).join('; ');
      return (
        `Schema issues: ${fields.join(', ')}. ` +
        'Your previous response was a bare JSON array of section headings' +
        (headingList ? ` (${headingList})` : '') +
        ' — the body for each section is missing. ' +
        'Re-emit the full PdfDocument: `{title, subtitle?, generatedAt, executiveSummary, sections: [{heading, blocks: [...]}, ...]}`. ' +
        'For each heading above, include at least one block (start with a paragraph ≤ 220 chars). Do not return just the array of headings.'
      );
    }

    const matrixShape = repair?.reason === 'matrix_shape';
    if (matrixShape) {
      return (
        `Schema issues: ${fields.join(', ')}. ` +
        'Your previous response had one or more `matrix` blocks whose row `cells` arrays did not match the column count. ' +
        'For every matrix block, `rows[i].cells.length` MUST equal `columns.length`. ' +
        'Pad with empty strings (or omit rows) — never truncate the column count.'
      );
    }

    const underMinSections = fields.some(
      (f) => /Array must contain at least 3 element/i.test(f) && f.startsWith('sections'),
    );
    const overMaxSections = fields.some(
      (f) => /Array must contain at most 12 element/i.test(f) && f.startsWith('sections'),
    );
    if (underMinSections || overMaxSections) {
      const actualMatch = /You returned (\d+) sections|Array must contain/.exec(message);
      const actual =
        actualMatch && actualMatch[1] ? actualMatch[1] : (underMinSections ? 'too few' : 'too many');
      const guidance = underMinSections
        ? 'PDF document requires 3 ≤ sections ≤ 12. Fold the smaller sections together to reach at least 3.'
        : 'PDF document allows at most 12 sections. Trim or merge sections to fit.';
      return (
        `Schema issues: ${fields.join(', ')}. ` +
        `You returned ${actual} sections; ${guidance}`
      );
    }




    const tupleTooBig = fields.some((f) => /Too big: expected array to have <=2 items/i.test(f));
    if (tupleTooBig) {
      return (
        `Schema issues: ${fields.join(', ')}. ` +
        'keyValueTable rows and glossary entries MUST be exactly two strings: a key and a value. ' +
        'If you need to combine multiple facts into one row, fold them into the second string with commas or semicolons. ' +
        'Do not put 3+ elements in any single row.'
      );
    }

    return `Schema issues: ${fields.join(', ')}`;
  }

  private validatePartialInRun(
    candidate: unknown,
    planContext: { title?: string; summary?: string } | undefined,
    rawLength: number,
    finishReason: string | undefined,
    attempts: number,
  ):
    | { success: true; document: PdfDocument; repair?: PdfDocumentRepair }
    | { success: false; fields: string[]; message: string; repair?: PdfDocumentRepair } {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return {
        success: false,
        fields: ['(root): Invalid input: expected object'],
        message: 'Section call must return an object shaped as `{sections: [...]}`.',
      };
    }
    const record = candidate as Record<string, unknown>;
    const sections = record['sections'];
    if (!Array.isArray(sections) || sections.length === 0) {
      return {
        success: false,
        fields: ['sections: Invalid input: expected array'],
        message: 'Section call must return `{sections: [...]}` with at least one section.',
      };
    }
    const partial = this.schemaService.validatePdfSections({ sections });
    if (partial.success) {
      const synthetic: PdfDocument = {
        title: planContext?.title ?? 'Plan',
        subtitle: undefined,
        generatedAt: new Date().toISOString(),
        executiveSummary: 'Partial sections stitched from per-call LLM output.',
        sections: partial.sections,
      };
      return { success: true, document: synthetic };
    }
    return {
      success: false,
      fields: partial.fields,
      message: partial.message,
      repair: {
        reason: 'single_section_root',
        placeholderCount: 0,
        rawBytes: rawLength,
        finishReason,
        attemptCount: attempts,
      },
    };
  }

  private buildParseFailure(
    parsed: Extract<ReturnType<typeof parseFirstJsonObjectResult>, { ok: false }>,
    raw: string,
    finishReason?: string,
    chunksSeen?: number,
  ): PlannerError {
    const tail = raw.slice(-120).replace(/\s+/g, ' ');
    const sizeKb = (raw.length / 1024).toFixed(1);
    const hasFinishReason = typeof finishReason === 'string' && finishReason.length > 0;
    const hasChunks = typeof chunksSeen === 'number';
    const diagnostic = hasFinishReason || hasChunks
      ? ` (finish_reason="${finishReason ?? 'unknown'}"${hasChunks ? `, chunks=${chunksSeen}` : ''})`
      : '';
    const message =
      parsed.kind === 'no_start'
        ? `PDF-creator output contained no JSON object${diagnostic}. Raw tail: "${tail}"`
        : parsed.kind === 'truncated'
          ? `PDF-creator output was truncated mid-JSON at ${raw.length} chars (~${sizeKb} KB)${diagnostic}. Raw tail: "${tail}"`
          : `PDF-creator JSON malformed near position ${parsed.position}${diagnostic}. Raw tail: "${tail}"`;
    return {
      type: 'invalid_json',
      message,
      raw: tail,
    };
  }

  private buildLengthTruncationFailure(
    parsed: Extract<ReturnType<typeof parseFirstJsonObjectResult>, { ok: false }>,
    raw: string,
    finishReason: string | undefined,
  ): PlannerError {
    const tail = raw.slice(-120).replace(/\s+/g, ' ');
    const sizeKb = (raw.length / 1024).toFixed(1);
    const message =
      `PDF-creator output was cut off by the model's max_tokens limit after ${raw.length} chars (~${sizeKb} KB). ` +
      'The retry budget cannot recover from this — the model is producing more JSON than its output cap allows. ' +
      'Either raise the model\'s max_tokens in Config (≥ 32 000 is recommended for full plans) ' +
      'or use a model that supports larger outputs. ' +
      `finish_reason="${finishReason ?? 'unknown'}". Raw tail: "${tail}"`;
    return {
      type: 'invalid_json',
      message,
      raw: tail,
    };
  }
}

function composeEmptyResponseMessage(
  attempts: number,
  diagnostic: { chunksSeen: number; finishReason?: string },
): string {
  const base = `PDF generation failed: the provider returned no content after ${attempts} attempts. Check that the model and API key in Config are correct and that the provider supports the requested output size.`;
  const hints: string[] = [];
  if (diagnostic.finishReason) {
    hints.push(`last finish_reason="${diagnostic.finishReason}"`);
  }
  if (diagnostic.chunksSeen > 0) {
    hints.push(`streamed ${diagnostic.chunksSeen} chunk(s) with no text`);
  } else {
    hints.push('stream opened but emitted no chunks');
  }
  if (diagnostic.finishReason === 'length') {
    hints.push('the model hit the max_completion_tokens cap before producing output');
  } else if (diagnostic.finishReason === 'content_filter' || diagnostic.finishReason === 'safety') {
    hints.push('the response was blocked by a content/safety filter');
  }
  return `${base} (${hints.join('; ')})`;
}

function composeBailoutMessage(
  bailout: { reason: 'wall_clock_cap'; elapsedMs: number; chunksSeen: number },
  finishReason: string | undefined,
): string {
  const elapsedSec = Math.round(bailout.elapsedMs / 1000);
  const hints: string[] = [
    `wall-clock cap ${elapsedSec}s`,
    `${bailout.chunksSeen} chunk(s) before bailout`,
  ];
  if (finishReason) {
    hints.push(`last finish_reason="${finishReason}"`);
  }
  if (finishReason === 'length') {
    hints.push('the model hit the max_completion_tokens cap');
  } else if (finishReason === 'content_filter' || finishReason === 'safety') {
    hints.push('the response was blocked by a content/safety filter');
  }
  return (
    `PDF generation aborted: the stream hit the wall-clock cap (${elapsedSec}s) after ${bailout.chunksSeen} chunk(s); partial response was not valid JSON. ` +
    'Check that the model and API key in Config are correct and that the provider supports the requested output size. ' +
    `(${hints.join('; ')})`
  );
}
