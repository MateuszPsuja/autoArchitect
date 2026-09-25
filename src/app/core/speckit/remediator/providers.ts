export interface ProviderEntry {
  canonical: string;
  variants: ReadonlyArray<string>;
}

export const PROVIDER_REGISTRY: Readonly<Record<string, ProviderEntry>> = {
  openai: { canonical: 'OpenAI', variants: ['open ai', 'openai.com', 'gpt'] },
  anthropic: { canonical: 'Anthropic', variants: ['claude', 'anthropic.com'] },
  google: { canonical: 'Google', variants: ['gemini', 'google ai', 'bard'] },
  mistral: { canonical: 'Mistral', variants: ['mistral.ai', 'mixtral'] },
  openrouter: { canonical: 'OpenRouter', variants: ['open router', 'openrouter.ai'] },
  xai: { canonical: 'xAI', variants: ['grok', 'x.ai'] },
  zhipu: { canonical: 'Zhipu', variants: ['zhipuai', 'glm', 'chatglm'] },
  minimax: { canonical: 'minimax', variants: ['minimax ai', 'minimax.ai'] },
};

export interface ProviderRewrite {
  pattern: RegExp;
  replacement: string;
}

export function buildProviderRewrites(): ProviderRewrite[] {
  const out: ProviderRewrite[] = [];
  for (const entry of Object.values(PROVIDER_REGISTRY)) {
    for (const variant of entry.variants) {
      const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out.push({
        pattern: new RegExp(`\\b${escaped}\\b`, 'gi'),
        replacement: entry.canonical,
      });
    }
  }
  return out;
}

export function rewriteProviders(md: string): string {
  let out = md;
  for (const rw of buildProviderRewrites()) {
    out = out.replace(rw.pattern, rw.replacement);
  }
  return out;
}
