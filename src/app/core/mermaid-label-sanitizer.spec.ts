import { sanitizeMermaidLabels } from './mermaid-label-sanitizer';

const FIXTURES: ReadonlyArray<readonly [string, string, string?]> = [
  [
    'quotes parens in a rectangle label',
    'graph TD\nViewer[3D Viewer (Three.js)]',
    'graph TD\nViewer["3D Viewer (Three.js)"]',
  ],
  [
    'quotes a colon in a rectangle label',
    'graph TD\nA[API: v1]',
    'graph TD\nA["API: v1"]',
  ],
  [
    'quotes a slash in a rectangle label',
    'graph TD\nA[HTTP / JSON]',
    'graph TD\nA["HTTP / JSON"]',
  ],
  [
    'quotes a hash in a rectangle label',
    'graph TD\nA[has #hash]',
    'graph TD\nA["has #hash"]',
  ],
  [
    'escapes embedded double quotes when label is already quoted',
    'graph TD\nA["He said \\"Hello\\""]',
    'graph TD\nA["He said \\"Hello\\""]',
  ],
  [
    'leaves a safe rectangle label unchanged',
    'graph TD\nA[Safe Label]',
    'graph TD\nA[Safe Label]',
  ],
  [
    'leaves an already-quoted rectangle label unchanged',
    'graph TD\nViewer["3D Viewer (Three.js)"]',
    'graph TD\nViewer["3D Viewer (Three.js)"]',
  ],
  [
    'quotes a rounded rectangle label',
    'graph TD\nA(Foo : Bar)',
    'graph TD\nA("Foo : Bar")',
  ],
  [
    'quotes a rhombus label',
    'graph TD\nA{Decision: yes}',
    'graph TD\nA{"Decision: yes"}',
  ],
  [
    'quotes a cylindrical stadium label',
    'graph TD\nDB[(Store: Postgres)]',
    'graph TD\nDB[("Store: Postgres")]',
  ],
  [
    'quotes a double-circle label',
    'graph TD\nA((Outer: x))',
    'graph TD\nA(("Outer: x"))',
  ],
  [
    'quotes a hexagon label',
    'graph TD\nA{{Hex (label)}}',
    'graph TD\nA{{"Hex (label)"}}',
  ],
  [
    'quotes a parallelogram label',
    'graph TD\nA[/Parallel (alt)/]',
    'graph TD\nA[/"Parallel (alt)"/]',
  ],
  [
    're-quotes an edge label that has unsafe chars',
    'graph TD\nA -->|Uses (parens)| B',
    'graph TD\nA -->|"Uses (parens)"| B',
  ],
  [
    'leaves a safe edge label unchanged',
    'graph TD\nA -->|uses| B',
    'graph TD\nA -->|uses| B',
  ],
  [
    'leaves an already-quoted edge label unchanged',
    'graph TD\nA -->|"Uses (parens)"| B',
    'graph TD\nA -->|"Uses (parens)"| B',
  ],
  [
    'leaves a sequence diagram message with parens unchanged',
    'sequenceDiagram\nAlice->>Bob: hello (paren)',
    'sequenceDiagram\nAlice->>Bob: hello (paren)',
  ],
  [
    'leaves a sequence diagram message with a backslash unchanged',
    'sequenceDiagram\nAlice->>Bob: backslash \\n here',
    'sequenceDiagram\nAlice->>Bob: backslash \\n here',
  ],
  [
    'leaves a sequence diagram message with embedded quotes unchanged',
    'sequenceDiagram\nAlice->>Bob: she said "hi"',
    'sequenceDiagram\nAlice->>Bob: she said "hi"',
  ],
  [
    'leaves a sequence diagram structural line alone',
    'sequenceDiagram\n  participant API as Backend\n  participant Web as Frontend\n  Note over API,Web: handshake\n  API->>Web: hello\n  Web-->>API: hi',
    'sequenceDiagram\n  participant API as Backend\n  participant Web as Frontend\n  Note over API,Web: handshake\n  API->>Web: hello\n  Web-->>API: hi',
  ],
  [
    'leaves subgraph and end lines alone',
    'graph TD\nsubgraph "Backend"\n  A-->B\nend',
    'graph TD\nsubgraph "Backend"\n  A-->B\nend',
  ],
  [
    'leaves classDef and style lines alone',
    'graph TD\nclassDef foo fill:#f9f\nstyle A fill:#fff',
    'graph TD\nclassDef foo fill:#f9f\nstyle A fill:#fff',
  ],
  [
    'leaves comment lines alone',
    'graph TD\n%% A[should not be quoted]',
    'graph TD\n%% A[should not be quoted]',
  ],
  [
    'leaves direction / linkStyle / click lines alone',
    'graph TD\ndirection LR\nlinkStyle 0 stroke:#ff0\nclick A "https://example.com"',
    'graph TD\ndirection LR\nlinkStyle 0 stroke:#ff0\nclick A "https://example.com"',
  ],
  [
    'returns empty input unchanged',
    '',
    '',
  ],
  [
    'handles multiple labels on one line',
    'graph TD\nA[Foo (a)] --> B[Bar (b)]',
    'graph TD\nA["Foo (a)"] --> B["Bar (b)"]',
  ],
];

describe('sanitizeMermaidLabels', () => {
  for (const [name, input, expected] of FIXTURES) {
    it(name, () => {
      const out = sanitizeMermaidLabels(input);
      if (expected !== undefined) {
        expect(out).toBe(expected);
      }
      expect(sanitizeMermaidLabels(out)).toBe(out);
    });
  }

  it('round-trips a problematic regen output', () => {
    const input = [
      'graph TD',
      'Viewer[3D Viewer (Three.js)]',
      'A[API: v1] -->|"GET /users/{id}"| B[(Store (Postgres))]',
      'subgraph "Backend"',
      '  C{Decision?} -->|"yes / no"| D',
      'end',
    ].join('\n');
    const once = sanitizeMermaidLabels(input);
    const twice = sanitizeMermaidLabels(once);
    expect(twice).toBe(once);
  });
});
