import { z } from 'zod';
import { FunctionalRequirement, Plan } from '../plan.schema';

export interface EmbeddingVersioningPolicy {
  schemaMigration: string;
  sampleBackfill: string;
}

export const EmbeddingVersioningPolicySchema = z.object({
  schemaMigration: z.string().min(1),
  sampleBackfill: z.string().min(1),
});

export interface Fr010Default {
  validationProfile: 'deterministic-embedding';
  latencyTargetMs: number;
  note: string;
  embeddingVersioning: EmbeddingVersioningPolicy;
}

const NESTED_MARKER_PREFIX = /^\s*\[?\s*NEEDS\s+CLARIFICATION\s*\]?\s*[:.\-]?\s*/i;
const TRAILING_BRACKET = /\]\s*$/;

export function stripNestedMarker(note?: string): string | undefined {
  if (!note) return note;
  let trimmed = note.trim();
  if (!trimmed) return trimmed;
  if (!/NEEDS\s+CLARIFICATION/i.test(trimmed)) return note;
  let prev = '';
  let iter = 0;
  while (prev !== trimmed && iter < 5) {
    prev = trimmed;
    trimmed = trimmed
      .replace(NESTED_MARKER_PREFIX, '')
      .replace(TRAILING_BRACKET, '')
      .trim();
    iter += 1;
  }
  return trimmed.length > 0 ? trimmed : (note ?? '').trim();
}

export const DEFAULT_EMBEDDING_VERSIONING_POLICY: EmbeddingVersioningPolicy = {
  schemaMigration:
    'Embeddings carry a `schemaVersion` field; readers ignore any schemaVersion newer than `+1` minor from their build.',
  sampleBackfill:
    'Re-embed the prior 1k nearest-neighbour matches on each schema bump; the backfill job is offline-only.',
};

export function fr010Default(
  model: 'minimax-default' | 'local-minilm' = 'minimax-default',
): Fr010Default {
  if (model === 'local-minilm') {
    return {
      validationProfile: 'deterministic-embedding',
      latencyTargetMs: 150,
      note:
        'Default: local all-MiniLM-L6-v2 (384-d). Override via Spec Verifier chat if you need a hosted embedding.',
      embeddingVersioning: DEFAULT_EMBEDDING_VERSIONING_POLICY,
    };
  }
  return {
    validationProfile: 'deterministic-embedding',
    latencyTargetMs: 200,
    note:
      'Default: MiniMax text-embedding-v1 (1536-d) — deterministic-embedding profile. Override via Spec Verifier chat if you need a local embedding.',
    embeddingVersioning: DEFAULT_EMBEDDING_VERSIONING_POLICY,
  };
}

export interface ResolvedFr010 {
  text: string;
  profile: 'deterministic-embedding';
  latencyTargetMs: number;
  embeddingVersioning: EmbeddingVersioningPolicy;
  note: string;
}

/**
 * Renderer-only resolver. The plan may carry an `FR-010` entry still
 * flagged `needsClarification` (the xFace report shows the LLM emits the
 * marker despite autoArchitect's default). At render time we replace the
 * marker with a concrete pinned paragraph so spec-kit's analyser doesn't
 * see a `[NEEDS CLARIFICATION]` marker. **We never mutate `plan` itself.**
 */
export function resolveFr010ForSpec(plan: Plan): ResolvedFr010 | null {
  const entry = (plan.functionalRequirements ?? []).find(
    (fr: FunctionalRequirement) => fr.id === 'FR-010' && fr.needsClarification,
  );
  if (!entry) return null;
  const defaults = fr010Default();
  return {
    text:
      'embedding model + dimension are pinned at generation time to the autoArchitect defaults; the chosen profile is `deterministic-embedding` (latency budget 200ms p95 for the hosted MiniMax text-embedding-v1 / 1536-d default, 150ms p95 for the local all-MiniLM-L6-v2 / 384-d fallback). Override via Spec Verifier chat if the user supplies an alternative embedding service.',
    profile: defaults.validationProfile,
    latencyTargetMs: defaults.latencyTargetMs,
    embeddingVersioning: defaults.embeddingVersioning,
    note: defaults.note,
  };
}
