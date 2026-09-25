import { Plan } from '../../plan.schema';
import { Finding, Patch } from './remediator.types';

const OFFLINE_HINT_RE = /(offline-capable|local-first|no network|offline mode)/i;
const NUMERIC_TOKEN_RE = /\b(\d{1,3}[,\s]?\d{3}|\d+)\s*(users|maus|requests|rps|qps|articles|ms|seconds|hours|days)/gi;
const PLACEHOLDER_RE = /\[TODO:[^\]]*\]|<placeholder>|\?\?\?|\bTKTK\b|\(default seed\)/gi;

interface NumericOccurrence {
  raw: string;
  index: number;
  value: number;
  unit: string;
}

export function runSpecConsistencyStage(plan: Plan, draftSpec = ''): Finding[] {
  const findings: Finding[] = [];

  const offlineContract = plan.specKit?.offlineContract;
  if (!offlineContract && OFFLINE_HINT_RE.test(`${plan.systemOverview.purpose}\n${plan.systemOverview.context}\n${draftSpec}`)) {
    findings.push({
      id: 'STAGE-2.1-OFFLINE-CONTRACT-MISSING',
      severity: 'HIGH',
      message: 'Plan describes an offline/local-first experience but Plan.specKit.offlineContract is null.',
      fix: {
        kind: 'plan-patch',
        payload: {
          specKit: {
            ...(plan.specKit ?? {}),
            offlineContract: 'Auto-derived by remediator; refine via /speckit-clarify.',
          },
        },
      },
    });
  }

  if (draftSpec) {
    findings.push(...scanScaleScope(draftSpec));
    findings.push(...scanPlaceholders(draftSpec));
  }

  return findings;
}

function scanScaleScope(md: string): Finding[] {
  const lines = md.split('\n');
  const findings: Finding[] = [];
  for (const line of lines) {
    if (!/scale|scope|users|maus|throughput/i.test(line)) continue;
    const matches: NumericOccurrence[] = [];
    NUMERIC_TOKEN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = NUMERIC_TOKEN_RE.exec(line)) !== null) {
      const value = parseInt(m[1].replace(/[\s,]/g, ''), 10);
      matches.push({ raw: m[0], index: m.index, value, unit: m[2] });
    }
    if (matches.length < 2) continue;
    const sorted = [...matches].sort((a, b) => a.value - b.value);
    const canonical = sorted[0].raw;
    const rewrite = line.replace(new RegExp(`${sorted[sorted.length - 1].raw}`, 'i'), canonical);
    if (rewrite !== line) {
      findings.push({
        id: 'STAGE-2.2-SCALE-SCOPE-NORMALISED',
        severity: 'MEDIUM',
        message: `Scale/Scope line contained conflicting figures — canonical value ${canonical} kept.`,
        fix: {
          kind: 'markdown-replace',
          payload: {
            patches: [
              {
                file: 'plan.md',
                selector: 'Technical Context > Scale/Scope',
                op: 'replace',
                content: rewrite,
              } satisfies Patch,
            ],
          },
        },
      });
    }
  }
  return findings;
}

function scanPlaceholders(md: string): Finding[] {
  const findings: Finding[] = [];
  PLACEHOLDER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PLACEHOLDER_RE.exec(md)) !== null) {
    findings.push({
      id: 'STAGE-2.3-PLACEHOLDER-REMAINING',
      severity: 'LOW',
      message: `Placeholder "${m[0]}" survived the renderer pass.`,
    });
  }
  return findings;
}
