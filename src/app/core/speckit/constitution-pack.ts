import { AgentTask, Plan } from '../plan.schema';

export type ConstitutionArticleId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface ConstitutionArticleMeta {
  id: ConstitutionArticleId;
  title: string;
  mustStatements: string[];
}

export const ARTICLES: ReadonlyArray<ConstitutionArticleMeta> = [
  {
    id: 1,
    title: 'Library-First',
    mustStatements: [
      'Every feature ships as a self-contained library with its own package, tests, and public API.',
    ],
  },
  {
    id: 2,
    title: 'CLI Interface',
    mustStatements: [
      'Every bounded context exposes a CLI subcommand surface for bootstrap, replay, and harness execution.',
      'A top-level composer wires all per-context CLIs into one entrypoint.',
    ],
  },
  {
    id: 3,
    title: 'Test-First (TDD)',
    mustStatements: [
      'Tests are written before implementation; components ship tddSpec.unitTests (≥2) and tddSpec.integrationTests (≥1).',
    ],
  },
  {
    id: 4,
    title: 'Integration Testing',
    mustStatements: [
      'Each provider adapter has a Vitest integration spec AND a pytest integration spec.',
      'A CI gate fails the release pipeline on integration regression.',
      'A coverage matrix maps each FR to at least one integration scenario.',
    ],
  },
  {
    id: 5,
    title: 'Observability',
    mustStatements: [
      'Structured logging contract emits JSON with a request-scoped trace id.',
      'Metrics emitter publishes turn_latency_ms, stt_latency_ms, tts_first_byte_ms, memory_recall_latency_ms.',
      'Local dashboard (Prometheus + Grafana) is wired for both FastAPI sidecar and Angular SPA.',
    ],
  },
  {
    id: 6,
    title: 'Versioning & Breaking Changes',
    mustStatements: [
      'Public APIs follow semver; breaking changes require a major bump and a migration note.',
    ],
  },
  {
    id: 7,
    title: 'Simplicity',
    mustStatements: [
      'No premature abstraction; three or more concrete uses justify a new shared layer.',
    ],
  },
  {
    id: 8,
    title: 'Anti-Abstraction',
    mustStatements: [
      'Use the framework default until a measured constraint forces a custom layer.',
    ],
  },
  {
    id: 9,
    title: 'Integration-First Delivery',
    mustStatements: [
      'Each user story phase ships an end-to-end slice, not an isolated module.',
    ],
  },
];

const ARTICLE_2_CLI_SUBCOMMANDS = [
  'bootstrap-avatar',
  'replay-transcript',
  'run-harness',
] as const;

const ARTICLE_4_PROVIDER_ADAPTERS = [
  'minimaxLlm',
  'minimaxStt',
  'minimaxTts',
  'minimaxImage',
  'minimaxVoiceClone',
] as const;

const ARTICLE_5_LATENCY_METRICS = [
  'turn_latency_ms',
  'stt_latency_ms',
  'tts_first_byte_ms',
  'memory_recall_latency_ms',
] as const;

let synthIdCounter = 0;
const nextSynthId = (article: ConstitutionArticleId, suffix: string): string =>
  `const-art${article}-${suffix}-${++synthIdCounter}`;

function firstLayerDir(plan: Plan): string {
  return (
    plan.architectureLayers
      ?.flatMap((l) => l.directoryStructure ?? [])
      .map((d) => d.path)[0] ?? 'libs'
  );
}

