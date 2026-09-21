import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { RunStreamHost } from './run-stream-host.service';
import { PlannerAbortError } from '../planner-graph.service';
import { STREAM_DISPLAY_MAX_BYTES } from './stream-runner';

function buildChunk(content: string, finishReason?: string): unknown {
  return {
    content,
    response_metadata: finishReason ? { finish_reason: finishReason } : {},
  };
}

function buildChatStream(
  responses: AsyncIterable<unknown>[],
): { stream: ReturnType<typeof vi.fn>; controller: AbortController } {
  const controller = new AbortController();
  const stream = vi.fn(async () => {
    const next = responses.shift();
    if (!next) {
      throw new Error('no response queued');
    }
    return next;
  });
  return { stream, controller };
}

describe('RunStreamHost', () => {
  let host: RunStreamHost;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    host = TestBed.inject(RunStreamHost);
  });

  it('exposes tick + chunkTimestamps as readonly signals', () => {
    expect(host.tick()).toBe(0);
    expect(host.chunkTimestamps()).toEqual([]);
  });

  describe('startRun / markRunFinished', () => {
    it('clears the chunk ring, starts ticking, and fires onFinished once', () => {
      host.chunkTimestamps.set([1, 2, 3]);
      const onFinished = vi.fn();
      host.startRun({ onFinished });
      expect(host.chunkTimestamps()).toEqual([]);
      host.markRunFinished();
      expect(host.tick()).toBeGreaterThanOrEqual(1);
      expect(onFinished).toHaveBeenCalledTimes(1);
    });

    it('runs onFinished only once even after multiple markRunFinished calls', () => {
      const onFinished = vi.fn();
      host.startRun({ onFinished });
      host.markRunFinished();
      const callsAfterFirst = onFinished.mock.calls.length;
      host.markRunFinished();
      host.markRunFinished();
      expect(onFinished.mock.calls.length).toBe(callsAfterFirst);
    });

    it('does not call onFinished when startRun was never invoked', () => {
      const onFinished = vi.fn();
      host.markRunFinished();
      expect(onFinished).not.toHaveBeenCalled();
    });
  });

  describe('optimisticStop', () => {
    it('fires the lifecycle onFinished synchronously without waiting on the async unwind', () => {
      const onFinished = vi.fn();
      host.startRun({ onFinished });
      host.optimisticStop();
      expect(onFinished).toHaveBeenCalledTimes(1);
    });

    it('does not stop the ticker — that is markRunFinished’s job', () => {
      const onFinished = vi.fn();
      host.startRun({ onFinished });
      host.optimisticStop();



      host.markRunFinished();
      expect(onFinished).toHaveBeenCalledTimes(2);
    });

    it('is a no-op when no run was started', () => {
      const onFinished = vi.fn();
      host.optimisticStop();
      expect(onFinished).not.toHaveBeenCalled();
    });
  });

  describe('forceStop', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('stops the live ticker and clears the lifecycle so a stray markRunFinished is a no-op', () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
      const onFinished = vi.fn();
      host.startRun({ onFinished });

      expect(setIntervalSpy).toHaveBeenCalled();
      const handle = setIntervalSpy.mock.results.at(-1)?.value as ReturnType<typeof setInterval>;

      host.forceStop();

      expect(clearIntervalSpy).toHaveBeenCalledWith(handle);

      host.markRunFinished();
      expect(onFinished).not.toHaveBeenCalled();
    });

    it('is a no-op when no run is active', () => {
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
      expect(() => host.forceStop()).not.toThrow();
      expect(clearIntervalSpy).not.toHaveBeenCalled();
    });
  });

  describe('createWrappedInvoker', () => {
    it('returns the per-call text only, never the cumulative buffer (plan amplifier-1 fix)', async () => {
      const localResponses: AsyncIterable<unknown>[] = [
        (async function* () {
          yield buildChunk('first call chunk a');
          yield buildChunk('first call chunk b', 'stop');
        })(),
        (async function* () {
          yield buildChunk('second call chunk a', 'stop');
        })(),
      ];
      const { stream } = buildChatStream(localResponses);
      let uiBuffer = '';
      const appendStream = (chunk: string): void => {
        uiBuffer += chunk;
      };
      const setStreamBuffer = (buf: string): void => {
        uiBuffer = buf;
      };
      const getStreamBuffer = (): string => uiBuffer;

      const invoker = host.createWrappedInvoker({
        chat: { stream: stream as never },
        signal: undefined,
        appendStream,
        setStreamBuffer,
        getStreamBuffer,
      });

      const r1 = await invoker('prompt 1');
      expect(r1.text).toBe('first call chunk afirst call chunk b');



      const siblingLeftover = 'leftover-from-prior-call';
      uiBuffer = siblingLeftover;

      const r2 = await invoker('prompt 2');
      expect(r2.text).toBe('second call chunk a');
      expect(r2.text).not.toContain(siblingLeftover);
    });

    it('emits finishReason from the last chunk that carries one', async () => {
      const responses: AsyncIterable<unknown>[] = [
        (async function* () {
          yield buildChunk('hello ');
          yield buildChunk('world', 'stop');
        })(),
      ];
      const { stream } = buildChatStream(responses);
      let buf = '';
      const invoker = host.createWrappedInvoker({
        chat: { stream: stream as never },
        signal: undefined,
        appendStream: (c) => (buf += c),
        setStreamBuffer: (b) => (buf = b),
        getStreamBuffer: () => buf,
      });
      const result = await invoker('p');
      expect(result.finishReason).toBe('stop');
    });

    it('fires onChunk after each content chunk with cumulative stats', async () => {
      const responses: AsyncIterable<unknown>[] = [
        (async function* () {
          yield buildChunk('abcd');
          yield buildChunk('efgh', 'stop');
        })(),
      ];
      const { stream } = buildChatStream(responses);
      let buf = '';
      const onChunk = vi.fn();
      const invoker = host.createWrappedInvoker({
        chat: { stream: stream as never },
        signal: undefined,
        appendStream: (c) => (buf += c),
        setStreamBuffer: (b) => (buf = b),
        getStreamBuffer: () => buf,
        onChunk,
      });
      await invoker('p');
      expect(onChunk.mock.calls.length).toBeGreaterThanOrEqual(2);
      const lastCall = onChunk.mock.calls.at(-1)?.[0];
      expect(lastCall).toMatchObject({
        llmCalls: 1,
        completionChars: 8,
        completionTokens: 2,
      });
    });

    it('accumulates prompt tokens when estimatePromptTokens is supplied', async () => {
      const responses: AsyncIterable<unknown>[] = [
        (async function* () {
          yield buildChunk('x', 'stop');
        })(),
        (async function* () {
          yield buildChunk('y', 'stop');
        })(),
      ];
      const { stream } = buildChatStream(responses);
      let buf = '';
      const onChunk = vi.fn();
      const invoker = host.createWrappedInvoker({
        chat: { stream: stream as never },
        signal: undefined,
        appendStream: (c) => (buf += c),
        setStreamBuffer: (b) => (buf = b),
        getStreamBuffer: () => buf,
        estimatePromptTokens: (p) => p.length,
        onChunk,
      });
      await invoker('hello');
      await invoker('world');
      const lastCall = onChunk.mock.calls.at(-1)?.[0];
      expect(lastCall?.promptTokens).toBe('hello'.length + 'world'.length);
    });

    it('throws PlannerAbortError when the signal aborts mid-stream', async () => {
      const controller = new AbortController();
      const responses: AsyncIterable<unknown>[] = [
        (async function* () {
          yield buildChunk('partial');
          controller.abort();
          throw new Error('aborted');
        })(),
      ];
      const { stream } = buildChatStream(responses);
      let buf = '';
      const invoker = host.createWrappedInvoker({
        chat: { stream: stream as never },
        signal: controller.signal,
        appendStream: (c) => (buf += c),
        setStreamBuffer: (b) => (buf = b),
        getStreamBuffer: () => buf,
      });
      await expect(invoker('p')).rejects.toBeInstanceOf(PlannerAbortError);
    });

    it('rethrows non-abort stream errors verbatim', async () => {
      const responses: AsyncIterable<unknown>[] = [
        (async function* () {
          yield buildChunk('partial');
          throw new Error('boom');
        })(),
      ];
      const { stream } = buildChatStream(responses);
      let buf = '';
      const invoker = host.createWrappedInvoker({
        chat: { stream: stream as never },
        signal: undefined,
        appendStream: (c) => (buf += c),
        setStreamBuffer: (b) => (buf = b),
        getStreamBuffer: () => buf,
      });
      await expect(invoker('p')).rejects.toThrow('boom');
    });

    it('trims the UI buffer once it exceeds the byte cap', async () => {
      const line = 'x'.repeat(80) + '\n';
      const payload = line.repeat(400); 

      const responses: AsyncIterable<unknown>[] = [
        (async function* () {
          yield buildChunk(payload, 'stop');
        })(),
      ];
      const { stream } = buildChatStream(responses);
      let buf = '';
      const invoker = host.createWrappedInvoker({
        chat: { stream: stream as never },
        signal: undefined,
        appendStream: (c) => (buf += c),
        setStreamBuffer: (b) => (buf = b),
        getStreamBuffer: () => buf,
      });
      const result = await invoker('p');
      expect(result.text.length).toBe(payload.length);
      expect(buf).toContain('[trimmed');
      const trimmedLines = buf.split('\n');
      expect(trimmedLines.length).toBeLessThanOrEqual(21);
      expect(STREAM_DISPLAY_MAX_BYTES).toBe(16 * 1024);
    });

    it('does not trim when the buffer stays under the byte cap', async () => {
      const responses: AsyncIterable<unknown>[] = [
        (async function* () {
          yield buildChunk('tiny payload', 'stop');
        })(),
      ];
      const { stream } = buildChatStream(responses);
      let buf = '';
      const invoker = host.createWrappedInvoker({
        chat: { stream: stream as never },
        signal: undefined,
        appendStream: (c) => (buf += c),
        setStreamBuffer: (b) => (buf = b),
        getStreamBuffer: () => buf,
      });
      await invoker('p');
      expect(buf).toBe('tiny payload');
      expect(buf).not.toContain('[trimmed');
    });

    it('logs non-string chunk content at debug level without failing', async () => {
      const responses: AsyncIterable<unknown>[] = [
        (async function* () {
          yield { content: { not: 'a string' }, response_metadata: {} };
          yield buildChunk('after', 'stop');
        })(),
      ];
      const { stream } = buildChatStream(responses);
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
      let buf = '';
      const invoker = host.createWrappedInvoker({
        chat: { stream: stream as never },
        signal: undefined,
        appendStream: (c) => (buf += c),
        setStreamBuffer: (b) => (buf = b),
        getStreamBuffer: () => buf,
      });
      const result = await invoker('p');
      expect(result.text).toBe('after');
      expect(debugSpy).toHaveBeenCalled();
      debugSpy.mockRestore();
    });

    it('emits onChunk for every call when createWrappedInvoker is called fresh per call (live-tokens regression)', async () => {
      const responses: AsyncIterable<unknown>[] = [
        (async function* () {
          yield buildChunk('first-a');
          yield buildChunk('first-b', 'stop');
        })(),
        (async function* () {
          yield buildChunk('second-a');
          yield buildChunk('second-b', 'stop');
        })(),
      ];
      const { stream } = buildChatStream(responses);
      const onChunk = vi.fn();
      let buf = '';

      const buildInvoker = (): ((p: string) => Promise<{ text: string }>) =>
        host.createWrappedInvoker({
          chat: { stream: stream as never },
          signal: undefined,
          appendStream: (c) => (buf += c),
          setStreamBuffer: (b) => (buf = b),
          getStreamBuffer: () => buf,
          onChunk,
        });

      await buildInvoker()('prompt 1');
      const callsAfterFirst = onChunk.mock.calls.length;
      expect(callsAfterFirst).toBeGreaterThanOrEqual(2);

      await buildInvoker()('prompt 2');
      const callsAfterSecond = onChunk.mock.calls.length;
      expect(callsAfterSecond).toBeGreaterThan(callsAfterFirst + 1);
      const lastSecondCallStats = onChunk.mock.calls.at(-1)?.[0];
      expect(lastSecondCallStats?.completionChars).toBe('second-asecond-b'.length);
    });
  });
});