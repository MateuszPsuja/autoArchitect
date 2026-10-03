import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import mermaid from 'mermaid';
import { tryParseMermaid } from './mermaid-parse';

describe('tryParseMermaid', () => {
  let parseSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    parseSpy = vi.spyOn(mermaid as unknown as { parse: (chart: string) => Promise<unknown> }, 'parse');
  });

  afterEach(() => {
    parseSpy.mockRestore();
  });

  it('returns true for a syntactically valid chart via mermaid.parse', async () => {
    parseSpy.mockResolvedValue(undefined);
    const ok = await tryParseMermaid('flowchart TD\n  A-->B');
    expect(ok).toBe(true);
    expect(parseSpy).toHaveBeenCalledWith('flowchart TD\n  A-->B');
  });

  it('returns false when mermaid.parse rejects with a syntax error', async () => {
    parseSpy.mockRejectedValue(new Error('Parse error on line 1: Unexpected token'));
    const ok = await tryParseMermaid('this is not mermaid');
    expect(ok).toBe(false);
  });
});
