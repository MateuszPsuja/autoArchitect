import type { ElementRef, Signal } from '@angular/core';
import type { LlmInvokerResult } from '../planner-graph.service';

export interface LlmChat {
  stream(
    prompt: string,
    options?: { signal?: AbortSignal },
  ): Promise<AsyncIterable<unknown>>;
}

export interface StreamChunkLike {
  content?: unknown;
  response_metadata?: { finish_reason?: string };
}

export interface StreamChunkStats {
  llmCalls: number;
  promptTokens: number;
  completionChars: number;
  completionTokens: number;
  chunkAt: number;
}

export type StreamInvocationResult = LlmInvokerResult;

export interface StreamRunnerOptions {
  chat: LlmChat;
  signal: AbortSignal | undefined;
  appendStream: (chunk: string) => void;
  setStreamBuffer: (buffer: string) => void;

  getStreamBuffer: () => string;

  estimatePromptTokens?: (prompt: string) => number;

  onChunk?: (stats: StreamChunkStats) => void;
}

export const STREAM_DISPLAY_MAX_LINES = 20;
export const STREAM_DISPLAY_MAX_BYTES = 16 * 1024;

export type ScrollEffectDisposer = () => void;

export interface ScrollEffectBindings {
  streamBuffer: Signal<string>;
  target: Signal<ElementRef<HTMLElement> | undefined>;
}

export interface RunLifecycleCallbacks {

  onFinished: () => void;
}