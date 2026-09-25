import { Plan } from '../../plan.schema';
import { Finding } from './remediator.types';

const FR_RE = /FR-[A-Za-z0-9-]{3,}/g;
const CC_PREFIX_RE = /^FR-(SEC|A11Y|TS|CG)-/i;

export function runTraceabilityStage(plan: Plan): Finding[] {
  const findings: Finding[] = [];
  const frIndex = new Map<string, string>();
  for (const fr of plan.functionalRequirements ?? []) {
    frIndex.set(fr.id.toLowerCase(), fr.text);
  }

  for (const task of plan.agentTasks ?? []) {
    const refs = collectFrRefs(task);
    if (refs.length === 0 && (task.acceptanceCriteria ?? []).length > 0) {
      findings.push({
        id: `STAGE-5.1-MISSING-FR-${task.id}`,
        severity: 'MEDIUM',
        message: `Task ${task.id} asserts behaviour with no FR reference.`,
        fix: buildSkeletalFrFix(task),
      });
    }
    for (const ref of refs) {
      const body = frIndex.get(ref.toLowerCase());
      if (!body) {
        findings.push({
          id: `STAGE-5.1-MISSING-FR-${task.id}-${ref}`,
          severity: 'MEDIUM',
          message: `Task ${task.id} cites ${ref} which does not exist in Plan.functionalRequirements.`,
        });
        continue;
      }
      const overlapScore = lexicalOverlap(task.description, body);
      if (overlapScore < 0.05) {
        findings.push({
          id: `STAGE-5.2-WRONG-CITE-${task.id}-${ref}`,
          severity: 'MEDIUM',
          message: `Task ${task.id} cites ${ref} but its description shares no vocabulary with the FR body.`,
        });
      }
    }

    const ccRefs = refs.filter((r) => CC_PREFIX_RE.test(r));
    if (ccRefs.length >= 2) {
      findings.push({
        id: `STAGE-5.3-MEGA-CROSSCUTTING-${task.id}`,
        severity: 'MEDIUM',
        message: `Task ${task.id} cites multiple cross-cutting FRs (${ccRefs.join(', ')}).`,
      });
    }
  }

  for (const fr of plan.functionalRequirements ?? []) {
    if (!fr?.id) continue;
    const referenced = (plan.agentTasks ?? []).some((task) => {
      const blob = [task.title, task.description, ...(task.acceptanceCriteria ?? [])]
        .join('\n')
        .toLowerCase();
      return blob.includes(fr.id.toLowerCase());
    });
    if (!referenced) {
      findings.push({
        id: `STAGE-5.4-ORPHAN-FR-${fr.id}`,
        severity: 'MEDIUM',
        message: `${fr.id} is declared in Plan.functionalRequirements but no agent task references it.`,
      });
    }
  }

  return findings;
}

function collectFrRefs(task: Plan['agentTasks'][number]): string[] {
  const blob = [task.title, task.description, ...(task.acceptanceCriteria ?? [])].join('\n');
  const matches = blob.match(FR_RE) ?? [];
  return Array.from(new Set(matches));
}

function lexicalOverlap(a: string, b: string): number {
  const at = new Set(a.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2));
  const bt = new Set(b.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2));
  if (at.size === 0 || bt.size === 0) return 0;
  let inter = 0;
  for (const t of at) if (bt.has(t)) inter++;
  return inter / Math.max(at.size, bt.size);
}

function buildSkeletalFrFix(task: Plan['agentTasks'][number]): { kind: 'plan-patch'; payload: unknown } {
  const frId = `FR-${task.id.replace(/^T/i, '').padStart(3, '0').toUpperCase()}`;
  return {
    kind: 'plan-patch',
    payload: {
      functionalRequirements: [
        {
          id: frId,
          text: `Subject: ${task.title}. ${task.acceptanceCriteria?.[0] ?? ''}`.trim(),
          needsClarification: true,
        },
      ],
    },
  };
}
