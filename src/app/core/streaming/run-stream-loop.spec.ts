import { runStreamLoop } from './run-stream-loop';
import { extractChunkText } from './chunk-text';
import type { LlmChat } from './stream-runner';

function buildChatStream<T>(items: ReadonlyArray<T>): LlmChat {
  return {
    stream: async () => {
      async function* gen(): AsyncGenerator<T> {
        for (const item of items) yield item;
      }
      return gen();
    },
  };
}

function buildChatStreamThatThrows(message: string): LlmChat {
  return {
    stream: async () => {
      async function* gen(): AsyncGenerator<unknown> {
        throw new Error(message);
      }
      return gen();
    },
  };
}

describe('runStreamLoop', () => {
  it('returns per-call accumulated text', async () => {
    const chat = buildChatStream([{ content: 'hello ' }, { content: 'world' }]);
    const result = await runStreamLoop({ chat, signal: undefined, promptText: 'p' });
    expect(result.text).toBe('hello world');
    expect(result.chunksSeen).toBe(2);
    expect(result.aborted).toBe(false);
  });

  it('handles empty streams (no chunks)', async () => {
    const chat = buildChatStream<unknown>([]);
    const result = await runStreamLoop({ chat, signal: undefined, promptText: 'p' });
    expect(result.text).toBe('');
    expect(result.chunksSeen).toBe(0);
  });

  it('returns aborted=true when the supplied signal was already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const chat = buildChatStream<unknown>([]);
    const result = await runStreamLoop({
      chat,
      signal: controller.signal,
      promptText: 'p',
    });
    expect(result.aborted).toBe(true);
  });

  it('rethrows non-abort stream errors', async () => {
    const chat = buildChatStreamThatThrows('boom');
    await expect(runStreamLoop({ chat, signal: undefined, promptText: 'p' })).rejects.toThrow('boom');
  });

  it('fires onChunk for every chunk with content + raw + chunksSeen', async () => {
    const seen: Array<{ content: string; chunksSeen: number }> = [];
    const chat = buildChatStream([{ content: 'a' }, { content: '' }, { content: 'b' }]);
    await runStreamLoop({
      chat,
      signal: undefined,
      promptText: 'p',
      onChunk: (s) => seen.push({ content: s.content, chunksSeen: s.chunksSeen }),
    });
    expect(seen).toEqual([
      { content: 'a', chunksSeen: 1 },
      { content: '', chunksSeen: 2 },
      { content: 'b', chunksSeen: 3 },
    ]);
  });

  it('survives extractChunkText returning empty for non-text chunks', async () => {



    const chat = buildChatStream([
      { finish_reason: 'length' },

      { content: 'real' },
    ]);
    const result = await runStreamLoop({ chat, signal: undefined, promptText: 'p' });
    expect(result.text).toBe('real');
    expect(result.chunksSeen).toBe(2);
  });

  it('stops invoking onChunk once signal aborts mid-stream', async () => {
    const controller = new AbortController();
    const seen: number[] = [];
    const chat = {
      stream: async () => {
        async function* gen(): AsyncGenerator<unknown> {
          yield { content: 'one' };
          controller.abort();
          yield { content: 'two' };
          yield { content: 'three' };
        }
        return gen();
      },
    };
    await runStreamLoop({
      chat,
      signal: controller.signal,
      promptText: 'p',
      onChunk: (s) => seen.push(s.chunksSeen),
    });
    expect(seen).toEqual([1]);
  });
});

describe('extractChunkText (smoke)', () => {
  it('returns "" for a chunk with no text content', () => {
    expect(extractChunkText({ content: '' })).toBe('');
  });
});
