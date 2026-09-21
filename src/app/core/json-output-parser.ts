export type ParseResult =
  | { ok: true; value: unknown }
  | { ok: false; kind: 'no_start' | 'truncated' | 'malformed'; position: number; tail: string };

const TAIL_SNIPPET_LENGTH = 200;

export function parseFirstJsonObjectResult(raw: string): ParseResult {
  const candidates = buildParseCandidates(raw);
  let lastResult: ParseResult | null = null;
  for (const candidate of candidates) {
    const result = tryParseCandidate(candidate, raw);
    if (result.ok) return result;
    lastResult = result;
    if (result.kind !== 'no_start') return result;
  }
  return lastResult ?? {
    ok: false,
    kind: 'no_start',
    position: 0,
    tail: raw.slice(-TAIL_SNIPPET_LENGTH),
  };
}

function buildParseCandidates(raw: string): readonly string[] {
  const fenceStripped = stripJsonFence(raw);
  const thinkingStripped = stripThinkingSections(fenceStripped);
  const candidates: string[] = [];
  if (thinkingStripped !== fenceStripped) candidates.push(thinkingStripped);
  candidates.push(fenceStripped);
  if (fenceStripped !== raw) candidates.push(raw);
  return candidates;
}

function tryParseCandidate(stripped: string, raw: string): ParseResult {
  const opens = findAllStructuralChars(stripped);
  if (opens.length === 0) {
    return {
      ok: false,
      kind: 'no_start',
      position: 0,
      tail: raw.slice(-TAIL_SNIPPET_LENGTH),
    };
  }

  let lastMalformed: ParseResult | null = null;
  for (const open of opens) {
    const result = tryParseFrom(stripped, raw, open);
    if (result.ok) return result;
    if (result.kind === 'truncated') return result;
    lastMalformed = result;
  }
  return (
    lastMalformed ?? {
      ok: false,
      kind: 'no_start',
      position: 0,
      tail: raw.slice(-TAIL_SNIPPET_LENGTH),
    }
  );
}

function tryParseFrom(stripped: string, raw: string, open: number): ParseResult {
  const opener = stripped[open];
  const closer = opener === '{' ? '}' : ']';

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = open; index < stripped.length; index += 1) {
    const char = stripped[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === opener) {
      depth += 1;
      continue;
    }

    if (char === closer) {
      depth -= 1;
      if (depth === 0) {
        const slice = stripped.slice(open, index + 1);
        try {
          return { ok: true, value: JSON.parse(slice) };
        } catch (parseError) {





          try {
            const cleaned = stripTrailingCommas(slice);
            if (cleaned !== slice) {
              return { ok: true, value: JSON.parse(cleaned) };
            }
          } catch {

          }
          try {
            const reescaped = escapeUnescapedQuotesInStrings(slice);
            if (reescaped !== slice) {
              return { ok: true, value: JSON.parse(reescaped) };
            }
          } catch {

          }









          const message = parseError instanceof Error ? parseError.message : '';
          if (looksTruncated(slice) || indicatesTruncation(slice, message)) {
            return {
              ok: false,
              kind: 'truncated',
              position: index + 1,
              tail: raw.slice(-TAIL_SNIPPET_LENGTH),
            };
          }
          return {
            ok: false,
            kind: 'malformed',
            position: index + 1,
            tail: raw.slice(Math.max(0, raw.length - TAIL_SNIPPET_LENGTH)),
          };
        }
      }
    }
  }

  return {
    ok: false,
    kind: 'truncated',
    position: stripped.length,
    tail: raw.slice(-TAIL_SNIPPET_LENGTH),
  };
}

function stripTrailingCommas(input: string): string {
  let result = '';
  let i = 0;
  let changed = false;
  while (i < input.length) {
    const c = input[i];
    if (c === '"') {
      result += c;
      i += 1;
      while (i < input.length) {
        const c2 = input[i];
        if (c2 === '\\') {
          result += c2;
          i += 1;
          if (i < input.length) {
            result += input[i];
            i += 1;
          }
        } else if (c2 === '"') {
          result += c2;
          i += 1;
          break;
        } else {
          result += c2;
          i += 1;
        }
      }
    } else if (c === ',') {
      let j = i + 1;
      while (j < input.length && (input[j] === ' ' || input[j] === '\n' || input[j] === '\t' || input[j] === '\r')) {
        j += 1;
      }
      if (j < input.length && (input[j] === ']' || input[j] === '}')) {
        changed = true;
        i += 1;
      } else {
        result += c;
        i += 1;
      }
    } else {
      result += c;
      i += 1;
    }
  }
  return changed ? result : input;
}

