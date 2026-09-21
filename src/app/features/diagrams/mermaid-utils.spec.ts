import { normalizeMermaidChart } from './mermaid-utils';

describe('normalizeMermaidChart', () => {
  it('prepends header and transforms arrow lines into nodes/edges', () => {
    const sample = `User (Waitress) -> [Waitress Helper SPA] : Uses (order/tables/menu/notes)
[Waitress Helper SPA] -> OpenRouter API : Optional AI suggestions (HTTPS)`;
    const out = normalizeMermaidChart(sample);

    expect(out.startsWith('graph TD')).toBe(true);
    expect(out).toContain('-->');



    expect(out).toContain('Uses (order/tables/menu/notes)');
  });

  it('leaves charts with existing header intact', () => {
    const s = 'graph LR\nA --> B';
    const out = normalizeMermaidChart(s);
    expect(out).toContain('graph LR');
  });

  it('sanitizes edge labels for charts that already have a header', () => {
    const s =
      'graph TD\nn1["Web Browser"]\nn2["Waitress Helper SPA"]\nn1 -->|Uses (order/tables/menu/notes)| n2';
    const out = normalizeMermaidChart(s);
    expect(out).toContain('graph TD');
    expect(out).toContain('-->|"Uses (order/tables/menu/notes)"| n2');
  });

  it('passes pipes in edge labels through (quoted label syntax handles them)', () => {
    const s = 'A -> B : A | B';
    const out = normalizeMermaidChart(s);
    expect(out).toContain('A | B');
  });

  it('escapes backslashes in edge labels', () => {
    const s = 'A -> B : Uses \\n marker';
    const out = normalizeMermaidChart(s);
    expect(out).toContain('Uses \\\\n marker');
  });

  it('normalizes escaped newline sequences in edge labels', () => {
    const s = 'A -> B : Line one \\n Line two';
    const out = normalizeMermaidChart(s);
    expect(out).toContain('Line one \\\\n Line two');
  });

  it('wraps edge labels in quoted Mermaid label syntax', () => {
    const s = 'A -> B : hello';
    const out = normalizeMermaidChart(s);
    expect(out).toContain('-->|"hello"|');
  });

  it('inserts newline after header if missing', () => {
    const s = 'graph TDUser interacts with Angular';
    const out = normalizeMermaidChart(s);
    expect(out.startsWith('graph TD')).toBe(true);

    expect(out).toMatch(/graph TD\n/);
  });

  it('auto-converts header + prose into a linear flowchart', () => {
    const s =
      'graph TD User interacts with Angular SPA in browser; OpenRouter API called directly from frontend for AI assistance; all state and documents managed locally';
    const out = normalizeMermaidChart(s);
    expect(out.startsWith('graph TD')).toBe(true);
    expect(out).toContain('-->');
    expect(out).toMatch(/n1\["User interacts with Angular SPA in browser"\]/);
  });

  it('passes through common chars inside sequenceDiagram arrow message text', () => {
    const s = `sequenceDiagram
  participant A
  A->>B: GET /users/{id}?active=true
  B-->>A: ok`;
    const out = normalizeMermaidChart(s);





    expect(out).toContain('GET /users/{id}?active=true');

    expect(out).toContain('A->>B:');
    expect(out).toContain('B-->>A:');
  });

  it('passes through all documented Mermaid 11 chars in sequenceDiagram messages except `;`', () => {
    const s = `sequenceDiagram
  A->>B: {a[b<d>e?f}
  B-->>A: reply`;
    const out = normalizeMermaidChart(s);

    expect(out).toContain('{a[b<d>e?f}');

    expect(out).toMatch(/a/);
    expect(out).toMatch(/b/);
    expect(out).toMatch(/d/);
    expect(out).toMatch(/e/);
    expect(out).toMatch(/f/);
  });

  it('does not double-encode &#NNN; entities on a second pass', () => {
    const original = `sequenceDiagram
  A->>B: GET /users/{id}?active=true`;
    const once = normalizeMermaidChart(original);
    const twice = normalizeMermaidChart(once);
    expect(twice).toBe(once);
    expect(twice).not.toContain('&amp;#');
  });

  it('decodes legacy &#NNN; entities in labels so Mermaid renders the raw char', () => {







    const overEncoded = 'graph TD\nA -->|"HTTP&#47;JSON"| B';
    const out = normalizeMermaidChart(overEncoded);
    expect(out).toContain('-->|"HTTP/JSON"|');
    expect(out).not.toContain('&#47;');

    const overEncodedSeq = 'sequenceDiagram\nA->>B: GET /users/&#123;id&#125;&#63;active=true';
    const outSeq = normalizeMermaidChart(overEncodedSeq);
    expect(outSeq).toContain('GET /users/{id}?active=true');
    expect(outSeq).not.toContain('&#123;');
    expect(outSeq).not.toContain('&#125;');
    expect(outSeq).not.toContain('&#63;');
  });

  it('passes through common chars inside flowchart edge labels', () => {
    const s = 'graph TD\nA-->|"has ? and {curly} and /slash"|B';
    const out = normalizeMermaidChart(s);

    expect(out).toContain('has ? and {curly} and /slash');
  });

  it('leaves sequenceDiagram structural lines untouched (participant, Note over)', () => {
    const s = `sequenceDiagram
  participant API as Backend
  participant Web as Frontend
  Note over API,Web: handshake
  API->>Web: hello
  Web-->>API: hi`;
    const out = normalizeMermaidChart(s);
    expect(out).toContain('participant API as Backend');
    expect(out).toContain('participant Web as Frontend');
    expect(out).toContain('Note over API,Web: handshake');
  });









  it('closes any subgraph still open at end of input', () => {
    const s = `graph TD
subgraph S_a
  N1`;
    const out = normalizeMermaidChart(s);
    expect((out.match(/^end\s*$/gm) ?? []).length).toBe(1);
  });

  it('closes nested subgraphs still open at end of input', () => {
    const s = `graph TD
subgraph S_a
  N1
  subgraph S_b
    N2`;
    const out = normalizeMermaidChart(s);



    expect((out.match(/^[ \t]*subgraph\b/gm) ?? []).length).toBe(
      (out.match(/^[ \t]*end\s*$/gm) ?? []).length,
    );
  });

  it('drops a stray `end` that arrives after the diagram has already closed', () => {
    const s = `graph TD
subgraph S_a
  N1
end
1[ArticleAggregate]
end`;
    const out = normalizeMermaidChart(s);



    expect(out.trim().endsWith('end')).toBe(false);
    expect(out).toContain('1[ArticleAggregate]');
  });

  it('is idempotent on already-balanced diagrams', () => {
    const s = `graph TD
subgraph S_a
  N1
  N2
end
1[ArticleAggregate]`;
    const once = normalizeMermaidChart(s);
    const twice = normalizeMermaidChart(once);
    expect(twice).toBe(once);
  });

  it('does not count `subgraph` / `end` inside `%%` comments', () => {



    const s = `graph TD
%% A subgraph inside a comment must not count.
subgraph S_a
  N1
end`;
    const out = normalizeMermaidChart(s);
    expect((out.match(/^end\s*$/gm) ?? []).length).toBe(1);
    expect(out).toContain('%% A subgraph inside a comment');
  });

  it('does not touch content inside a properly-closed subgraph', () => {
    const s = `graph TD
subgraph S_a
  N1
  N2
end`;
    const out = normalizeMermaidChart(s);
    const saIdx = out.indexOf('subgraph S_a');
    const endIdx = out.lastIndexOf('end');
    const n1Idx = out.indexOf('N1');
    const n2Idx = out.indexOf('N2');
    expect(saIdx).toBeLessThan(n1Idx);
    expect(saIdx).toBeLessThan(n2Idx);
    expect(endIdx).toBeGreaterThan(n1Idx);
    expect(endIdx).toBeGreaterThan(n2Idx);
  });

  it('does not invent `end` keywords for diagrams without any subgraph', () => {
    const s = `graph TD
N1 --> N2
N2 --> 1[ArticleAggregate]`;
    const out = normalizeMermaidChart(s);
    expect(out).not.toMatch(/^end\s*$/m);
  });
});
