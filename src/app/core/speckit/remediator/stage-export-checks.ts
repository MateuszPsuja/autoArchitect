import { Plan } from '../../plan.schema';
import { Finding, MarkdownFile } from './remediator.types';

const GHOST_MARKER_RE = /\((?:ref\s+US\d+|(?:ghost|pack))\)/gi;
const SYNTH_MARKER_RE = /\(synth\)/gi;
const FORBIDDEN_DESC_TOKEN_RE = /<|>| \?{3} |regenerate to populate/gi;
const USER_STORY_PHASE_RE = /^## User Story (US\d+)\b/m;
const TASK_LINE_RE = /^- \[ \]/;
const PASSED_CHECK_RE = /^- \[x\] (CHK\d+) (.+)$/gm;

export function runExportChecks(
  plan: Plan,
  files: ReadonlyArray<MarkdownFile>,
): Finding[] {
  const findings: Finding[] = [];
  const tasksMd = files.find((f) => f.path.endsWith('/tasks.md'))?.content ?? '';
  const checklistMd = files.find((f) => f.path.endsWith('/checklist.md'))?.content ?? '';

  findings.push(...scanUnexpandedMarkers(tasksMd));
  findings.push(...scanEmptyPhases(tasksMd));
  findings.push(...scanForbiddenTokens(files));
  findings.push(...scanChecklistConsistency(plan, checklistMd));

  return findings;
}

export function scanUnexpandedMarkers(tasksMd: string): Finding[] {
  const findings: Finding[] = [];
  const legendBoundary = tasksMd.indexOf('## Notes');
  const taskBody = legendBoundary === -1 ? tasksMd : tasksMd.slice(0, legendBoundary);
  if (!taskBody) return findings;

  const lines = taskBody.split('\n');
  const seen = new Set<string>();
  lines.forEach((line, idx) => {
    for (const re of [GHOST_MARKER_RE, SYNTH_MARKER_RE]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        const fingerprint = `${re === GHOST_MARKER_RE ? 'gh' : 'sy'}-${idx}-${m.index ?? 0}-${m[0]}`;
        if (seen.has(fingerprint)) continue;
        seen.add(fingerprint);
        findings.push({
          id: `STAGE-EX-UNEXPANDED-MARKER-${idx}-${m.index ?? 0}`,
          severity: 'HIGH',
          message: `Unexpanded \`${m[0]}\` marker leaked into the tasks.md body at line ${idx + 1}.`,
        });
      }
    }
  });
  return findings;
}

export function scanEmptyPhases(tasksMd: string): Finding[] {
  const findings: Finding[] = [];
  if (!tasksMd) return findings;
  const blocks = tasksMd.split(/^## User Story /m).slice(1);
  for (const block of blocks) {
    const idMatch = /^US\d+\b/.exec(block);
    if (!idMatch) continue;
    const phaseId = idMatch[0];
    const taskLines = block.split('\n').filter((l) => TASK_LINE_RE.test(l));
    if (taskLines.length === 0) {
      findings.push({
        id: `STAGE-EX-EMPTY-PHASE-${phaseId}`,
        severity: 'HIGH',
        message: `User story phase ${phaseId} has zero implementation tasks in tasks.md.`,
      });
    }
  }
  return findings;
}

export function scanForbiddenTokens(files: ReadonlyArray<MarkdownFile>): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    if (!file.content) continue;
    const lines = file.content.split('\n');
    lines.forEach((line, idx) => {
      for (const m of line.matchAll(FORBIDDEN_DESC_TOKEN_RE)) {
        findings.push({
          id: `STAGE-EX-FORBIDDEN-TOKEN-${slug(file.path)}-${idx}`,
          severity: 'LOW',
          message: `Forbidden token \`${m[0].trim()}\` found in ${file.path} (line ${idx + 1}).`,
        });
      }
    });
  }
  return findings;
}

export function scanChecklistConsistency(plan: Plan, checklistMd: string): Finding[] {
  const findings: Finding[] = [];

  const claimed = /All (\d+) agent task\(s\) carry/.exec(checklistMd);
  const actual = plan.agentTasks?.length ?? 0;
  if (claimed && Number(claimed[1]) !== actual) {
    findings.push({
      id: 'STAGE-EX-CHECKLIST-AGENT-TASKS-COUNT',
      severity: 'MEDIUM',
      message: `checklist.md reports ${claimed[1]} agent tasks but Plan.agentTasks has ${actual}.`,
    });
  }

  for (const article of plan.constitution?.articles ?? []) {
    if (!article) continue;
    const mustCount = (article.content.match(/\bMUST\b/g) ?? []).length;
    if (mustCount === 0) continue;
    const articleNum = article.articleNumber;
    if (typeof articleNum !== 'number') continue;
    const enforced = (plan.agentTasks ?? []).some((t) => t.constitutionArticle === articleNum);
    if (!enforced) {
      findings.push({
        id: `STAGE-EX-CONSTITUTION-MUST-UNENFORCED-A${articleNum}`,
        severity: 'MEDIUM',
        message: `Article ${articleNum} uses MUST but no agentTask has constitutionArticle=${articleNum}.`,
      });
    }
  }

  return findings;
}

function slug(path: string): string {
  return path.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

export const __test_exports = {
  GHOST_MARKER_RE,
  SYNTH_MARKER_RE,
  FORBIDDEN_DESC_TOKEN_RE,
  USER_STORY_PHASE_RE,
  TASK_LINE_RE,
  PASSED_CHECK_RE,
};
