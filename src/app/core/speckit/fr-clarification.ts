export interface Fr010Default {
  validationProfile: 'deterministic-embedding';
  latencyTargetMs: number;
  note: string;
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

export function fr010Default(
  model: 'minimax-default' | 'local-minilm' = 'minimax-default',
): Fr010Default {
  if (model === 'local-minilm') {
    return {
      validationProfile: 'deterministic-embedding',
      latencyTargetMs: 150,
      note:
        'Default: local all-MiniLM-L6-v2 (384-d). Override via Spec Verifier chat if you need a hosted embedding.',
    };
  }
  return {
    validationProfile: 'deterministic-embedding',
    latencyTargetMs: 200,
    note:
      'Default: MiniMax text-embedding-v1 (1536-d). Override via Spec Verifier chat if you need a local embedding.',
  };
}
