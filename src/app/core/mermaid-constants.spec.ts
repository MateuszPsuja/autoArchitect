import {
  ALLOWED_MERMAID_TYPES,
  ALLOWED_MERMAID_TYPES_LOWER,
  ALLOWED_MERMAID_TYPE_SET,
} from './mermaid-constants';

describe('mermaid-constants', () => {
  it('exposes the documented camelCase list of allowed mermaid diagram types', () => {
    expect([...ALLOWED_MERMAID_TYPES]).toEqual([
      'flowchart',
      'graph',
      'sequenceDiagram',
      'classDiagram',
      'stateDiagram-v2',
      'erDiagram',
    ]);
  });

  it('exposes the lowercase companion list for case-folded lookups', () => {
    expect([...ALLOWED_MERMAID_TYPES_LOWER]).toEqual([
      'flowchart',
      'graph',
      'sequencediagram',
      'classdiagram',
      'statediagram-v2',
      'erdiagram',
    ]);
  });

  it('ALLOWED_MERMAID_TYPE_SET membership matches ALLOWED_MERMAID_TYPES_LOWER', () => {
    expect(ALLOWED_MERMAID_TYPE_SET.size).toBe(ALLOWED_MERMAID_TYPES_LOWER.length);
    for (const type of ALLOWED_MERMAID_TYPES_LOWER) {
      expect(ALLOWED_MERMAID_TYPE_SET.has(type)).toBe(true);
    }
  });

  it('does not contain unknown diagram types', () => {
    expect(ALLOWED_MERMAID_TYPE_SET.has('pie')).toBe(false);
    expect(ALLOWED_MERMAID_TYPE_SET.has('gantt')).toBe(false);
    expect(ALLOWED_MERMAID_TYPE_SET.has('statediagram')).toBe(false);
  });
});
