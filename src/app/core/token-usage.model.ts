import { z } from 'zod';

export const TokenUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  model: z.string().min(1),
  generatedAt: z.string().min(1),
  startedAt: z.string().optional(),
  llmCalls: z.number().int().nonnegative().optional(),
  errors: z.number().int().nonnegative().optional(),
  retries: z.number().int().nonnegative().optional(),
  repairs: z.number().int().nonnegative().optional(),
});

export type TokenUsage = z.infer<typeof TokenUsageSchema>;