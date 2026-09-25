import { rewriteProviders } from './providers';
import { runProviderIdentityStage } from './stage-provider-identity';
import { basePlanFixture } from './__fixtures__/plan-fixture';

describe('provider registry', () => {
  it('rewrites open ai to OpenAI', () => {
    expect(rewriteProviders('use open ai for completion')).toContain('OpenAI');
  });

  it('rewrites claude to Anthropic', () => {
    expect(rewriteProviders('claude powered assistant')).toContain('Anthropic');
  });

  it('keeps minimax lowercase', () => {
    expect(rewriteProviders('my minimax model handled it.')).toContain('minimax');
  });
});

describe('stage-provider-identity', () => {
  it('flags non-canonical variants in the draft corpus', () => {
    const plan = basePlanFixture();
    const drafts = [{ path: 'spec.md', content: 'Power this with open ai.' }];
    const out = runProviderIdentityStage(plan, drafts);
    expect(out.some((f) => f.id === 'STAGE-7-PROVIDER-OPENAI')).toBe(true);
  });
});
