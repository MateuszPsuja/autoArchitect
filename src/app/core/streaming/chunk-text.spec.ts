import { extractChunkText } from './chunk-text';

describe('extractChunkText', () => {
  it('returns the string when chunk is a plain string', () => {
    expect(extractChunkText('hello')).toBe('hello');
  });

  it('returns the string when chunk.content is a string (OpenAI Completions API)', () => {
    expect(extractChunkText({ content: 'hello world' })).toBe('hello world');
  });

  it('returns the joined text when chunk.content is a ContentBlock[] (OpenAI Responses API)', () => {
    expect(
      extractChunkText({
        content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }],
      }),
    ).toBe('Hello world');
  });

  it('returns the chunk.text getter value when present (AIMessageChunk)', () => {
    const chunk = Object.defineProperty({}, 'text', {
      get() {
        return 'via getter';
      },
    });
    expect(extractChunkText(chunk)).toBe('via getter');
  });

  it('returns "" when chunk.content is an empty array', () => {
    expect(extractChunkText({ content: [] })).toBe('');
  });

  it('returns "" when chunk.content is an empty string', () => {
    expect(extractChunkText({ content: '' })).toBe('');
  });

  it('returns "" when chunk is null/undefined', () => {
    expect(extractChunkText(null)).toBe('');
    expect(extractChunkText(undefined)).toBe('');
  });

  it('falls back to chunk.message when chunk itself has no text/content', () => {
    expect(
      extractChunkText({ message: { content: 'msg content' } }),
    ).toBe('msg content');
  });

  it('falls back to chunk.delta.content (raw OpenAI stream chunk shape)', () => {
    expect(extractChunkText({ delta: { content: 'delta content' } })).toBe(
      'delta content',
    );
  });

  it('extracts text from a single text block in array form', () => {
    expect(extractChunkText({ content: [{ type: 'text', text: 'single' }] })).toBe(
      'single',
    );
  });

  it('skips non-text blocks and joins only text blocks', () => {
    expect(
      extractChunkText({
        content: [
          { type: 'reasoning', reasoning: 'thinking...' },
          { type: 'text', text: 'visible' },
        ],
      }),
    ).toBe('visible');
  });

  it('extracts text from object-shaped content with a text field', () => {
    expect(extractChunkText({ content: { text: 'nested' } })).toBe('nested');
  });

  it('extracts output_text from object content (Responses API shape)', () => {
    expect(extractChunkText({ content: { output_text: 'out' } })).toBe('out');
  });

  it('extracts delta.output_text (Responses API nested)', () => {
    expect(extractChunkText({ delta: { output_text: 'delta out' } })).toBe('delta out');
  });

  it('extracts text nested under wrapper keys like item/output/response/data', () => {
    expect(extractChunkText({ item: { content: 'item text' } })).toBe('item text');
    expect(extractChunkText({ output: { text: 'output text' } })).toBe('output text');
    expect(extractChunkText({ response: { content: [{ type: 'text', text: 'resp' }] } })).toBe('resp');
  });

  it('last-resort: finds any non-empty string field whose name suggests text', () => {
    expect(extractChunkText({ custom_field: 'ignored' })).toBe('');
    expect(extractChunkText({ some_text: 'found it' })).toBe('found it');
    expect(extractChunkText({ text_delta: 'delta text' })).toBe('delta text');
    expect(extractChunkText({ finish_reason: 'stop' })).toBe('');
  });
});