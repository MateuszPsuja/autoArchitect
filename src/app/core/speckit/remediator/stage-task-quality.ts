import { AgentTask, Plan } from '../../plan.schema';
import { Finding } from './remediator.types';

const VAGUE_RE = /\b(fast|intuitive|smooth|robust|seamless|effortless|natural)\b/gi;
const FR_REF_RE = /FR-[A-Za-z0-9-]{3,}/g;
const P_MARKER = '[P]';

export function runTaskQualityStage(plan: Plan): Finding[] {
  const findings: Finding[] = [];
  const tasks = plan.agentTasks ?? [];

  const idSet = new Set(tasks.map((t) => t.id));
  for (const task of tasks) {
    const frRefs = task.description.match(FR_REF_RE) ?? [];
    const acRefs = (task.acceptanceCriteria ?? []).flatMap((ac) => ac.match(FR_REF_RE) ?? []);
    const allRefs = Array.from(new Set([...frRefs, ...acRefs]));
    if (allRefs.length >= 3) {
      findings.push({
        id: `STAGE-4.1-MEGA-TASK-${task.id}`,
        severity: 'HIGH',
        message: `Task ${task.id} cites ${allRefs.length} distinct FRs — split recommended.`,
        fix: { kind: 'task-split', payload: { taskId: task.id, frs: allRefs } },
      });
    }

    for (const ac of task.acceptanceCriteria ?? []) {
      VAGUE_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = VAGUE_RE.exec(ac)) !== null) {
        findings.push({
          id: `STAGE-4.5-VAGUE-AC-${task.id}`,
          severity: 'LOW',
          message: `Acceptance criterion uses vague adjective "${m[0]}".`,
        });
      }
    }

    if (/Author tests for|Surface TDD specs/i.test(task.title)) {
      const implMatch = tasks.find((t) => t.id !== task.id && /Implement\b/i.test(t.title));
      if (!implMatch) {
        findings.push({
          id: `STAGE-4.3-TEST-ONLY-${task.id}`,
          severity: 'MEDIUM',
          message: `Test-only task ${task.id} has no matching Implement task.`,
          fix: { kind: 'task-insert', payload: synthesiseImplementTask(task) },
        });
      }
    }
  }

  const conflicts = detectParallelConflicts(tasks);
  for (const conflict of conflicts) {
    findings.push({
      id: `STAGE-4.4-PARALLEL-CONFLICT-${conflict.a}-${conflict.b}`,
      severity: 'MEDIUM',
      message: `Parallel markers on ${conflict.a} + ${conflict.b} collide on file hint "${conflict.dir}".`,
      fix: { kind: 'noop', payload: { loseParallel: [conflict.a, conflict.b] } },
    });
  }

  for (const dup of detectDuplicateDescriptions(tasks)) {
    findings.push(dup);
  }

  return findings.filter((f) => !idSet.has(f.id));
}

export function detectDuplicateDescriptions(tasks: AgentTask[]): Finding[] {
  const out: Finding[] = [];
  const byKey = new Map<string, string[]>();
  for (const task of tasks) {
    const key = task.description.trim().toLowerCase();
    if (!key) continue;
    const list = byKey.get(key) ?? [];
    list.push(task.id);
    byKey.set(key, list);
  }
  for (const [desc, ids] of byKey) {
    if (ids.length < 2) continue;
    const sorted = [...ids].sort();
    out.push({
      id: `STAGE-4.6-DUPLICATE-DESCRIPTION-${sorted.join('-')}`,
      severity: 'MEDIUM',
      message: `${sorted.length} tasks share the same description verbatim: ${sorted.join(', ')}.`,
      fix: { kind: 'noop', payload: { taskIds: sorted, description: desc } },
    });
  }
  return out;
}

function synthesiseImplementTask(testOnly: AgentTask): AgentTask {
  return {
    id: `${testOnly.id}-impl`,
    title: testOnly.title.replace(/^Author tests for\s+/i, 'Implement ').replace(/^Surface TDD specs$/i, 'Implement component under test'),
    description: testOnly.description,
    acceptanceCriteria: [
      'Implementation is paired with the failing test that exists in the repo.',
      'Suite transitions from red to green.',
    ],
    fileHints: testOnly.fileHints,
    userStoryIds: testOnly.userStoryIds,
  };
}

export function detectParallelConflicts(tasks: AgentTask[]): { a: string; b: string; dir: string }[] {
  const out: { a: string; b: string; dir: string }[] = [];
  const parallels = tasks.filter((t) => /\[\s*P\s*\]/.test(t.title));
  for (let i = 0; i < parallels.length; i++) {
    for (let j = i + 1; j < parallels.length; j++) {
      const overlap = directoryOverlap(parallels[i].fileHints, parallels[j].fileHints);
      if (overlap) {
        out.push({ a: parallels[i].id, b: parallels[j].id, dir: overlap });
      }
    }
  }
  return out;
}

function directoryOverlap(a: string[], b: string[]): string | null {
  for (const x of a) {
    for (const y of b) {
      const xNorm = x.replace(/\/+$/, '');
      const yNorm = y.replace(/\/+$/, '');
      if (xNorm && yNorm && (xNorm.startsWith(yNorm) || yNorm.startsWith(xNorm))) {
        return xNorm;
      }
    }
  }
  return null;
}

export { P_MARKER };
