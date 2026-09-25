import { AgentTask, KeyEntity, Plan } from '../../plan.schema';

export interface FrNounEntity {
  frId: string;
  frText: string;
  nounPhrase: string;
}

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'has',
  'have',
  'in',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'were',
  'will',
  'with',
]);

export function extractNounPhrasesFromFr(text: string): string[] {
  if (!text) return [];
  const words = text
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const phrases = new Set<string>();
  let buf: string[] = [];
  const flush = (): void => {
    const phrase = buf.join(' ').trim();
    if (phrase.length > 1 && !STOP_WORDS.has(phrase.toLowerCase())) {
      phrases.add(phrase);
    }
    buf = [];
  };
  for (const word of words) {
    const lower = word.toLowerCase();
    if (STOP_WORDS.has(lower)) {
      flush();
      continue;
    }
    if (/^[A-Z]/.test(word) && buf.length > 0) {
      flush();
    }
    buf.push(word);
  }
  flush();
  return Array.from(phrases);
}

export function findMissingEntities(plan: Plan): FrNounEntity[] {
  const declared = new Set(
    ((plan.keyEntities ?? []) as KeyEntity[]).map((e) => e.name.toLowerCase()),
  );
  const out: FrNounEntity[] = [];
  for (const fr of plan.functionalRequirements ?? []) {
    const phrases = extractNounPhrasesFromFr(fr.text);
    const missing = phrases.find((p) => !declared.has(p.toLowerCase()));
    if (missing) {
      out.push({ frId: fr.id, frText: fr.text, nounPhrase: missing });
    }
  }
  return out;
}

export function candidateTasksFor(entityName: string): AgentTask[] {
  const safe = entityName.replace(/[^a-zA-Z0-9_-]/g, '_');
  return [
    {
      id: `synth-${safe.toLowerCase()}-repository`,
      title: `Repository for ${entityName}`,
      description: `Author a typed repository for the ${entityName} key entity.`,
      acceptanceCriteria: [
        `Repository exposes a typed read/write contract for ${entityName}.`,
        `Persistence target matches the Technical Context table.`,
      ],
      fileHints: [`libs/entities/${safe.toLowerCase()}/${safe.toLowerCase()}.repository.ts`],
      userStoryIds: [],
    },
  ];
}
