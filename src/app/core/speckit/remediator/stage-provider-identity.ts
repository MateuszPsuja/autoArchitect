import { Plan } from '../../plan.schema';
import { Finding } from './remediator.types';
import { PROVIDER_REGISTRY } from './providers';

interface ProviderMismatch {
  from: string;
  to: string;
}

export function runProviderIdentityStage(
  plan: Plan,
  drafts: ReadonlyArray<{ path: string; content: string }> = [],
): Finding[] {
  const findings: Finding[] = [];
  const providerMeta = extractMetaProvider(plan);
  const corpus = drafts.length > 0
    ? drafts.map((d) => `${d.path}\n${d.content}`).join('\n')
    : JSON.stringify(plan);

  for (const [key, entry] of Object.entries(PROVIDER_REGISTRY)) {
    if (key === providerMeta) continue;
    for (const variant of entry.variants) {
      const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`\\b${escaped}\\b`, 'i');
      if (re.test(corpus)) {
        const m: ProviderMismatch = { from: variant, to: entry.canonical };
        findings.push({
          id: `STAGE-7-PROVIDER-${key.toUpperCase()}`,
          severity: 'LOW',
          message: `Non-canonical provider variant "${variant}" found — canonical form is ${entry.canonical}.`,
          fix: { kind: 'markdown-replace', payload: { replacements: [m] } },
        });
      }
    }
  }

  return findings;
}

function extractMetaProvider(plan: Plan): string {
  const provider = (plan.meta as { provider?: unknown }).provider;
  return typeof provider === 'string' ? provider.toLowerCase() : '';
}
