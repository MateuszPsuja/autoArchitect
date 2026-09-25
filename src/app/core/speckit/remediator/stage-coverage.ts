import { AgentTask, Plan } from '../../plan.schema';
import { Finding } from './remediator.types';
import { crossCuttingTemplates } from './cross-cutting-fr-templates';
import { isMeasurable, planHarnessFor } from './sc-harness-templates';
import { decideGhost, looksLikeGhostOrRef, synthesiseReplacementTask } from './ghost-task-policy';

const DOMAIN_ISOLATION_RE = /(domain|infrastructure)\s*forbid/i;

export function runCoverageStage(plan: Plan): Finding[] {
  const findings: Finding[] = [];

  for (const sc of plan.successCriteria ?? []) {
    if (isMeasurable(sc)) {
      const plan2 = planHarnessFor(sc);
      const exists = (plan.agentTasks ?? []).some(
        (t) => t.title === plan2.buildTaskTitle || t.title === plan2.ciGateTitle,
      );
      if (!exists) {
        findings.push({
          id: `STAGE-3.1-SC-HARNESS-${sc.id}`,
          severity: 'HIGH',
          message: `${sc.id} is measurable but no measurement harness task exists.`,
          fix: {
            kind: 'task-insert',
            payload: [buildHarnessTask(plan2.buildTaskTitle), buildHarnessTask(plan2.ciGateTitle)],
          },
        });
      }
    }
  }

  for (const fr of plan.functionalRequirements ?? []) {
    for (const tpl of crossCuttingTemplates()) {
      if (tpl.matches(fr)) {
        const tasks = tpl.buildTasks(fr);
        const exists = (plan.agentTasks ?? []).some(
          (t) => tasks.some((nt) => nt.id === t.id || nt.title === t.title),
        );
        if (!exists) {
          findings.push({
            id: `STAGE-3.2-CROSSCUTTING-${fr.id}`,
            severity: 'HIGH',
            message: `${fr.id} cross-cutting coverage missing (${tpl.toolName}).`,
            fix: { kind: 'task-insert', payload: tasks },
          });
        }
      }
    }
  }

  for (const task of plan.agentTasks ?? []) {
    if (!looksLikeGhostOrRef(task)) continue;
    const storyId = task.userStoryIds?.[0];
    const story = (plan.userStories ?? []).find((s) => s.id === storyId);
    const decision = decideGhost(task, story);
    if (decision.disposition === 'synthesised' && story) {
      findings.push({
        id: `STAGE-3.3-GHOST-TASK-${task.id}`,
        severity: 'HIGH',
        message: `Ghost/ref task ${task.id} replaced with concrete implementation for ${story.id}.`,
        fix: { kind: 'task-insert', payload: synthesiseReplacementTask(decision as never, story) },
      });
    } else if (decision.disposition === 'deleted') {
      findings.push({
        id: `STAGE-4.2-GHOST-DELETE-${task.id}`,
        severity: 'MEDIUM',
        message: `Ghost task ${task.id} deleted (no story context).`,
      });
    }
  }

  for (const layer of plan.architectureLayers ?? []) {
    const check = (layer.constitutionCheck ?? []).join('\n');
    if (DOMAIN_ISOLATION_RE.test(check)) {
      const exists = (plan.agentTasks ?? []).some(
        (t) => /import-linter/i.test(t.title) && /domain/i.test(t.title),
      );
      if (!exists) {
        findings.push({
          id: `STAGE-3.4-IMPORT-LINTER-${layer.id}`,
          severity: 'HIGH',
          message: `Layer ${layer.id} declares a domain isolation rule but no import-linter task.`,
          fix: {
            kind: 'task-insert',
            payload: importLinterTask(layer.id),
          },
        });
      }
    }
  }

  return findings;
}

function buildHarnessTask(title: string): AgentTask {
  return {
    id: `synth-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
    title,
    description: title,
    acceptanceCriteria: ['Task is recorded in tasks.md and verified during CI.'],
    fileHints: ['tools/harness/'],
    userStoryIds: [],
    constitutionArticle: 5,
  };
}

function importLinterTask(layerId: string): AgentTask {
  return {
    id: `synth-import-linter-domain-${layerId}`,
    title: `Install import-linter and enforce layers/domain forbid importing infrastructure`,
    description: 'domain layer isolation enforced via import-linter boundary.',
    acceptanceCriteria: [
      'import-linter installed as dev dependency.',
      '`.import-linterrc` forbids the domain layer from importing infrastructure.',
      'CI fails when the boundary is violated.',
    ],
    fileHints: ['.import-linterrc', '.github/workflows/architecture-gate.yml'],
    userStoryIds: [],
    constitutionArticle: 8,
  };
}