export function synthesiseConstitutionTasks(plan: Plan): AgentTask[] {
  const out: AgentTask[] = [];
  const layerDir = firstLayerDir(plan);

  const contexts = plan.boundedContexts ?? [];

  for (const ctx of contexts) {
    for (const sub of ARTICLE_2_CLI_SUBCOMMANDS) {
      out.push({
        id: nextSynthId(2, `${ctx.id}-${sub}`),
        title: `${ctx.id}-${sub} CLI subcommand`,
        description: `Article 2 — expose the \`${sub}\` subcommand for the \`${ctx.id}\` bounded context (CLI Interface MUST).`,
        acceptanceCriteria: [
          `\`${ctx.id} ${sub}\` runs end-to-end against the ${ctx.name} library.`,
          'Subcommand returns non-zero on error and emits structured logs (Article 5).',
        ],
        fileHints: [`${layerDir}/cli/${ctx.id}/${sub}.ts`],
        userStoryIds: [],
        constitutionArticle: 2,
      });
    }
  }

  out.push({
    id: nextSynthId(2, 'composer'),
    title: 'top-level CLI composer',
    description: `Article 2 — wire every bounded-context CLI subcommand (${ARTICLE_2_CLI_SUBCOMMANDS.join(', ')}) behind one entrypoint (e.g. \`xface <ctx> <subcommand>\`).`,
    acceptanceCriteria: [
      'Single entrypoint composes per-context CLIs.',
      '`--help` enumerates all subcommands from the plan JSON (no hand-maintained list).',
    ],
    fileHints: [`${layerDir}/cli/composer.ts`],
    userStoryIds: [],
    constitutionArticle: 2,
  });

  const adapters: ReadonlyArray<string> = ARTICLE_4_PROVIDER_ADAPTERS;
  if (adapters.length === 0) {
    out.push({
      id: nextSynthId(4, 'no-adapters'),
      title: 'Add a provider adapter first',
      description: 'Article 4 — at least one provider adapter is required before integration tasks can be synthesised.',
      acceptanceCriteria: ['Plan declares at least one provider adapter before integration tasks are emitted.'],
      fileHints: [`${layerDir}/adapters/.gitkeep`],
      userStoryIds: [],
      constitutionArticle: 4,
    });
  } else {
    for (const adapter of adapters) {
      out.push({
        id: nextSynthId(4, `${adapter}-vitest`),
        title: `Vitest integration spec for ${adapter}`,
        description: `Article 4 — Vitest integration spec covering ${adapter} adapter (success + failure paths).`,
        acceptanceCriteria: [
          `Spec runs in CI and asserts adapter happy-path returns expected shape.`,
          `Spec asserts adapter error path is propagated as a typed error (no string-only errors).`,
        ],
        fileHints: [`${layerDir}/adapters/${adapter}.spec.ts`],
        userStoryIds: [],
        constitutionArticle: 4,
      });
      out.push({
        id: nextSynthId(4, `${adapter}-pytest`),
        title: `pytest integration spec for ${adapter}`,
        description: `Article 4 — pytest integration spec covering ${adapter} adapter (mirrors the Vitest spec).`,
        acceptanceCriteria: [
          'Spec runs in CI as part of the integration gate.',
          'Coverage matrix row is updated with the spec file path.',
        ],
        fileHints: [`tests/integration/${adapter}_spec.py`],
        userStoryIds: [],
        constitutionArticle: 4,
      });
    }
    out.push({
      id: nextSynthId(4, 'ci-gate'),
      title: 'CI integration gate',
      description:
        'Article 4 — CI step that runs every Vitest + pytest integration spec; release fails on regression.',
      acceptanceCriteria: [
        'Pipeline step is required (not advisory).',
        'Failure is attributed to the offending spec file in the pipeline summary.',
      ],
      fileHints: ['.github/workflows/integration-gate.yml'],
      userStoryIds: [],
      constitutionArticle: 4,
    });
    out.push({
      id: nextSynthId(4, 'coverage-matrix'),
      title: 'Integration coverage matrix',
      description: 'Article 4 — map every FR-NNN to at least one integration spec; surface gaps.',
      acceptanceCriteria: ['Matrix is regenerated each export.', 'Uncovered FRs are flagged in checklist.md.'],
      fileHints: ['docs/40-integration/coverage-matrix.md'],
      userStoryIds: [],
      constitutionArticle: 4,
    });
  }

  out.push({
    id: nextSynthId(5, 'logging-contract'),
    title: 'Structured logging contract',
    description:
      'Article 5 — define the JSON log schema with a request-scoped `trace_id`; both FastAPI sidecar and Angular SPA emit conforming records.',
    acceptanceCriteria: [
      'Schema is documented and versioned.',
      'Every request emits at least one `request.start` and one `request.end` log line.',
    ],
    fileHints: ['libs/observability/logging-contract.ts', 'libs/observability/logging-contract.py'],
    userStoryIds: [],
    constitutionArticle: 5,
  });

  for (const metric of ARTICLE_5_LATENCY_METRICS) {
    out.push({
      id: nextSynthId(5, metric),
      title: `Metrics emitter for ${metric}`,
      description: `Article 5 — emit \`${metric}\` histogram with labels (model, region, user_tier) where applicable.`,
      acceptanceCriteria: [
        `Histogram is published on the Prometheus scrape endpoint.`,
        'Emission is gated by the request-scoped trace id (cross-references logs).',
      ],
      fileHints: [`libs/observability/metrics/${metric}.ts`],
      userStoryIds: [],
      constitutionArticle: 5,
    });
  }

  out.push({
    id: nextSynthId(5, 'dashboard'),
    title: 'Local observability dashboard',
    description:
      'Article 5 — Prometheus + Grafana docker-compose with a starter dashboard that panels every latency metric.',
    acceptanceCriteria: [
      '`docker compose up` brings the dashboard up on a stable local port.',
      'Dashboard panels cover all four latency metrics.',
    ],
    fileHints: ['ops/observability/docker-compose.yml', 'ops/observability/dashboards/latency.json'],
    userStoryIds: [],
    constitutionArticle: 5,
  });

  out.push({
    id: nextSynthId(5, 'wire-fastapi'),
    title: 'Wire observability into FastAPI sidecar',
    description: 'Article 5 — middleware that populates trace ids and emits the latency metrics.',
    acceptanceCriteria: ['Middleware is registered app-wide.', 'Span ids propagate to downstream service calls.'],
    fileHints: [`${layerDir}/middleware/observability.py`],
    userStoryIds: [],
    constitutionArticle: 5,
  });

  out.push({
    id: nextSynthId(5, 'wire-angular'),
    title: 'Wire observability into Angular SPA',
    description: 'Article 5 — HttpInterceptor that emits `tts_first_byte_ms` and correlates with backend trace ids.',
    acceptanceCriteria: ['Interceptor is registered at app bootstrap.', 'Each HTTP request emits one `http.timing` log.'],
    fileHints: ['src/app/core/observability/http-timing.interceptor.ts'],
    userStoryIds: [],
    constitutionArticle: 5,
  });

  return out;
}
