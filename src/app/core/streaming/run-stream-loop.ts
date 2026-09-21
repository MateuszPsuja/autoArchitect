import { extractChunkText } from './chunk-text';
import type { LlmChat } from './stream-runner';

export interface StreamInvokerOptions {
  chat: LlmChat;
  signal: AbortSignal | undefined;
  promptText: string;

  onChunk?: (state: { content: string; raw: unknown; chunksSeen: number }) => void;
}

export interface StreamInvokerResult {

  text: string;
  chunksSeen: number;

  aborted: boolean;
}

/**
 * Drive a streaming `LlmChat.stream(promptText)` to completion, invoking
 * `onChunk` for every chunk emitted by the provider.
 *
 * When `signal` is already aborted the loop returns immediately with `text`
 * and `chunksSeen` reflecting prior state — callers must pass a fresh
 * controller per attempt to avoid poisoning subsequent retries with an
 * already-aborted signal.
 */
export async function runStreamLoop(opts: StreamInvokerOptions): Promise<StreamInvokerResult> {
  const { chat, signal, promptText, onChunk } = opts;
  let text = '';
  let chunksSeen = 0;
  const aborted = signal?.aborted ?? false;

  const stream = await chat.stream(promptText, { signal });
  try {
    for await (const chunk of stream as AsyncIterable<unknown>) {
      if (signal?.aborted) {
        break;
      }
      chunksSeen += 1;
      const content = extractChunkText(chunk);
      if (content) {
        text += content;
      }
      onChunk?.({ content, raw: chunk, chunksSeen });
    }
  } catch (error) {



    throw error;
  }

  return { text, chunksSeen, aborted };
}