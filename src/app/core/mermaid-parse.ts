import mermaid from 'mermaid';

/**
 * Validates that a Mermaid source string parses without throwing.
 *
 * Prefers `mermaid.parse` when available (the cheap parse-only path) and
 * falls back to `mermaid.render` with a unique id otherwise. Returns
 * `true` for any chart the parser accepts, `false` for charts that throw.
 * The error message itself is intentionally swallowed — callers that need
 * the underlying error text should use the lower-level `mermaid.parse` /
 * `mermaid.render` directly (e.g. `diagram-audit.service.ts`).
 */
export async function tryParseMermaid(chart: string): Promise<boolean> {
  try {
    const m = mermaid as unknown as { parse?: (s: string) => Promise<unknown> };
    const parseFn =
      m.parse ??
      (mermaid as unknown as { mermaidAPI?: { parse?: (s: string) => Promise<unknown> } })
        .mermaidAPI?.parse;
    if (typeof parseFn === 'function') {
      await parseFn(chart);
    } else {
      await mermaid.render(`try-parse-${Math.random().toString(36).slice(2)}`, chart);
    }
    return true;
  } catch {
    return false;
  }
}
