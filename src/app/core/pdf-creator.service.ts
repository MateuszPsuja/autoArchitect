import { Injectable, inject, signal } from '@angular/core';
import { Plan } from './plan.schema';
import { ProjectStore } from './project.store';
import { PdfCreatorInvokerResult } from './pdf-creator-graph.service';
import { PdfSectionOrchestrator } from './pdf-section-orchestrator';
import { PdfExportService, PdfExportReloadRequested } from './pdf-export.service';
import { estimateTokensForText } from './token-estimator';
import { LLM_FACTORY, LLM_PROVIDERS } from './llm-provider';
import { PlannerError } from './planner-error.model';
import { PdfDocument } from './pdf-document.schema';
import { PdfDocumentRepair } from './plan-schema.service';
import { runStreamLoop } from './streaming/run-stream-loop';

/**
 * @deprecated Kept exported for backward-import compat. The previous
 * 32 768-token floor has been replaced by per-call sizing in the
 * section-stitching pipeline (`Math.max(slot.defaultMaxTokens, 4_096)`).
 * This constant now evaluates to `0` and is no longer applied.
 */
export const PDF_MIN_COMPLETION_TOKENS = 0;

export const PDF_PER_CALL_MAX_TOKENS_FLOOR = 4_096;
export const PDF_PREFLIGHT_THRESHOLD = 8_192;

export const PDF_STREAM_HARD_BAILOUT_MS = 1_200_000;

export interface PdfCreatorSuccess {
  document: PdfDocument;
  blob: Blob;
  repair: PdfDocumentRepair | null;
  preflightWarning: string | null;
  placeholders: number;
}

export interface PdfCreatorFailure {
  error: PlannerError;
  repair: PdfDocumentRepair | null;
  preflightWarning: string | null;
}

export type PdfCreatorOutcome =
  | ({ ok: true } & PdfCreatorSuccess)
  | ({ ok: false } & PdfCreatorFailure);

@Injectable({ providedIn: 'root' })
export class PdfCreatorService {
  private readonly store = inject(ProjectStore);
  private readonly orchestrator = inject(PdfSectionOrchestrator);
  private readonly exporter = inject(PdfExportService);
  private readonly llmFactory = inject(LLM_FACTORY);

  private readonly chunkTimestampsSignal = signal<readonly number[]>([]);

  private activeAbortController: AbortController | null = null;

  chunkTimestamps(): readonly number[] {
    return this.chunkTimestampsSignal();
  }

  abortActive(): boolean {
    if (!this.activeAbortController) return false;
    this.activeAbortController.abort();
    this.activeAbortController = null;
    return true;
  }

