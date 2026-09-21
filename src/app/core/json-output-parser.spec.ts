import { parseFirstJsonObject, parseFirstJsonObjectResult } from './json-output-parser';

describe('parseFirstJsonObjectResult', () => {
  it('parses a plain JSON object', () => {
    expect(parseFirstJsonObjectResult('{"ok":true}')).toEqual({
      ok: true,
      value: { ok: true },
    });
  });

  it('parses fenced JSON with trailing prose', () => {
    expect(parseFirstJsonObjectResult('```json\n{"ok":true}\n```\nExtra notes')).toEqual({
      ok: true,
      value: { ok: true },
    });
  });

  it('ignores braces inside strings when finding the object end', () => {
    expect(parseFirstJsonObjectResult('{"text":"brace } in string"}\nDone')).toEqual({
      ok: true,
      value: { text: 'brace } in string' },
    });
  });

  it('parses a multi-line JSON object spanning many lines', () => {
    const raw = [
      '{',
      '  "meta": { "title": "Planner" },',
      '  "domains": [',
      '    { "id": "a", "name": "A" },',
      '    { "id": "b", "name": "B" }',
      '  ]',
      '}',
    ].join('\n');

    expect(parseFirstJsonObjectResult(raw)).toEqual({
      ok: true,
      value: {
        meta: { title: 'Planner' },
        domains: [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B' },
        ],
      },
    });
  });

  it('returns no_start when no opening brace exists', () => {
    const result = parseFirstJsonObjectResult('Just some prose with no JSON.');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('no_start');
    }
  });

  it('returns truncated when the object is cut mid-stream', () => {
    const raw = '{"meta":{"title":"Planner","summary":"A long summary';
    const result = parseFirstJsonObjectResult(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('truncated');
      expect(result.position).toBe(raw.length);
      expect(result.tail.length).toBeGreaterThan(0);
    }
  });

  it('recovers from a trailing comma before } by stripping it and reparsing', () => {
    const raw = '{"meta": { "title": "broken" , } }';
    const result = parseFirstJsonObjectResult(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ meta: { title: 'broken' } });
    }
  });

  it('recovers from a trailing comma before ] by stripping it and reparsing', () => {
    const raw = '{"ids": [1, 2, 3, ]}';
    const result = parseFirstJsonObjectResult(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ ids: [1, 2, 3] });
    }
  });

  it('recovers from nested trailing commas in one pass', () => {
    const raw = '{"a": [1, {"b": [2,], }, ]}';
    const result = parseFirstJsonObjectResult(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ a: [1, { b: [2] }] });
    }
  });

  it('preserves commas inside JSON strings when stripping trailing commas', () => {
    const raw = '{"text": "a, b, c,", }';
    const result = parseFirstJsonObjectResult(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ text: 'a, b, c,' });
    }
  });

  it('recovers from a single unescaped inner quote inside a string value', () => {
    const raw = '{"title":"X","executiveSummary":"He said "hi" to me","sections":[]}';
    const result = parseFirstJsonObjectResult(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        title: 'X',
        executiveSummary: 'He said "hi" to me',
        sections: [],
      });
    }
  });

  it('recovers from the exact PDF-creator failure shape (SolverPort / "Internal interface allowing…")', () => {









    const raw =
      '{"title":"SolverPort","description":"Internal interface allowing' +
      '"pluggable solver implementations behind a uniform API" desc",' +
      '"sections":[]}';
    const result = parseFirstJsonObjectResult(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const value = result.value as {
        title: string;
        description: string;
        sections: unknown[];
      };
      expect(value.title).toBe('SolverPort');
      expect(value.description).toBe(
        'Internal interface allowing"pluggable solver implementations behind a uniform API" desc',
      );
      expect(value.sections).toEqual([]);
    }
  });

  it('recovers from multiple unescaped quotes inside the same string value', () => {
    const raw = '{"note":"She said "yes" and I said "no"","ok":true}';
    const result = parseFirstJsonObjectResult(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ note: 'She said "yes" and I said "no"', ok: true });
    }
  });

  it('preserves legitimately-escaped quotes inside string values', () => {
    const raw = '{"text":"a\\"b\\"c","ok":true}';
    const result = parseFirstJsonObjectResult(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ text: 'a"b"c', ok: true });
    }
  });

  it('does not re-escape a legitimate terminator followed by , : } ] or end-of-slice', () => {
    const raw = '{"a":"b","c":[1,2,3],"d":{"e":"f"}}';
    const result = parseFirstJsonObjectResult(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ a: 'b', c: [1, 2, 3], d: { e: 'f' } });
    }
  });

  it('leaves valid JSON untouched (quote-recovery is a no-op on the success path)', () => {



    const raw = '{"meta":{"title":"Planner"},"domains":[]}';
    const result = parseFirstJsonObjectResult(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ meta: { title: 'Planner' }, domains: [] });
    }
  });

  it('still returns malformed for genuinely-broken JSON after the quote-recovery pass', () => {



    const raw = '{"a":1, "b":}';
    const result = parseFirstJsonObjectResult(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('malformed');
    }
  });

  it('returns malformed for genuinely-broken JSON that trailing-comma stripping cannot save', () => {
    const raw = '{"a":1, "b":}';
    const result = parseFirstJsonObjectResult(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('malformed');
    }
  });

  it('strips a <think>…</think> reasoning block before parsing', () => {
    const raw = '<think>Let me think about this carefully. Maybe use a [bracket] here. { also this }</think>\n{"ok":true}\n';
    const result = parseFirstJsonObjectResult(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ ok: true });
    }
  });

  it('strips a <thinking>…</thinking> reasoning block before parsing', () => {
    const raw = '<thinking>reasoning with [brackets] and {braces}</thinking>{"ok":true}';
    const result = parseFirstJsonObjectResult(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ ok: true });
    }
  });

  it('preserves <think> tags that appear inside JSON string values', () => {
    const raw = '{"note": "hello <think> world", "ok": true}';
    const result = parseFirstJsonObjectResult(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ note: 'hello <think> world', ok: true });
    }
  });

  it('classifies balanced but unclosed-string slices as truncated, not malformed', () => {



    const raw = '{"meta":{"title":"t"},"boundedContexts":[{"id":"article-browsin';
    const result = parseFirstJsonObjectResult(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('truncated');
      expect(result.tail).toContain('article-browsin');
    }
  });

  it('classifies tail-off truncation as truncated via the indicator heuristic', () => {



    const raw =
      '{"meta":{"title":"t"},"boundedContexts":[' +
      '{"description":"translation quality"}],"architectureLayerIds":' +
      '["frontend","backend","shared","infrastructure"],"domainIds":["scanner-a';
    const result = parseFirstJsonObjectResult(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('truncated');
      expect(result.tail).toContain('scanner-a');
    }
  });

  it('still flags genuinely malformed JSON correctly', () => {
    const raw = '{"a":1, "b":}';
    const result = parseFirstJsonObjectResult(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('malformed');
    }
  });

  it('captures the trailing 200 chars in the tail field for diagnostics', () => {
    const longJson = '{' + '"x":"' + 'a'.repeat(400) + '"';
    const result = parseFirstJsonObjectResult(longJson);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('truncated');
      expect(result.tail.length).toBe(200);

      expect(result.tail.endsWith('"')).toBe(true);
      expect(result.tail.slice(0, 199)).toBe('a'.repeat(199));
    }
  });

  it('recovers JSON that follows an unclosed <thinking> tag (LLM emitted reasoning that never closed)', () => {
    const raw =
      '<thinking>The user wants a PDF document. Let me draft the bullets.\n' +
      '{"title":"Spec","sections":[{"heading":"S","blocks":[' +
      '{"kind":"bullets","items":["Run 3D bin-packing optimizations","Evaluate candidates"]}]}]}';
    const result = parseFirstJsonObjectResult(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const value = result.value as {
        title: string;
        sections: Array<{ heading: string; blocks: Array<{ kind: string; items?: string[] }> }>;
      };
      expect(value.title).toBe('Spec');
      expect(value.sections[0].heading).toBe('S');
      expect(value.sections[0].blocks[0].items).toEqual([
        'Run 3D bin-packing optimizations',
        'Evaluate candidates',
      ]);
    }
  });

  it('recovers JSON that follows an unclosed <think> tag', () => {
    const raw =
      '<think>Plan: 4 sections, bullets under each.\n' +
      '{"ok":true,"note":"after unclosed think"}';
    const result = parseFirstJsonObjectResult(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ ok: true, note: 'after unclosed think' });
    }
  });

  it('surfaces the raw tail (not the stripped tail) in the no_start diagnostic', () => {
    // LLM streamed reasoning preamble that consumed everything before `{`.
    // The parser should still report the JSON-shaped tail of the *raw* input,
    // not the empty stripped tail — that's the diagnostic the user sees.
    const raw =
      '<thinking>Drafting sections.\n' +
      '"Run 3D bin-packing optimizations; configure First-Fit Decreasing and genetic search.", "Evaluate candidates"';
    const result = parseFirstJsonObjectResult(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('no_start');
      expect(result.tail).toContain('Run 3D bin-packing optimizations');
      expect(result.tail).toContain('Evaluate candidates');
    }
  });

  it('recovers JSON that follows a prose preamble with literal braces inside (PDF-creator block-counting leak)', () => {
    // PDF-creator model emitted planning prose like
    //   "blocks 8. Architecture Decisions (ADRs): 3 blocks × 3 ADRs + 1 callout = 10 blocks"
    // before writing JSON. Pre-fix, the parser latched onto the first `{` inside the
    // prose (or the prose's literal `{}` fragments) and reported "malformed near
    // position 117". The fix tries every `{`/`[` candidate, so it eventually finds
    // the real JSON.
    const preamble =
      'Let me plan the PDF first.\n' +
      'blocks 1. Exec: 1 block\n' +
      'blocks 8. Architecture Decisions (ADRs): 3 blocks × 3 ADRs + 1 callout = 10 blocks\n' +
      '9. Glossary & Appendix: 1 glossary =\n';
    const raw = preamble + '{"title":"Spec","sections":[]}';
    const result = parseFirstJsonObjectResult(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ title: 'Spec', sections: [] });
    }
  });

  it('recovers JSON when the prose preamble contains balanced {…} fragments (exact symptom)', () => {
    // Reproduces the brace-walk latching: the preamble's literal `{3 blocks × 3 ADRs}`
    // opens and closes braces, so the parser would have reported a tiny "malformed"
    // slice (~117 chars) under the old single-candidate behaviour.
    const preamble =
      'Reasoning: ADR set = {3 blocks × 3 ADRs + 1 callout = 10 blocks}, ' +
      'Glossary = {1 glossary =}';
    const raw = preamble + ' then real JSON: {"ok":true,"count":7}';
    const result = parseFirstJsonObjectResult(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ ok: true, count: 7 });
    }
  });

  it('recovers JSON whose first `{` is preceded by a long planning preamble with multiple false `{` braces', () => {
    // Stress test: many false `{` openings in the preamble (e.g. the model enumerated
    // several sections with their own `{count}`-style summaries). The parser must
    // walk past all of them and pick up the real JSON.
    const preamble = [
      'Plan:',
      '- Exec {1 block}',
      '- System {5 blocks}',
      '- Contexts {3 blocks}',
      '- Layers {4 blocks}',
      '- Spec kit {2 blocks}',
      '- Domains {3 blocks}',
      '- Workflows {1 block}',
      '- ADRs {3 blocks × 3 ADRs + 1 callout = 10 blocks}',
      '- Glossary {1 glossary =}',
    ].join('\n');
    const json = '{"meta":{"title":"Planner"},"sections":[]}';
    const result = parseFirstJsonObjectResult(preamble + '\n' + json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ meta: { title: 'Planner' }, sections: [] });
    }
  });

  it('still returns truncated when the real JSON itself is cut mid-stream (does not skip to a later `{`)', () => {
    // Pre-fix sanity: a truly-truncated JSON must NOT be silently skipped past in
    // favour of a later `{` that happens to balance. Truncation wins.
    const raw =
      'Reasoning: {1 block}\n' +
      '{"title":"Spec","description":"cut mid-string here';
    const result = parseFirstJsonObjectResult(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('truncated');
    }
  });

  it('skips false `{` braces in prose when the real JSON appears later and parses cleanly', () => {
    const raw =
      'Notes: {draft} then {another draft}\n' +
      '{"sections":[{"heading":"S1"}]}';
    const result = parseFirstJsonObjectResult(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ sections: [{ heading: 'S1' }] });
    }
  });
});

describe('parseFirstJsonObject (throwing wrapper)', () => {
  it('returns the parsed value on success', () => {
    expect(parseFirstJsonObject('{"ok":true}')).toEqual({ ok: true });
  });

  it('throws when the response is truncated', () => {
    expect(() => parseFirstJsonObject('{"a":')).toThrow(/truncated/i);
  });

  it('throws when no JSON start is present', () => {
    expect(() => parseFirstJsonObject('hello world')).toThrow(/no json object start/i);
  });

  it('throws when the extracted slice is malformed', () => {
    expect(() => parseFirstJsonObject('{"a":, }')).toThrow(/malformed/i);
  });
});
