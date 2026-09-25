import { Plan } from '../plan.schema';
import { fr010Default, resolveFr010ForSpec, stripNestedMarker } from './fr-clarification';

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
      expect(d.note).toContain('deterministic-embedding');
      expect(d.embeddingVersioning.schemaMigration).toBeTruthy();
      expect(d.embeddingVersioning.sampleBackfill).toBeTruthy();
    });
    it('returns the 384-d local-minilm alt', () => {
      const d = fr010Default('local-minilm');
      expect(d.latencyTargetMs).toBe(150);
      expect(d.note).toContain('all-MiniLM-L6-v2');
    });
  });

  describe('resolveFr010ForSpec', () => {
    function makePlan(needsClarification: boolean): Plan {
      return {
        meta: {
          title: 'x',
          summary: 'y',
          generatedAt: '2026-01-01T00:00:00.000Z',
          model: 'test',
          featureNumber: 1,
          featureSlug: 'x',
        },
        systemOverview: {
          purpose: 'p',
          context: 'c',
          keyActors: [],
          constraints: [],
          nfrs: [],
          c4: { contextDiagram: 'A', containerDiagram: 'A' },
        },
        boundedContexts: [],
        architectureLayers: [],
        domains: [],
        functionalRequirements: [
          {
            id: 'FR-010',
            text: 'embedding model + dimension [NEEDS CLARIFICATION]',
            needsClarification,
          },
        ],
      } as unknown as Plan;
    }

    it('returns a resolved FR-010 paragraph when an entry is flagged needsClarification', () => {
      const out = resolveFr010ForSpec(makePlan(true));
      expect(out).not.toBeNull();
      expect(out!.profile).toBe('deterministic-embedding');
      expect(out!.text).toContain('MiniMax text-embedding-v1');
      expect(out!.text).toContain('deterministic-embedding');
      expect(out!.embeddingVersioning.schemaMigration).toBeTruthy();
    });

    it('returns null when the plan does not flag FR-010', () => {
      const out = resolveFr010ForSpec(makePlan(false));
      expect(out).toBeNull();
    });

    it('returns null when the plan has no FR-010 entry at all', () => {
      const plan = { ...makePlan(false), functionalRequirements: [] };
      expect(resolveFr010ForSpec(plan)).toBeNull();
    });
  });
});

