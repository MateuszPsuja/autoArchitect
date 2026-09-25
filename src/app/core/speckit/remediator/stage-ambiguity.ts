import { Plan } from '../../plan.schema';
import { Finding } from './remediator.types';

const VAGUE_RE = /\b(fast|intuitive|smooth|robust|seamless|effortless|natural)\b/gi;
const DISJUNCTION_RE = /\b(?:or|either\s*…\s*or)\b/i;
const TERM_RE = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g;

export function runAmbiguityStage(plan: Plan): Finding[] {
  const findings: Finding[] = [];
  const glossaryTerms = new Set((plan.glossary ?? []).map((g) => g.term.toLowerCase()));

  for (const story of plan.userStories ?? []) {
    const blob = `${story.description}\n${story.independentTest}\n${(story.acceptanceScenarios ?? [])
      .flatMap((s) => [s.given, s.when, s.then])
      .join('\n')}`;
    VAGUE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = VAGUE_RE.exec(blob)) !== null) {
      findings.push({
        id: `STAGE-6.1-VAGUE-US-${story.id}`,
        severity: 'LOW',
        message: `Story ${story.id} uses vague adjective "${m[0]}".`,
      });
    }

    if (DISJUNCTION_RE.test(blob)) {
      findings.push({
        id: `STAGE-6.2-MODE-DISJUNCTION-${story.id}`,
        severity: 'MEDIUM',
        message: `Story ${story.id} picks between modes with "or"/"either…or".`,
      });
    }

    TERM_RE.lastIndex = 0;
    let tm: RegExpExecArray | null;
    while ((tm = TERM_RE.exec(blob)) !== null) {
      if (!glossaryTerms.has(tm[1].toLowerCase())) {
        findings.push({
          id: `STAGE-6.3-MISSING-GLOSSARY-${story.id}-${tm[1]}`,
          severity: 'LOW',
          message: `Term "${tm[1]}" appears in ${story.id} but not in glossary.`,
        });
      }
    }
  }

  return findings;
}
