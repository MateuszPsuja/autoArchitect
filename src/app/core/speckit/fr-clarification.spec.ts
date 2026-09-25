import { fr010Default, stripNestedMarker } from './fr-clarification';

describe('fr-clarification', () => {
  describe('stripNestedMarker', () => {
    it('strips the [NEEDS CLARIFICATION: ...] wrapper', () => {
      expect(stripNestedMarker('[NEEDS CLARIFICATION: Foo]')).toBe('Foo');
    });
    it('accepts a loose prefix without brackets', () => {
      expect(stripNestedMarker('NEEDS CLARIFICATION: Foo')).toBe('Foo');
    });
    it('handles nested markers (the xFace FR-010 typo)', () => {
      expect(stripNestedMarker('[NEEDS CLARIFICATION: [NEEDS CLARIFICATION: Foo]]')).toBe('Foo');
    });
    it('returns the input unchanged when no marker is present', () => {
      expect(stripNestedMarker('plain text')).toBe('plain text');
    });
    it('returns undefined when given undefined', () => {
      expect(stripNestedMarker(undefined)).toBeUndefined();
    });
  });

  describe('fr010Default', () => {
    it('returns the 1536-d MiniMax default', () => {
      const d = fr010Default();
      expect(d.validationProfile).toBe('deterministic-embedding');
      expect(d.latencyTargetMs).toBe(200);
      expect(d.note).toContain('MiniMax text-embedding-v1');
    });
    it('returns the 384-d local-minilm alt', () => {
      const d = fr010Default('local-minilm');
      expect(d.latencyTargetMs).toBe(150);
      expect(d.note).toContain('all-MiniLM-L6-v2');
    });
  });
});
