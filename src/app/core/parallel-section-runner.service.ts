import { Injectable, inject } from '@angular/core';
import { PlannerError } from './planner-error.model';
import { ProjectStore } from './project.store';
import { StageValidationResult, StageKind } from './plan-schema.service';
import { PromptBuilderService } from './prompt-builder.service';
import { PlannerAbortError, isPlannerAbortError } from './streaming/abort-error';

export interface ParallelJob<T> {
  id: string;

  buildPrompt: (retryHint: string) => Promise<{ format: (vars: object) => Promise<unknown> }>;
  validate: (value: unknown) => StageValidationResult<StageKind, T>;
}

export interface ParallelJobResult<T> {
  id: string;
  value: T | null;
  error: PlannerError | null;
}

export interface ParallelRunResult<T> {
  results: ParallelJobResult<T>[];

  error: PlannerError | null;

  attempts: number;
}

type LlmInvoker = (promptText: string) => Promise<{ text: string }>;
type ParallelParseFn = (raw: string) => { ok: boolean; value?: unknown } & Record<string, unknown>;

export interface ParallelJobEvent {
  jobId: string;
  attempt?: number;
  repairPass?: number;
  kind?: string;
  message?: string;

  stageKind?: 'layers' | 'domains';
}

export interface ParallelRunOptions {

  maxAttemptsPerJob?: number;

  repairOnFinalFailure?: boolean;

  maxRepairPasses?: number;

  signal?: AbortSignal;
  hooks?: {
    onJobStart?: (id: string) => void;
    onJobEnd?: (id: string, raw: string) => void;
    onJobRetry?: (event: ParallelJobEvent) => void;
    onJobRepair?: (event: ParallelJobEvent) => void;
    onJobError?: (event: ParallelJobEvent) => void;
  };
}

@Injectable({ providedIn: 'root' })
export class ParallelSectionRunner {
  private readonly projectStore = inject(ProjectStore);
  private readonly promptBuilder = inject(PromptBuilderService);

  async run<T>(
    jobs: ParallelJob<T>[],
    llmInvoker: LlmInvoker,
    parse: ParallelParseFn,
    options?: ParallelRunOptions & { stageKind?: 'layers' | 'domains' },
    attemptsRefIn?: { value: number },
  ): Promise<ParallelRunResult<T>> {
    const concurrency = Math.max(
      1,
      this.projectStore.config().parallelSectionConcurrency ?? 4,
    );
    const maxAttemptsPerJob = Math.max(1, options?.maxAttemptsPerJob ?? 1);
    const repairEnabled = options?.repairOnFinalFailure ?? true;
    const maxRepairPasses = Math.max(0, options?.maxRepairPasses ?? 1);
    const hooks = options?.hooks;
    const signal = options?.signal;
    const stageKind = options?.stageKind ?? 'layers';

    const queue = [...jobs];
    const results: ParallelJobResult<T>[] = [];



    const attemptsRef = attemptsRefIn ?? { value: 0 };
    const workers: Promise<void>[] = [];

    const worker = async (): Promise<void> => {
      while (queue.length > 0) {
        if (signal?.aborted) return;
        const job = queue.shift();
        if (!job) return;
        hooks?.onJobStart?.(job.id);
        const result = await this.runOneJob(job, llmInvoker, parse, maxAttemptsPerJob, attemptsRef, hooks, signal, stageKind);







        if (result.error && repairEnabled && !signal?.aborted) {
          let lastError: PlannerError = result.error;
          let lastRepaired: ParallelJobResult<T> | null = null;
          for (let pass = 0; pass < maxRepairPasses; pass += 1) {
            if (signal?.aborted) break;
            hooks?.onJobRepair?.({ jobId: job.id, repairPass: pass + 1, stageKind });
            const repaired = await this.runRepairPass(
              job,
              lastError,
              llmInvoker,
              parse,
              attemptsRef,
              stageKind,
            );
            if (!repaired) break;
            lastRepaired = repaired;



            if (repaired.error) {
              hooks?.onJobError?.({
                jobId: job.id,
                repairPass: pass + 1,
                kind: repaired.error.type,
                message: repaired.error.message,
                stageKind,
              });
              lastError = repaired.error;
              continue;
            }
            break;
          }
          if (lastRepaired && !lastRepaired.error) {
            results.push(lastRepaired);
            hooks?.onJobEnd?.(job.id, '');
            continue;
          }
        }
        hooks?.onJobEnd?.(job.id, '');
        results.push(result);
      }
    };

    for (let i = 0; i < Math.min(concurrency, jobs.length); i += 1) {
      workers.push(worker());
    }
    await Promise.all(workers);

    const aggregatedError = results.find((r) => r.error !== null)?.error ?? null;
    return { results, error: aggregatedError, attempts: attemptsRef.value };
  }

