import { z } from 'zod';

export const RefinementQuestionTypeSchema = z.enum(['single_choice', 'free_text']);
export type RefinementQuestionType = z.infer<typeof RefinementQuestionTypeSchema>;

export const RefinementQuestionSchema = z
  .object({
    id: z.string().min(1),
    question: z.string().min(1),
    rationale: z.string().min(1).optional(),
    type: RefinementQuestionTypeSchema,
    options: z.array(z.string().min(1)).min(1).max(6).optional(),
    recommended: z.string().min(1).optional(),
  })
  .superRefine((question, context) => {
    if (question.type === 'single_choice') {
      if (!question.options) {
        context.addIssue({
          code: 'custom',
          path: ['options'],
          message: 'Single-choice questions require options.',
        });
      } else if (
        question.recommended &&
        !question.options.includes(question.recommended)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['recommended'],
          message: 'recommended must be one of the listed options.',
        });
      }
    }
  });

export const RefinementQuestionsResponseSchema = z.object({
  questions: z.array(RefinementQuestionSchema).min(1).max(10),
});

export const RefinementAnswerSchema = z.object({
  questionId: z.string().min(1),
  value: z.string(),
  skipped: z.boolean(),
});

export type RefinementQuestion = z.infer<typeof RefinementQuestionSchema>;
export type RefinementQuestionsResponse = z.infer<typeof RefinementQuestionsResponseSchema>;
export type RefinementAnswer = z.infer<typeof RefinementAnswerSchema>;

export interface RefinementAnswerContext {
  question: string;
  value: string;
  skipped: boolean;
}

export const refinementJsonSchema = z.toJSONSchema(RefinementQuestionsResponseSchema, {
  unrepresentable: 'any',
});