function escapeUnescapedQuotesInStrings(input: string): string {
  let result = '';
  let i = 0;
  let changed = false;
  let inString = false;
  let escaped = false;
  while (i < input.length) {
    const c = input[i];
    if (inString) {
      if (escaped) {
        result += c;
        i += 1;
        if (i < input.length) {
          result += input[i];
          i += 1;
        }
        escaped = false;
        continue;
      }
      if (c === '\\') {
        escaped = true;
        result += c;
        i += 1;
        continue;
      }
      if (c === '"') {
        let j = i + 1;
        while (
          j < input.length &&
          (input[j] === ' ' || input[j] === '\n' || input[j] === '\t' || input[j] === '\r')
        ) {
          j += 1;
        }
        const next = j < input.length ? input[j] : '';
        if (next === ',' || next === ':' || next === '}' || next === ']' || next === '') {
          inString = false;
          result += c;
          i += 1;
        } else {
          result += '\\"';
          i += 1;
          changed = true;
        }
        continue;
      }
      result += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inString = true;
      result += c;
      i += 1;
      continue;
    }
    result += c;
    i += 1;
  }
  return changed ? result : input;
}

function findAllStructuralChars(stripped: string): number[] {
  const out: number[] = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < stripped.length; i += 1) {
    const char = stripped[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{' || char === '[') out.push(i);
  }
  return out;
}

export function parseFirstJsonObject(raw: string): unknown {
  const result = parseFirstJsonObjectResult(raw);
  if (result.ok) {
    return result.value;
  }
  switch (result.kind) {
    case 'no_start':
      throw new Error('No JSON object start found in LLM output.');
    case 'truncated':
      throw new Error(
        `No complete JSON object found in LLM output (truncated at position ${result.position}).`,
      );
    case 'malformed':
      throw new Error(`LLM output contained malformed JSON near position ${result.position}.`);
  }
}

function stripJsonFence(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

function stripThinkingSections(raw: string): string {
  const tags = ['<think>', '<thinking>'] as const;
  let result = '';
  let i = 0;
  let inString = false;
  let escaped = false;
  while (i < raw.length) {
    if (inString) {
      result += raw[i];
      if (escaped) {
        escaped = false;
      } else if (raw[i] === '\\') {
        escaped = true;
      } else if (raw[i] === '"') {
        inString = false;
      }
      i += 1;
      continue;
    }
    if (raw[i] === '"') {
      inString = true;
      result += raw[i];
      i += 1;
      continue;
    }
    const tag = tags.find((t) => raw.startsWith(t, i));
    if (tag) {
      const endTag = tag === '<think>' ? '</think>' : '</thinking>';
      const endIdx = raw.indexOf(endTag, i + tag.length);
      if (endIdx === -1) {
        return result;
      }
      i = endIdx + endTag.length;
      continue;
    }
    result += raw[i];
    i += 1;
  }
  return result;
}

function looksTruncated(slice: string): boolean {
  let inString = false;
  let esc = false;
  let braceDepth = 0;
  let bracketDepth = 0;
  for (let i = 0; i < slice.length; i += 1) {
    const c = slice[i];
    if (inString) {
      if (esc) {
        esc = false;
      } else if (c === '\\') {
        esc = true;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === '{') braceDepth += 1;
    if (c === '}') braceDepth -= 1;
    if (c === '[') bracketDepth += 1;
    if (c === ']') bracketDepth -= 1;
  }
  return inString || braceDepth !== 0 || bracketDepth !== 0;
}

function indicatesTruncation(slice: string, parseErrorMessage: string): boolean {
  if (!slice) return false;

  if (slice.endsWith('\\')) return true;





  const tail = slice.trimEnd();
  if (tail.length > 0) {
    const lastChar = tail.charAt(tail.length - 1);
    if (/[A-Za-z0-9_\-]/.test(lastChar)) return true;
  }

  const m = parseErrorMessage.toLowerCase();
  if (
    m.includes('unterminated') ||
    m.includes('unexpected end of json') ||
    m.includes('unexpected non-whitespace')
  ) {
    return true;
  }
  return false;
}
