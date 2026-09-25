import { AgentTask, Plan } from '../../plan.schema';
import { Finding } from './remediator.types';

const FRAMEWORK_SCOPE_RE = /\b(Vitest|Jasmine|pytest|playwright)\s+covers?\s+([^.;]+)/gi;

interface FrameworkScope {
  framework: string;
  scope: string;
}

export function runConstitutionStage(plan: Plan): Finding[] {
  const findings: Finding[] = [];
  const article3 = plan.constitution?.articles.find((a) => a.articleNumber === 3);
  if (!article3) {
    findings.push({
      id: 'STAGE-1.0-CONSTITUTION-MISSING',
      severity: 'CRITICAL',
      message: 'Plan has no constitution Article 3 (Test-First) for the framework-scope audit.',
    });
    return findings;
  }

  const pairs = parseFrameworkScopes(article3.content);
  if (pairs.length === 0) {
    findings.push({
      id: 'STAGE-1.1-FRAMEWORK-SCOPE-MISSING',
      severity: 'CRITICAL',
      message: 'Article 3 does not declare any (framework, scope) pairs.',
    });
  } else {
    const tasks = plan.agentTasks ?? [];
    for (const pair of pairs) {
      const covered = tasks.some((t) =>
        mentionsScope(t, pair) || mentionsScopeFromTitle(t, pair),
      );
      if (!covered) {
        findings.push({
          id: `STAGE-1.1-FRAMEWORK-COVERAGE-${pair.framework}-${pair.scope}`,
          severity: 'CRITICAL',
          message: `${pair.framework} coverage for "${pair.scope.trim()}" is not implemented in any agent task.`,
          fix: {
            kind: 'task-insert',
            payload: synthesiseFrameworkTask(pair),
          },
        });
      }
    }
  }

  const article6 = plan.constitution?.articles.find((a) => a.articleNumber === 6);
  if (article6 && /SemVer|changelog/i.test(article6.content)) {
    const requiredSubstrings = ['version-bump', 'changelog-init', 'release-notes'];
    const tasks = plan.agentTasks ?? [];
    const covered = new Set<string>();
    for (const t of tasks) {
      const blob = `${t.title}\n${t.description}`.toLowerCase();
      for (const s of requiredSubstrings) {
        if (blob.includes(s)) covered.add(s);
      }
    }
    for (const s of requiredSubstrings) {
      if (!covered.has(s)) {
        findings.push({
          id: `STAGE-1.2-VERSIONING-MISSING-${s}`,
          severity: 'HIGH',
          message: `Article 6 requires a "${s}" task but none exists.`,
          fix: {
            kind: 'task-insert',
            payload: synthesiseVersioningTask(s),
          },
        });
      }
    }
  }

  const article8 = plan.constitution?.articles.find((a) => a.articleNumber === 8);
  if (article8) {
    const primitives = extractAntiAbstractionPrimitives(article8.content);
    for (const layer of plan.architectureLayers ?? []) {
      const tc = layer.technicalContext;
      if (!tc) continue;
      for (const prim of primitives) {
        if (
          tc.constraints &&
          new RegExp(`\\b${prim}\\b`, 'i').test(tc.constraints) &&
          /reject|forbid|avoid/i.test(tc.constraints)
        ) {
          findings.push({
            id: `STAGE-1.3-ANTI-ABSTRACTION-OVERRIDE-${layer.id}-${prim}`,
            severity: 'MEDIUM',
            message: `Layer ${layer.id} declares a rejection of primitive "${prim}", but Article 8 prescribes using it directly.`,
            fix: {
              kind: 'doc-insert',
              payload: {
                path: `docs/20-decisions/adr-override-${layer.id}-${prim}.md`,
                content: `# ADR override — ${layer.id}\n\nLayer \`${layer.id}\` rejects the Article 8 default primitive \`${prim}\`. This ADR records the override and the measured constraint that drove it.\n\n## Context\n${tc.constraints}\n\n## Decision\nOverride Article 8 for the \`${layer.id}\` layer.\n\n## Consequences\n- Surface this override in checklist.md.\n- Revisit on next constitution review.`,
              },
            },
          });
        }
      }
    }
  }

  return findings;
}

function parseFrameworkScopes(content: string): FrameworkScope[] {
  const out: FrameworkScope[] = [];
  FRAMEWORK_SCOPE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FRAMEWORK_SCOPE_RE.exec(content)) !== null) {
    out.push({ framework: match[1], scope: match[2].trim() });
  }
  return out;
}

function mentionsScope(task: AgentTask, pair: FrameworkScope): boolean {
  const blob = `${task.title}\n${task.description}`.toLowerCase();
  return blob.includes(pair.framework.toLowerCase()) && blob.includes(pair.scope.toLowerCase());
}

function mentionsScopeFromTitle(task: AgentTask, _pair: FrameworkScope): boolean {
  return false;
}

function synthesiseFrameworkTask(pair: FrameworkScope): AgentTask {
  const safe = pair.scope
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return {
    id: `synth-test-framework-${pair.framework.toLowerCase()}-${safe || 'core'}`,
    title: `Install ${pair.framework} for ${pair.scope}`,
    description: `Article 3 (Test-First) — ensure ${pair.framework} covers ${pair.scope}.`,
    acceptanceCriteria: [
      `${pair.framework} runs successfully against ${pair.scope}.`,
      'Coverage floor matches the constitution.',
    ],
    fileHints: [`tests/${safe}/`],
    userStoryIds: [],
    constitutionArticle: 3,
  };
}

function synthesiseVersioningTask(kind: string): AgentTask {
  return {
    id: `synth-versioning-${kind}`,
    title: `Versioning task — ${kind}`,
    description: `Article 6 (Versioning) — add a "${kind}" automation step.`,
    acceptanceCriteria: [`${kind} step is wired into the release pipeline.`],
    fileHints: ['tools/release/', '.github/workflows/release.yml'],
    userStoryIds: [],
    constitutionArticle: 6,
  };
}

function extractAntiAbstractionPrimitives(content: string): string[] {
  const matches = content.match(/use\s+([A-Za-z][\w]*)\s+directly/gi) ?? [];
  return matches
    .map((m) => m.replace(/use\s+/i, '').replace(/\s+directly/i, '').trim())
    .filter(Boolean);
}
