
export function estimateTokensForText(text: string, _model = 'gpt-4o-mini'): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