  private async runRepairPass<T>(
    job: ParallelJob<T>,
    lastError: PlannerError,
    llmInvoker: LlmInvoker,
    parse: ParallelParseFn,
    attemptsRef: { value: number },
    stageKind: 'layers' | 'domains',
  ): Promise<ParallelJobResult<T> | null> {
    try {
      const raw = 'raw' in lastError ? lastError.raw ?? '' : '';
      const built = await this.promptBuilder.buildRepairPrompt(stageKind, raw);
      const rendered = await built.format({});
      const promptText =
        typeof rendered === 'string'
          ? rendered
          : (rendered as { toString(): string }).toString();
      const response = await llmInvoker(promptText);
      attemptsRef.value += 1;
      const parsed = parse(response.text);
      if (!parsed.ok) return null;
      const validation = job.validate(parsed.value);
      if (!validation.success) return null;
      return { id: job.id, value: validation.data as T, error: null };
    } catch (err) {



      if (isPlannerAbortError(err)) throw err;
      return null;
    }
  }

  private async runOneJob<T>(
    job: ParallelJob<T>,
    llmInvoker: LlmInvoker,
    parse: ParallelParseFn,
    maxAttempts: number,
    attemptsRef: { value: number },
    hooks?: ParallelRunOptions['hooks'],
    signal?: AbortSignal,
    stageKind: 'layers' | 'domains' = 'layers',
  ): Promise<ParallelJobResult<T>> {
    let lastError: PlannerError | null = null;
    let lastRaw = '';







    const recentSignatures: string[] = [];

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (signal?.aborted) {
        throw new PlannerAbortError();
      }
      try {
        const prompt = await job.buildPrompt(this.buildRetryHint(lastError));
        const rendered = await prompt.format({});
        const promptText =
          typeof rendered === 'string'
            ? rendered
            : (rendered as { toString(): string }).toString();
        const response = await llmInvoker(promptText);
        attemptsRef.value += 1;
        lastRaw = response.text;

        const parsed = parse(response.text);
        if (!parsed.ok) {
          const kind = typeof parsed['kind'] === 'string' ? parsed['kind'] : 'invalid';
          const position = typeof parsed['position'] === 'number' ? parsed['position'] : -1;





          recentSignatures.push(`parse:${kind}:${position}`);
          if (recentSignatures.length > 3) recentSignatures.shift();
          lastError = {
            type: 'invalid_json',
            message: this.describeParseFailure(job.id, parsed),
            raw: response.text.slice(-300),
          };
          hooks?.onJobError?.({ jobId: job.id, attempt, kind: 'invalid_json', message: lastError.message, stageKind });
          if (this.shouldBailOnNoProgress(recentSignatures)) {
            return { id: job.id, value: null, error: lastError };
          }
          if (attempt < maxAttempts) {
            hooks?.onJobRetry?.({ jobId: job.id, attempt: attempt + 1, stageKind });
            continue;
          }
          return { id: job.id, value: null, error: lastError };
        }

        const validation = job.validate(parsed.value);
        if (validation.success) {
          return { id: job.id, value: validation.data as T, error: null };
        }

        const fieldSignature = validation.fields.slice().sort().join('|');
        recentSignatures.push(`schema:${fieldSignature}`);
        if (recentSignatures.length > 3) recentSignatures.shift();
        lastError = {
          type: 'schema_validation',
          message: this.describeValidationFailure(job.id, validation),
          fields: validation.fields,
          raw: response.text.slice(-300),
        };
        hooks?.onJobError?.({ jobId: job.id, attempt, kind: 'schema_validation', message: lastError.message, stageKind });
        if (this.shouldBailOnNoProgress(recentSignatures)) {



          return { id: job.id, value: null, error: lastError };
        }
        if (attempt < maxAttempts) {
          hooks?.onJobRetry?.({ jobId: job.id, attempt: attempt + 1, stageKind });
          continue;
        }
        return { id: job.id, value: null, error: lastError };
      } catch (error) {





        recentSignatures.push('provider_error');
        if (recentSignatures.length > 3) recentSignatures.shift();
        lastError = {
          type: 'provider_error',
          message: error instanceof Error ? error.message : String(error),
        };
        hooks?.onJobError?.({ jobId: job.id, attempt, kind: 'provider_error', message: lastError.message, stageKind });
        if (this.shouldBailOnNoProgress(recentSignatures)) {
          return { id: job.id, value: null, error: lastError };
        }
        if (attempt < maxAttempts) {
          hooks?.onJobRetry?.({ jobId: job.id, attempt: attempt + 1, stageKind });
          continue;
        }
        return { id: job.id, value: null, error: lastError };
      }
    }

