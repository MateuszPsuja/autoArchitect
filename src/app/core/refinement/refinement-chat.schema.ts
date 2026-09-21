import { z } from 'zod';
import { RefinementQuestionSchema } from './refinement.schema';

export const REFINEMENT_CHAT_STATUS = [
  'open',
  'awaiting_answers',
  'ready',
  'applied',
  'cancelled',
] as const;
export type RefinementChatStatus = (typeof REFINEMENT_CHAT_STATUS)[number];

const RefinementChatStatusSchema = z.enum(REFINEMENT_CHAT_STATUS);

const RefinementChatUserTurnSchema = z.object({
  role: z.literal('user'),
  text: z.string().min(1),
  at: z.string().min(1),
});

const RefinementChatAssistantMessageSchema = z.object({
  role: z.literal('assistant'),
  kind: z.literal('message'),
  text: z.string().min(1),
  at: z.string().min(1),
});

const RefinementChatAssistantQuestionsSchema = z.object({
  role: z.literal('assistant'),
  kind: z.literal('questions'),
  questions: z.array(RefinementQuestionSchema).min(1).max(10),
  at: z.string().min(1),
});

const RefinementChatAssistantFinalizedSchema = z.object({
  role: z.literal('assistant'),
  kind: z.literal('finalized'),
  instruction: z.string(),
  summary: z.string().optional(),
  at: z.string().min(1),
});

export const RefinementChatTurnSchema = z.union([
  RefinementChatUserTurnSchema,
  RefinementChatAssistantMessageSchema,
  RefinementChatAssistantQuestionsSchema,
  RefinementChatAssistantFinalizedSchema,
]);
export type RefinementChatTurn = z.infer<typeof RefinementChatTurnSchema>;

export const RefinementChatSessionSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().min(1),
  status: RefinementChatStatusSchema,
  turns: z.array(RefinementChatTurnSchema).default([]),
  pendingQuestions: z.array(RefinementQuestionSchema).optional(),
  pendingAnswers: z
    .array(
      z.object({
        questionId: z.string().min(1),
        value: z.string(),
        skipped: z.boolean(),
      }),
    )
    .optional(),
  finalInstruction: z.string().optional(),
  collectedAnswers: z
    .array(
      z.object({
        questionId: z.string().min(1),
        question: z.string(),
        value: z.string(),
        skipped: z.boolean(),
      }),
    )
    .optional(),
  appliedPlanGeneratedAt: z.string().optional(),
});
export type RefinementChatSession = z.infer<typeof RefinementChatSessionSchema>;

export const RefinementChatLlmResponseSchema = z
  .object({
    decision: z.enum(['ask', 'finalize']),
    questions: z.array(RefinementQuestionSchema).optional(),
    instruction: z.string().optional(),
    rationale: z.string().optional(),
    summary: z.string().optional(),
  })
  .superRefine((value, context) => {
    if (value.decision === 'ask') {
      if (!value.questions || value.questions.length === 0) {
        context.addIssue({
          code: 'custom',
          path: ['questions'],
          message: 'decision "ask" requires a non-empty questions array.',
        });
      }
    }
    if (value.decision === 'finalize' && (value.instruction === undefined || value.instruction.length === 0)) {
      context.addIssue({
        code: 'custom',
        path: ['instruction'],
        message: 'decision "finalize" requires a non-empty instruction.',
      });
    }
  });
export type RefinementChatLlmResponse = z.infer<typeof RefinementChatLlmResponseSchema>;

export const refinementChatJsonSchema = z.toJSONSchema(RefinementChatLlmResponseSchema, {
  unrepresentable: 'any',
});