  async generate(plan: Plan): Promise<PdfCreatorOutcome> {
    if (this.store.isGenerating()) {
      return {
        ok: false,
        error: { type: 'provider_error', message: 'Another generation is already running.' },
        repair: null,
        preflightWarning: null,
      };
    }

    const cfg = this.store.config();
    const descriptor = LLM_PROVIDERS[cfg.provider];
    const slot = cfg.providerConfigs[cfg.provider];
    const model = slot.selectedModel.trim();
    if (!model) {
      const error = {
        type: 'auth' as const,
        message: 'Select a model in Config before generating a PDF.',
      };
      this.store.setError(error);
      return { ok: false, error, repair: null, preflightWarning: null };
    }

    const apiKey = this.store.apiKey().trim();
    if (descriptor.requiresApiKey && !apiKey) {
      const error = {
        type: 'auth' as const,
        message: `Set your ${descriptor.apiKeyLabel} in Config before generating a PDF.`,
      };
      this.store.setError(error);
      return { ok: false, error, repair: null, preflightWarning: null };
    }

    const preflightWarning =
      slot.defaultMaxTokens < PDF_PREFLIGHT_THRESHOLD
        ? `Your model is configured for ${slot.defaultMaxTokens.toLocaleString()} max tokens; the section-stitching PDF generator uses up to ${PDF_PREFLIGHT_THRESHOLD.toLocaleString()} per call and the export may produce truncated sections. Raise max_tokens in Config to at least ${PDF_PREFLIGHT_THRESHOLD.toLocaleString()} for full plans.`
        : null;

    const key = descriptor.requiresApiKey ? apiKey : 'lm-studio';
    const startedAtIso = new Date().toISOString();

    this.chunkTimestampsSignal.set([]);

    this.store.setError(null);
    this.store.setIsGenerating(true);
    this.store.setStreamBuffer('');
    this.store.setPdfTokenStats({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      model,
      generatedAt: new Date().toISOString(),
      startedAt: startedAtIso,
      llmCalls: 0,
    });

    try {
      const perCallMaxTokens = Math.max(
        slot.defaultMaxTokens,
        PDF_PER_CALL_MAX_TOKENS_FLOOR,
      );
      const chatStreaming = this.llmFactory(cfg, key, {
        streaming: true,
        maxTokens: perCallMaxTokens,
        requestTimeoutMs: PDF_STREAM_HARD_BAILOUT_MS,
        responseFormat: { type: 'json_object' },
      });
      const chat = chatStreaming;

      let llmCalls = 0;
      let promptTokens = 0;

      let committedCompletionTokens: number | null = null;

      const updateLive = (localCompletionTokens: number, localCompletionChars: number): void => {
        this.store.setPdfTokenStats({
          promptTokens,
          completionTokens: localCompletionTokens,
          totalTokens: promptTokens + localCompletionTokens,
          model,
          generatedAt: new Date().toISOString(),
          startedAt: startedAtIso,
          llmCalls,
        });

        void localCompletionChars;
      };

      const wrappedInvoker = async (promptText: string): Promise<PdfCreatorInvokerResult> => {
        llmCalls += 1;
        promptTokens = estimateTokensForText(promptText);
        this.store.setStreamBuffer('');
        this.chunkTimestampsSignal.set([]);
        updateLive(0, 0);

        const STREAM_DISPLAY_MAX_LINES = 20;
        const STREAM_DISPLAY_MAX_BYTES = 16 * 1024;

        const abortController = new AbortController();
        this.activeAbortController = abortController;

        let localAccumulated = '';
        let localChars = 0;
        let localTokens = 0;
        let localChunksSeen = 0;
        let lastFinishReason: string | undefined;
        let bailout: { reason: 'wall_clock_cap'; elapsedMs: number; chunksSeen: number } | undefined;
        const streamStart = Date.now();

        const onChunk = (state: { content: string; raw: unknown; chunksSeen: number }): void => {
          localChunksSeen = state.chunksSeen;
          lastFinishReason = extractFinishReason(state.raw) ?? lastFinishReason;
          const elapsedMs = Date.now() - streamStart;
          if (elapsedMs >= PDF_STREAM_HARD_BAILOUT_MS) {
            // eslint-disable-next-line no-console
            console.warn('[pdf-stream] stream bailout (hard wall-clock cap 20min)', {
              chunksSeen: state.chunksSeen,
              elapsedMs,
              model,
            });
            if (state.content) {
              localAccumulated += state.content;
              localChars += state.content.length;
              localTokens = Math.ceil(localChars / 4);
              this.store.appendStream(state.content);
              const now = Date.now();
              const ring = [...this.chunkTimestampsSignal(), now];
              this.chunkTimestampsSignal.set(ring.slice(-20));
              updateLive(localTokens, localChars);
            }
            bailout = { reason: 'wall_clock_cap', elapsedMs, chunksSeen: state.chunksSeen };
            abortController.abort();
            return;
          }
          if (state.content) {
            localAccumulated += state.content;
            localChars += state.content.length;
            localTokens = Math.ceil(localChars / 4);
            this.store.appendStream(state.content);
            const now = Date.now();
            const ring = [...this.chunkTimestampsSignal(), now];
            this.chunkTimestampsSignal.set(ring.slice(-20));
            updateLive(localTokens, localChars);
          }
        };

        try {
          await runStreamLoop({
            chat,
            signal: abortController.signal,
            promptText,
            onChunk,
          });
        } catch (streamError) {
          if (!abortController.signal.aborted) {
            throw streamError;
          }
        } finally {
          if (this.activeAbortController === abortController) {
            this.activeAbortController = null;
          }
        }

        if (localAccumulated.length > STREAM_DISPLAY_MAX_BYTES) {
          let trimmed = localAccumulated;
          const lines = trimmed.split('\n');
          if (lines.length > STREAM_DISPLAY_MAX_LINES) {
            const droppedLines = lines.length - STREAM_DISPLAY_MAX_LINES;
            trimmed =
              '…[trimmed ' + droppedLines + ' lines]…\n' +
              lines.slice(-STREAM_DISPLAY_MAX_LINES).join('\n');
          } else {
            trimmed = '…[trimmed]…\n' + trimmed.slice(-STREAM_DISPLAY_MAX_BYTES);
          }
          this.store.setStreamBuffer(trimmed);
        }

        let trimmedAccumulated = localAccumulated.trim();
        let empty = trimmedAccumulated === '';

        if (!empty) {
          committedCompletionTokens = estimateTokensForText(localAccumulated);
          updateLive(committedCompletionTokens, localChars);
        }

        return {
          text: localAccumulated,
          empty,
          chunksSeen: localChunksSeen,
          finishReason: lastFinishReason,
          bailout,
        };
      };

      const result = await this.orchestrator.run(plan, {
        llmInvoker: wrappedInvoker,
      });

      llmCalls = result.callCount;

      if (result.error || !result.document) {
        const error = result.error ?? {
          type: 'provider_error' as const,
          message: 'PDF generation returned no document.',
        };

        committedCompletionTokens = null;
        this.store.setPdfTokenStats({
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          model,
          generatedAt: new Date().toISOString(),
          startedAt: startedAtIso,
          llmCalls,
        });
        this.store.setError(error);
        this.store.setIsGenerating(false);
        return { ok: false, error, repair: result.repair, preflightWarning };
      }

      this.store.setIsGenerating(false);

      const blob = await this.exporter.buildPdf(plan, result.document);

      const finalCompletion = committedCompletionTokens ?? estimateTokensForText(this.store.streamBuffer());

      this.store.setPdfTokenStats({
        promptTokens,
        completionTokens: finalCompletion,
        totalTokens: promptTokens + finalCompletion,
        model,
        generatedAt: new Date().toISOString(),
        startedAt: startedAtIso,
        llmCalls,
      });

      return {
        ok: true,
        document: result.document,
        blob,
        repair: result.repair,
        preflightWarning,
        placeholders: result.placeholders,
      };
    } catch (error) {
      if (error instanceof PdfExportReloadRequested) {
        this.store.setIsGenerating(false);
        throw error;
      }
      const plannerError = {
        type: 'provider_error' as const,
        message: error instanceof Error ? error.message : 'Unexpected PDF generation failure.',
      };
      this.store.setError(plannerError);
      this.store.setIsGenerating(false);
      return { ok: false, error: plannerError, repair: null, preflightWarning };
    }
  }
}

function extractFinishReason(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const direct = obj['finish_reason'];
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const message = obj['message'];
  if (message && typeof message === 'object') {
    const metadata = (message as Record<string, unknown>)['response_metadata'];
    if (metadata && typeof metadata === 'object') {
      const reason = (metadata as Record<string, unknown>)['finish_reason'];
      if (typeof reason === 'string' && reason.length > 0) return reason;
    }
  }
  const genInfo = obj['generationInfo'];
  if (genInfo && typeof genInfo === 'object') {
    const reason = (genInfo as Record<string, unknown>)['finish_reason'];
    if (typeof reason === 'string' && reason.length > 0) return reason;
  }
  return undefined;
}
