import { FunctionalRequirement, Plan, UserStory } from './plan.schema';

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

/**
 * Canonical FR IDs the renderer always emits when their matching edge-case
 * bullet is present in the synthesised list. These IDs are stable so
 * downstream spec-kit analysers can grep for them.
 */
export const CANONICAL_LIFTED_FR_IDS = [
  'FR-SEC-001',
  'FR-TS-001',
  'FR-MYPY-001',
  'FR-NOFRAME-001',
  'FR-BIND-RO-001',
  'FR-CGCHK-001',
] as const;

const LIFTED_FR_TEMPLATES: Readonly<Record<(typeof CANONICAL_LIFTED_FR_IDS)[number], string>> = {
  'FR-SEC-001':
    'No secrets, API keys, or credentials are shipped inside the production bundle or any exported artefact. Build-time secret scanning is a release gate.',
  'FR-TS-001':
    'TypeScript compiles in `--strict` mode with zero `any` introduced by app code; library escape hatches are explicitly commented.',
  'FR-MYPY-001':
    'Python sidecar modules run under `mypy --strict` and pass the CI gate.',
  'FR-NOFRAME-001':
    'Domain layer has no framework imports (no Angular, NestJS, FastAPI, LangChain references inside `src/app/core/*` aggregates).',
  'FR-BIND-RO-001':
    'Generated bindings (API client, OpenAPI types) are checked into the repo as read-only; any mutation triggers a regeneration step.',
  'FR-CGCHK-001':
    '`pnpm codegen:check` runs in CI and fails the build when generated artefacts are out of date.',
};

const LIFTED_TRIGGERS: ReadonlyArray<readonly [(typeof CANONICAL_LIFTED_FR_IDS)[number], RegExp]> = [
  ['FR-SEC-001', /secret|api\s?key|credential|token\s?leak/i],
  ['FR-TS-001', /strict\s?typescript|no\s?any|tsc\s?--strict/i],
  ['FR-MYPY-001', /mypy|strict\s?python/i],
  ['FR-NOFRAME-001', /domain\s?has\s?no\s?framework|framework[- ]?free|no\s?framework\s?imports/i],
  ['FR-BIND-RO-001', /generated\s?bindings?[^.]{0,40}read[- ]?only|binding\s?is\s?read[- ]?only/i],
  ['FR-CGCHK-001', /codegen[: ]?check|generated\s?artefacts?\s?out\s?of\s?date/i],
];

export function liftEdgeCasesToFunctionalRequirements(
  plan: Plan,
  edgeCases: string[],
): FunctionalRequirement[] {
  const haystack = [
    `${plan.meta?.title ?? ''}`,
    `${plan.meta?.summary ?? ''}`,
    `${plan.systemOverview?.context ?? ''}`,
    `${plan.systemOverview?.purpose ?? ''}`,
    ...edgeCases,
    ...(plan.architectureLayers ?? []).flatMap((l) => l.constitutionCheck ?? []),
    ...(plan.architectureLayers ?? []).flatMap((l) =>
      l.technicalContext?.constraints ? [l.technicalContext.constraints] : [],
    ),
    ...(plan.systemOverview?.constraints ?? []),
    ...(plan.systemOverview?.nfrs ?? []),
  ]
    .filter(Boolean)
    .join(' \n ');

  const existingIds = new Set((plan.functionalRequirements ?? []).map((fr) => fr.id));
  const lifted: FunctionalRequirement[] = [];
  for (const [id, pattern] of LIFTED_TRIGGERS) {
    if (existingIds.has(id)) continue;
    if (!pattern.test(haystack)) continue;
    lifted.push({
      id,
      text: LIFTED_FR_TEMPLATES[id],
      needsClarification: false,
    });
  }
  return lifted;
}

const NEGATIVE_RULES: ReadonlyArray<readonly [string, string, string]> = [
  [
    'Cross-context memory must never leak between bounded contexts.',
    'two distinct bounded contexts both have conversation memory enabled',
    'an entry is read from the second context that mentions the first context\'s tenant',
  ],
];

export interface NegativeAcceptanceScenario {
  id: string;
  given: string;
  when: string;
  then: string;
}

export function synthetiseNegativeAcceptance(plan: Plan): NegativeAcceptanceScenario[] {
  const out: NegativeAcceptanceScenario[] = [];
  let counter = 1;
  const stories = plan.userStories ?? [];
  for (const rule of NEGATIVE_RULES) {
    const id = `US-AUTO-NEG-${String(counter).padStart(3, '0')}`;
    out.push({
      id,
      given: rule[0],
      when: rule[1],
      then: rule[2],
    });
    counter += 1;
  }
  if (stories.length === 0) return out;
  const memoryStory = stories.find((s: UserStory) =>
    /memory|context\s?isolation|tenant/i.test(`${s.title} ${s.description}`),
  );
  if (memoryStory) {
    out.unshift({
      id: `${memoryStory.id}-NEG-001`,
      given: `bounded context A and bounded context B both have a conversation-memory service enabled for the same user`,
      when: `the user signs out of context A and continues in context B within the same session`,
      then: `no entry from context A is returned in context B's recall (zero cross-context leakage)`,
    });
  }
  return out;
}
