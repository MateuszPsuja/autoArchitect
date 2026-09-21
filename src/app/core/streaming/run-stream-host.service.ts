import { Injectable, effect, signal } from '@angular/core';
import { PlannerAbortError } from './abort-error';
import { extractChunkText } from './chunk-text';
import { runStreamLoop } from './run-stream-loop';
import {
  STREAM_DISPLAY_MAX_BYTES,
  STREAM_DISPLAY_MAX_LINES,
  type RunLifecycleCallbacks,
  type ScrollEffectBindings,
  type ScrollEffectDisposer,
  type StreamChunkLike,
  type StreamChunkStats,
  type StreamInvocationResult,
  type StreamRunnerOptions,
} from './stream-runner';

const TICK_INTERVAL_MS = 100;

@Injectable({ providedIn: 'root' })
export class RunStreamHost {

  readonly tick = signal(0);

  readonly chunkTimestamps = signal<readonly number[]>([]);

  private readonly chunkRingSize = 20;
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private scrollDisposer: ScrollEffectDisposer | null = null;
  private lifecycle: RunLifecycleCallbacks | null = null;

  startRun(callbacks: RunLifecycleCallbacks): void {
    this.lifecycle = callbacks;
    this.chunkTimestamps.set([]);
    this.startTicking();
  }

  markRunFinished(): void {
    this.stopTicking();
    this.tick.update((n) => n + 1);
    this.lifecycle?.onFinished();
    this.lifecycle = null;
  }

  optimisticStop(): void {
    this.lifecycle?.onFinished();
  }

  forceStop(): void {
    this.stopTicking();
    this.lifecycle = null;
    this.tick.update((n) => n + 1);
  }

  createWrappedInvoker(opts: StreamRunnerOptions): (prompt: string) => Promise<StreamInvocationResult> {
    const {
      chat,
      signal,
      appendStream,
      setStreamBuffer,
      getStreamBuffer,
      estimatePromptTokens,
      onChunk,
    } = opts;

    let llmCalls = 0;
    let completionChars = 0;
    let promptTokens = 0;
    let completionTokens = 0;

    const emitChunkStats = (chunkAt: number): void => {
      onChunk?.({
        llmCalls,
        promptTokens,
        completionChars,
        completionTokens,
        chunkAt,
      });
    };

    return async (promptText: string): Promise<StreamInvocationResult> => {
      llmCalls += 1;
      if (estimatePromptTokens) {
        promptTokens += estimatePromptTokens(promptText);
      }

      let lastFinishReason: string | undefined;
      const onChunk = (state: { content: string; raw: unknown; chunksSeen: number }): void => {
        const chunk = state.raw as StreamChunkLike | undefined;
        const finishReason = chunk?.response_metadata?.finish_reason;
        if (typeof finishReason === 'string' && finishReason.length > 0) {
          lastFinishReason = finishReason;
        }
        if (state.content === '' && chunk && (chunk as { content?: unknown }).content !== undefined) {





          // eslint-disable-next-line no-console
          console.debug('[stream-host] chunk content was not a string; skipped', typeof (chunk as { content?: unknown }).content);
        }
        if (state.content) {
          completionChars += state.content.length;
          appendStream(state.content);







          completionTokens += Math.max(1, Math.ceil(state.content.length / 4));
        }
        this.pushChunkTimestamp();
        emitChunkStats(Date.now());
      };

      let localText = '';
      try {
        const loopResult = await runStreamLoop({
          chat,
          signal,
          promptText,
          onChunk,
        });
        localText = loopResult.text;
      } catch (streamError) {



        if (signal?.aborted) {
          throw new PlannerAbortError();
        }
        throw streamError;
      }

      completionTokens = Math.ceil(completionChars / 4);
      emitChunkStats(Date.now());







      trimDisplayBuffer(getStreamBuffer, setStreamBuffer);







      return { text: localText, finishReason: lastFinishReason };
    };
  }

  attachScrollEffect(bindings: ScrollEffectBindings): ScrollEffectDisposer {
    this.detachScrollEffect();
    const ref = effect(() => {
      bindings.streamBuffer();
      const el = bindings.target()?.nativeElement;
      if (!el) return;
      queueMicrotask(() => {
        el.scrollTop = el.scrollHeight;
      });
    });
    this.scrollDisposer = () => ref.destroy();
    return () => this.detachScrollEffect();
  }

  private detachScrollEffect(): void {
    if (this.scrollDisposer) {
      this.scrollDisposer();
      this.scrollDisposer = null;
    }
  }

  private startTicking(): void {
    this.stopTicking();
    this.tickHandle = setInterval(() => {
      this.tick.update((n) => n + 1);
    }, TICK_INTERVAL_MS);
  }

  private stopTicking(): void {
    if (this.tickHandle !== null) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }

  private pushChunkTimestamp(): void {
    const now = Date.now();
    const next = [...this.chunkTimestamps(), now];
    if (next.length > this.chunkRingSize) {
      next.shift();
    }
    this.chunkTimestamps.set(next);
  }
}

function trimDisplayBuffer(
  getStreamBuffer: () => string,
  setStreamBuffer: (buffer: string) => void,
): void {
  const buffer = getStreamBuffer();
  if (buffer.length <= STREAM_DISPLAY_MAX_BYTES) return;
  const lines = buffer.split('\n');
  let trimmed: string;
  if (lines.length > STREAM_DISPLAY_MAX_LINES) {
    const droppedLines = lines.length - STREAM_DISPLAY_MAX_LINES;
    trimmed =
      '…[trimmed ' +
      droppedLines +
      ' lines]…\n' +
      lines.slice(-STREAM_DISPLAY_MAX_LINES).join('\n');
  } else {
    trimmed = '…[trimmed]…\n' + buffer.slice(-STREAM_DISPLAY_MAX_BYTES);
  }
  setStreamBuffer(trimmed);
}