
export function extractChunkText(chunk: unknown): string {
  if (chunk == null) return '';
  if (typeof chunk === 'string') return chunk;
  if (typeof chunk !== 'object') return '';

  const obj = chunk as Record<string, unknown>;

  const textGetter = obj['text'];
  if (typeof textGetter === 'string' && textGetter.length > 0) return textGetter;

  const content = obj['content'];

  if (typeof content === 'string' && content.length > 0) return content;

  if (Array.isArray(content)) {
    const fromBlocks = joinTextBlocks(content);
    if (fromBlocks.length > 0) return fromBlocks;
  }

  if (content && typeof content === 'object' && !Array.isArray(content)) {
    const cObj = content as Record<string, unknown>;
    const cText = cObj['text'];
    if (typeof cText === 'string' && cText.length > 0) return cText;
    const cOutputText = cObj['output_text'];
    if (typeof cOutputText === 'string' && cOutputText.length > 0) return cOutputText;
  }

  const message = obj['message'];
  if (message && typeof message === 'object') {
    const fromMessage = extractChunkText(message);
    if (fromMessage.length > 0) return fromMessage;
  }
  const delta = obj['delta'];
  if (delta && typeof delta === 'object') {
    const deltaObj = delta as Record<string, unknown>;
    const deltaContent = deltaObj['content'];
    if (typeof deltaContent === 'string' && deltaContent.length > 0) return deltaContent;
    const deltaText = deltaObj['text'];
    if (typeof deltaText === 'string' && deltaText.length > 0) return deltaText;
    const deltaOutputText = deltaObj['output_text'];
    if (typeof deltaOutputText === 'string' && deltaOutputText.length > 0) return deltaOutputText;
  }



  for (const wrapper of ['item', 'output', 'response', 'data', 'value', 'result']) {
    const inner = obj[wrapper];
    if (inner && typeof inner === 'object') {
      const fromInner = extractChunkText(inner);
      if (fromInner.length > 0) return fromInner;
    }
  }



  for (const key of Object.keys(obj)) {
    if (!/text|content|delta|chunk/i.test(key)) continue;
    const v = obj[key];
    if (typeof v === 'string' && v.length > 0 && key !== 'finish_reason' && key !== 'model') {
      return v;
    }
  }

  return '';
}

function joinTextBlocks(blocks: ReadonlyArray<unknown>): string {
  let out = '';
  for (const block of blocks) {
    if (typeof block === 'string') {
      out += block;
    } else if (block && typeof block === 'object') {
      const b = block as Record<string, unknown>;
      const bText = b['text'];
      const bOutputText = b['output_text'];
      const bType = b['type'];
      if (typeof bText === 'string') out += bText;
      else if (typeof bOutputText === 'string') out += bOutputText;
      else if (bType === 'text' && typeof bText === 'string') out += bText;
    }
  }
  return out;
}