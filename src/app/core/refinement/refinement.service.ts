import { Injectable, inject } from '@angular/core';
import type { BaseMessage } from '@langchain/core/messages';
import { LLM_FACTORY, LLM_PROVIDERS } from '../llm-provider';
import { parseFirstJsonObjectResult } from '../json-output-parser';
import { ProjectStore } from '../project.store';
import type { GeneratePromptInput } from '../prompt-builder.service';
import {
  RefinementQuestionsResponseSchema,
  refinementJsonSchema,
  type RefinementAnswerContext,
  type RefinementQuestion,
} from './refinement.schema';

const MAX_QUESTIONS = 10;
const PER_ATTEMPT_TIMEOUT_MS = 20_000;
const TOTAL_TIMEOUT_MS = 30_000;

@Injectable({ providedIn: 'root' })
export class RefinementService {
  private readonly store = inject(ProjectStore);
  private readonly llmFactory = inject(LLM_FACTORY);

  async suggestQuestions(
    input: GeneratePromptInput,
    signal?: AbortSignal,
    priorAnswers?: RefinementAnswerContext[],
  ): Promise<RefinementQuestion[]> {
    if (signal?.aborted) {
      return [];
    }

    const config = this.store.config();
    const descriptor = LLM_PROVIDERS[config.provider];
    const configuredKey = this.store.apiKey().trim();
    if (descriptor.requiresApiKey && !configuredKey) {
      return [];
    }

    const apiKey = descriptor.requiresApiKey ? configuredKey : 'lm-studio';
    const prompt = this.buildPrompt(input, false, priorAnswers);
    const strictPrompt = this.buildPrompt(input, true, priorAnswers);

    const totalController = new AbortController();
    const totalTimer = setTimeout(() => totalController.abort(), TOTAL_TIMEOUT_MS);
    const linkAbort = (): void => totalController.abort();
    signal?.addEventListener('abort', linkAbort);

    let lastError: unknown = null;
    try {
      for (const [attempt, attemptPrompt] of [prompt, strictPrompt].entries()) {
        if (totalController.signal.aborted) {
          return [];
        }

        const attemptController = new AbortController();
        const attemptTimer = setTimeout(
          () => attemptController.abort(),
          PER_ATTEMPT_TIMEOUT_MS,
        );

        try {
          const chat = this.llmFactory(config, apiKey, { streaming: false });
          const result =
            attempt === 0
              ? await chat
                  .withStructuredOutput(refinementJsonSchema)
                  .invoke(attemptPrompt, { signal: attemptController.signal })
              : await chat.invoke(attemptPrompt, { signal: attemptController.signal });
          const questions = this.parseQuestions(result);
          if (questions !== null) {
            return questions.slice(0, MAX_QUESTIONS);
          }
        } catch (err) {
          lastError = err;
          if (totalController.signal.aborted) {
            return [];
          }
        } finally {
          clearTimeout(attemptTimer);
        }
      }

      if (lastError) {
        throw lastError;
      }
      return [];
    } finally {
      clearTimeout(totalTimer);
      signal?.removeEventListener('abort', linkAbort);
    }
  }

  private buildPrompt(
    input: GeneratePromptInput,
    strict: boolean,
    priorAnswers?: RefinementAnswerContext[],
  ): string {
    const attachmentText = input.contextAttachments?.length
      ? input.contextAttachments
          .map((attachment) => `${attachment.name}:\n${attachment.extractedText}`)
          .join('\n\n')
      : 'none';
    const strictInstructions = strict
      ? 'This is a retry. Return valid JSON matching the schema exactly. Do not return markdown, explanations, or an empty questions array.'
      : 'Return the structured response directly.';

    const lines: string[] = [
      'You are a principal software architect helping refine an architecture-plan request before generation.',
      'Ask only questions whose answers would materially change the architecture, technology choices, scope, deployment, security, data, or non-functional requirements.',
      `Return between 1 and ${MAX_QUESTIONS} questions. Cover the highest-impact decisions for the architecture: deployment target, data storage, integrations, scale and reliability expectations, security boundaries, and any non-functional requirements not already stated. Each question must be answerable with a single choice or concise free text.`,
      'Use single_choice with 2 to 5 concise options when likely answers can be anticipated. Use free_text only when a short custom answer is necessary.',
      'Do not ask for information already stated. Do not ask implementation trivia or questions that can be safely inferred.',
    ];

    if (priorAnswers && priorAnswers.length > 0) {
      lines.push(
        '',
        'Prior round answers:',
        ...priorAnswers.flatMap((entry) => [
          `Q: ${entry.question}`,
          `A: ${entry.skipped ? '(skipped)' : entry.value}`,
        ]),
        'Use these to ask deeper follow-up questions only on points the user has not already resolved. Do not repeat questions that were already answered.',
      );
    }

    lines.push(
      strictInstructions,
      `JSON schema: ${JSON.stringify(refinementJsonSchema)}`,
      '',
      `Title: ${input.title}`,
      `Application idea: ${input.idea}`,
      `Technical constraints: ${input.technicalConstraints || 'none provided'}`,
      `Non-functional requirements: ${input.nfrs || 'none provided'}`,
      `Technology hints: ${input.hints || 'none provided'}`,
      `Context attachments:\n${attachmentText}`,
    );

    return lines.join('\n');
  }

  private parseQuestions(value: unknown): RefinementQuestion[] | null {
    const candidate = this.extractCandidate(value);
    const validation = RefinementQuestionsResponseSchema.safeParse(candidate);
    return validation.success ? validation.data.questions : null;
  }

  private extractCandidate(value: unknown): unknown {
    if (value && typeof value === 'object' && 'questions' in value) {
      return value;
    }

    const text = this.extractText(value);
    if (!text) {
      return null;
    }
    const parsed = parseFirstJsonObjectResult(text);
    return parsed.ok ? parsed.value : null;
  }

  private extractText(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }
    if (!value || typeof value !== 'object') {
      return '';
    }

    if ('content' in value) {
      const content = (value as BaseMessage).content;
      if (typeof content === 'string') {
        return content;
      }
      if (Array.isArray(content)) {
        return content
          .map((part) => {
            if (typeof part === 'string') return part;
            if (part && typeof part === 'object' && 'text' in part) {
              return String(part.text);
            }
            return '';
          })
          .join('');
      }
    }

    return '';
  }
}
