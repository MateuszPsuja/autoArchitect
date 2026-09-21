
export const DEFAULT_MODEL_PLACEHOLDERS = {
  openrouter: 'openrouter/model-id',
  lmstudio: 'lm-studio-model-id',
  claude: 'claude-3-7-sonnet-latest',
  chatgpt: 'gpt-4o',
  grok: 'grok-2-latest',
  minimax: 'MiniMax-M3',
} as const;

export type ProviderModelPlaceholderKey = keyof typeof DEFAULT_MODEL_PLACEHOLDERS;