    return { id: job.id, value: null, error: lastError };
  }

  private shouldBailOnNoProgress(recent: readonly string[]): boolean {
    return (
      recent.length >= 3 &&
      recent[recent.length - 1] === recent[recent.length - 2] &&
      recent[recent.length - 2] === recent[recent.length - 3]
    );
  }

  private buildRetryHint(lastError: PlannerError | null): string {
    if (!lastError) return '';
    if (lastError.type === 'invalid_json') {
      const truncated =
        /truncat/i.test(lastError.message) ||
        (lastError.raw ? rawEndsAbruptly(lastError.raw) : false);
      if (truncated) {
        return (
          'RETRY — your previous response was truncated by the model output limit. ' +
          'Return ONLY the lean skeleton: keep aggregates ≤ 1, components ≤ 2 with a single 1-line tddSpec.unitTests entry, ' +
          'drop domainEvents to [], trim all string fields to ≤ 80 chars. Do NOT include any mermaid / spec-kit content — those belong to layers, not domains.'
        );
      }
      if (lastError.raw) {
        const compact = lastError.raw.replace(/\s+/g, ' ');
        const head = compact.slice(0, 100);
        const tail = compact.slice(-80);
        return `RETRY — previous attempt produced invalid JSON: ${lastError.message}. First 100 chars: "${head}". Last 80 chars: "${tail}".`;
      }
      return `RETRY — previous attempt produced invalid JSON: ${lastError.message}.`;
    }
    if (lastError.type === 'schema_validation') {
      const fields = lastError.fields?.length
        ? ` Fields: ${lastError.fields.join(', ')}.`
        : '';
      return `RETRY — previous attempt failed validation: ${lastError.message}.${fields}`;
    }
    return `RETRY — previous attempt failed: ${lastError.message}`;
  }

  private describeParseFailure(
    jobId: string,
    parsed: { ok: boolean; [k: string]: unknown },
  ): string {
    const kind = typeof parsed['kind'] === 'string' ? parsed['kind'] : 'invalid';
    const position = typeof parsed['position'] === 'number' ? parsed['position'] : -1;
    return `${jobId}: JSON parser returned '${kind}' at position ${position}.`;
  }

  private describeValidationFailure(
    jobId: string,
    validation: { success: false; fields: string[]; message: string },
  ): string {
    const fields = validation.fields.length > 0 ? validation.fields.join(', ') : '(no field paths)';
    return `${jobId}: ${validation.message} [${fields}]`;
  }
}

export function rawEndsAbruptly(raw: string): boolean {
  const trimmed = raw.replace(/\s+$/, '');
  if (trimmed.length === 0) return false;
  const last = trimmed[trimmed.length - 1];
  return last !== '}' && last !== ']' && last !== ',' && last !== '"';
}
