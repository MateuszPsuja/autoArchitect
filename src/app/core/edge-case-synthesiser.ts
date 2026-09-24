import { Plan } from './plan.schema';

const MAX_EDGE_CASES = 8;

const CROSS_CUTTING_KEYWORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bmulti[- ]?tenant\b/i, 'Multi-tenant isolation: tenant-scoped queries must never leak across tenants.'],
  [/\bauth(entication|orization)?\b/i, 'Auth boundaries: tokens expire, roles drift, refresh paths must be tested.'],
  [/\bretr(y|ies)|retry\b/i, 'Retry storms: exponential backoff + jitter plus a circuit breaker for upstream failures.'],
  [/\bback[- ]?pressure\b/i, 'Back-pressure: the downstream queue must shed load before upstream fills memory.'],
  [/\boffline\b/i, 'Offline mode: reads must hit the local cache; writes queue and reconcile on reconnect.'],
  [/\btime\s?skew|clock\s?skew\b/i, 'Clock skew across nodes: timestamps must be the server-assigned monotonic version, not the client wall clock.'],
  [/\bunicode|emoji|rll?\b/i, 'Unicode payloads: grapheme-cluster trimming, bidi overrides stripped, length measured in code points.'],
  [/\blarge\s?(payload|upload|file)\b/i, 'Large payloads: chunked streaming with resumable uploads and per-chunk integrity hashes.'],
  [/\bp9[0-9]|latency|throughput\b/i, 'Latency: the SLO is measured on a synthetic load, not on an idle environment.'],
];

function isBehaviourClause(clause: string): boolean {
  const trimmed = clause.trim();
  if (trimmed.length < 12) return false;
  return /(?:must|should|never|always|under\s+\d|≤?\s*\d|p\d\d|percent|rps|qps|throughput|latency|cache|invalidate|rotate|reject|expir|retain|tenant|scope|retry|backoff|offline|sla|slo|k-anonymity|pseudonym|redact|gdpr|pii|prompt[- ]?inject)/i.test(
    trimmed,
  );
}

function splitClauseHeuristics(input: string): string[] {
  return input
    .split(/[;•\n]|(?:,\s*(?=(?:and|or)\b))/i)
    .map((s) => s.replace(/^[\s\-•]+/, '').trim())
    .filter((s) => s.length > 0);
}

/**
 * Deterministic, LLM-free edge-case synthesiser. Walks the plan's constraints
 * (both per-layer and system-level) and emits one bullet per non-trivial
 * clause that describes a behaviour, plus cross-cutting defaults detected via
 * keyword matches on the plan's title / summary. Hard-cap at 8 bullets.
 */
export function synthesiseEdgeCases(plan: Plan): string[] {
  const out: string[] = [];

  const constraints: string[] = [];
  for (const layer of plan.architectureLayers ?? []) {
    const tc = layer.technicalContext;
    if (tc?.constraints) constraints.push(tc.constraints);
  }
  for (const layer of plan.architectureLayers ?? []) {
    for (const gate of layer.constitutionCheck ?? []) {
      constraints.push(gate);
    }
  }
  for (const c of plan.systemOverview?.constraints ?? []) {
    constraints.push(c);
  }
  for (const nfr of plan.systemOverview?.nfrs ?? []) {
    constraints.push(nfr);
  }

  const seen = new Set<string>();
  const push = (text: string): void => {
    const t = text.trim().replace(/\s+/g, ' ');
    if (t.length === 0 || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };

  for (const raw of constraints) {
    if (!raw) continue;
    for (const clause of splitClauseHeuristics(raw)) {
      if (!isBehaviourClause(clause)) continue;
      push(clause);
      if (out.length >= MAX_EDGE_CASES) return out;
    }
  }

  const haystack = `${plan.meta?.title ?? ''} ${plan.meta?.summary ?? ''} ${plan.systemOverview?.context ?? ''}`;
  for (const [pattern, template] of CROSS_CUTTING_KEYWORDS) {
    if (pattern.test(haystack)) {
      push(template);
      if (out.length >= MAX_EDGE_CASES) break;
    }
  }

  return out;
}
