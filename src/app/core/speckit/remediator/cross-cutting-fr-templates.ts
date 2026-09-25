import { AgentTask, FunctionalRequirement } from '../../plan.schema';

export interface CrossCuttingTemplate {
  idPrefix: string;
  matches(fr: FunctionalRequirement): boolean;
  toolName: string;
  buildTasks(fr: FunctionalRequirement): AgentTask[];
}

const SECURITY: CrossCuttingTemplate = {
  idPrefix: 'FR-SEC',
  matches: (fr) => /^FR-SEC/i.test(fr.id),
  toolName: 'gitleaks',
  buildTasks: (fr) => [
    {
      id: `synth-${fr.id.toLowerCase()}-install`,
      title: `Install gitleaks for ${fr.id}`,
      description: `Article 6 (security baseline) — install gitleaks so ${fr.id} can be enforced in CI.`,
      acceptanceCriteria: ['gitleaks installed as a dev dependency.', '.gitleaks.toml configured for this repo.'],
      fileHints: ['.gitleaks.toml', 'package.json'],
      userStoryIds: [],
    },
    {
      id: `synth-${fr.id.toLowerCase()}-ci-gate`,
      title: `Wire gitleaks CI gate for ${fr.id}`,
      description: `Article 6 — CI step that runs gitleaks and fails the pipeline on findings.`,
      acceptanceCriteria: ['CI fails when a secret is found in the diff.', 'Findings are attributed to the offending commit.'],
      fileHints: ['.github/workflows/security-gate.yml'],
      userStoryIds: [],
    },
  ],
};

const ACCESSIBILITY: CrossCuttingTemplate = {
  idPrefix: 'FR-A11Y',
  matches: (fr) => /^FR-A11Y/i.test(fr.id),
  toolName: 'axe-core',
  buildTasks: (fr) => [
    {
      id: `synth-${fr.id.toLowerCase()}-axe`,
      title: `Wire axe-core CI gate for ${fr.id}`,
      description: `Article 7 (accessibility baseline) — run axe-core in CI; ${fr.id} must pass with zero violations.`,
      acceptanceCriteria: [
        'axe-core is invoked against every route in CI.',
        'Pipeline fails when any axe rule trips.',
      ],
      fileHints: ['e2e/a11y.spec.ts'],
      userStoryIds: [],
    },
  ],
};

const TYPESAFETY: CrossCuttingTemplate = {
  idPrefix: 'FR-TS',
  matches: (fr) => /^FR-TS/i.test(fr.id),
  toolName: 'tsc --strict',
  buildTasks: (fr) => [
    {
      id: `synth-${fr.id.toLowerCase()}-tsc-strict`,
      title: `tsc --strict gate for ${fr.id}`,
      description: `Article 6 (type safety baseline) — CI runs \`tsc --noEmit --strict\` to enforce ${fr.id}.`,
      acceptanceCriteria: ['tsc --strict is required (not advisory).', 'Build fails on any strict-mode error.'],
      fileHints: ['tsconfig.json', '.github/workflows/typecheck.yml'],
      userStoryIds: [],
    },
  ],
};

const CODEGRAPH: CrossCuttingTemplate = {
  idPrefix: 'FR-CG',
  matches: (fr) => /^FR-CG/i.test(fr.id),
  toolName: 'import-linter',
  buildTasks: (fr) => [
    {
      id: `synth-${fr.id.toLowerCase()}-import-linter`,
      title: `import-linter rule for ${fr.id}`,
      description: `Article 8 (anti-abstraction baseline) — install import-linter and enforce ${fr.id}.`,
      acceptanceCriteria: [
        'import-linter installed and configured.',
        'CI fails when the forbidden dependency is detected.',
      ],
      fileHints: ['.import-linterrc', '.github/workflows/architecture-gate.yml'],
      userStoryIds: [],
    },
  ],
};

const ALL: CrossCuttingTemplate[] = [SECURITY, ACCESSIBILITY, TYPESAFETY, CODEGRAPH];

export function crossCuttingTemplates(): ReadonlyArray<CrossCuttingTemplate> {
  return ALL;
}

export function tasksForCrossCutting(fr: FunctionalRequirement): AgentTask[] {
  const out: AgentTask[] = [];
  for (const t of ALL) {
    if (t.matches(fr)) out.push(...t.buildTasks(fr));
  }
  return out;
}
