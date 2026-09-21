import { Injectable, inject } from '@angular/core';
import type { BaseMessage } from '@langchain/core/messages';
import { LLM_FACTORY, LLM_PROVIDERS } from '../llm-provider';
import { parseFirstJsonObjectResult } from '../json-output-parser';
import { MarkdownRendererService } from '../markdown-renderer.service';
import { ProjectStore } from '../project.store';
import type { Plan } from '../plan.schema';
import type { RefinementAnswer, RefinementQuestion } from './refinement.schema';
import {
  RefinementChatLlmResponseSchema,
  refinementChatJsonSchema,
  type RefinementChatLlmResponse,
  type RefinementChatTurn,
} from './refinement-chat.schema';

const PER_ATTEMPT_TIMEOUT_MS = 20_000;
const TOTAL_TIMEOUT_MS = 30_000;
const PLAN_JSON_BYTE_CAP = 12 * 1024;
const MARKDOWN_BYTE_CAP = 16 * 1024;
const TRUNCATION_MARKER = '\n[truncated]';

const SYSTEM_PROMPT = [
  'You are a principal software architect helping a user iteratively refine an existing architecture plan.',
  'The user is editing the plan in the editor. Their current chat message requests a change or asks a question.',
  'You have full access to the plan JSON and any markdown files the user has edited.',
  'Decide between two actions:',
  '  - decision "ask": ask 1–5 clarifying questions when the user request is ambiguous about scope, platform, technology, deployment, security, performance, data, or non-functional requirements. Bias strongly towards asking — short, vague, or open-ended prompts (e.g. "add mobile", "make it faster", "support offline") almost always need clarification. Use single_choice when 2–5 sensible defaults exist; use free_text when the answer is open-ended.',
  '  - decision "finalize": ONLY use this when the request is precise and unambiguous, OR when the user has just answered your clarifying questions. Produce: (a) "summary": a 2–4 sentence plain-text explanation of what you understood and what will change in the plan; (b) "instruction": a concise, imperative plan instruction (≤ 280 chars) that begins with a verb (e.g. "Add", "Replace", "Remove", "Move"). Always set both summary and instruction on finalize.',
  'When in doubt, choose "ask". Never return both questions and an instruction. Never invent missing requirements silently — surface them as questions.',
  'For each single_choice question you ask, you MUST include a `recommended` field set to exactly one of the listed options — pick the safest, most common choice. For free_text questions you MAY include a `recommended` string with a sensible default; omit it only if you have no defensible default. The `recommended` value is used when the user clicks "Skip" so the assistant can act on your best guess.',
].join('\n');

export interface RefinementChatConsultInput {
  plan: Plan;
  userPrompt: string;
  history: RefinementChatTurn[];
  pendingAnswers?: RefinementAnswer[];
}

@Injectable({ providedIn: 'root' })
export class RefinementChatService {
  private readonly store = inject(ProjectStore);
  private readonly llmFactory = inject(LLM_FACTORY);
  private readonly markdownRenderer = inject(MarkdownRendererService);

  async consult(
    input: RefinementChatConsultInput,
    signal?: AbortSignal,
  ): Promise<RefinementChatLlmResponse> {
    if (signal?.aborted) {
      return { decision: 'finalize', instruction: '' };
    }

    const config = this.store.config();
    const descriptor = LLM_PROVIDERS[config.provider];
    const configuredKey = this.store.apiKey().trim();
    if (descriptor.requiresApiKey && !configuredKey) {
      return { decision: 'finalize', instruction: '' };
    }
    const apiKey = descriptor.requiresApiKey ? configuredKey : 'lm-studio';

    const prompt = this.buildPrompt(input, false);
    const strictPrompt = this.buildPrompt(input, true);

    const totalController = new AbortController();
    const totalTimer = setTimeout(() => totalController.abort(), TOTAL_TIMEOUT_MS);
    const linkAbort = (): void => totalController.abort();
    signal?.addEventListener('abort', linkAbort);

    try {
      for (const [attempt, attemptPrompt] of [prompt, strictPrompt].entries()) {
        if (totalController.signal.aborted) {
          return { decision: 'finalize', instruction: '' };
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
                  .withStructuredOutput(refinementChatJsonSchema)
                  .invoke(attemptPrompt, { signal: attemptController.signal })
              : await chat.invoke(attemptPrompt, { signal: attemptController.signal });
          const parsed = this.parseResponse(result);
          if (parsed) {
            return parsed;
          }
        } catch {
          if (totalController.signal.aborted) {
            return { decision: 'finalize', instruction: '' };
          }
        } finally {
          clearTimeout(attemptTimer);
        }
      }

      return { decision: 'finalize', instruction: '' };
    } finally {
      clearTimeout(totalTimer);
      signal?.removeEventListener('abort', linkAbort);
    }
  }

  private buildPrompt(input: RefinementChatConsultInput, strict: boolean): string {
    const projectContext = this.buildProjectContext(input.plan);
    const history = this.formatHistory(input.history, input.pendingAnswers);
    const strictInstructions = strict
      ? 'This is a retry. Return valid JSON matching the schema exactly. Do not return markdown, explanations, or an empty questions array.'
      : 'Return the structured response directly.';

    return [
      SYSTEM_PROMPT,
      strictInstructions,
      `JSON schema: ${JSON.stringify(refinementChatJsonSchema)}`,
      '',
      '## Project Context',
      projectContext,
      '',
      '## Chat History',
      history || '(no prior turns)',
      '',
      '## User Prompt',
      input.userPrompt,
    ].join('\n');
  }

  private buildProjectContext(plan: Plan): string {
    const slim = {
      meta: plan.meta,
      systemOverview: plan.systemOverview,
      boundedContexts: plan.boundedContexts,
      architectureLayerIds: plan.architectureLayers.map((layer) => ({ id: layer.id, name: layer.name })),
      domainIds: plan.domains.map((domain) => ({ id: domain.id, name: domain.name })),
      workflows: plan.workflows,
      adrs: plan.adrs,
      agentTasks: plan.agentTasks,
    };
    const fullJson = JSON.stringify(stripRefinementChats(plan));
    if (byteLength(fullJson) <= PLAN_JSON_BYTE_CAP) {
      return [
        `### Plan JSON (${byteLength(fullJson)} bytes)`,
        fullJson,
        '',
        '### User-edited Markdown',
        this.collectMarkdownOverrides(plan) || '(none)',
      ].join('\n');
    }
    const slimJson = JSON.stringify(slim);
    return [
      `### Plan Summary (${byteLength(slimJson)} bytes — full plan exceeded ${PLAN_JSON_BYTE_CAP} bytes)`,
      slimJson,
      '',
      '### User-edited Markdown',
      this.collectMarkdownOverrides(plan) || '(none)',
    ].join('\n');
  }

  private collectMarkdownOverrides(plan: Plan): string {
    const overrides = this.store.markdownOverrides();
    const overridePaths = Object.keys(overrides);
    if (overridePaths.length === 0) {
      return '';
    }
    const files = this.markdownRenderer.toMarkdownFiles(plan);
    const lookup = new Map(files.map((file) => [file.path, file.content]));
    const blocks: string[] = [];
    let total = 0;
    for (const path of overridePaths) {
      const override = overrides[path];
      const original = lookup.get(path) ?? '';
      const content = override ?? original;
      const block = `--- ${path} ---\n${content}`;
      const blockBytes = byteLength(block) + 1;
      if (total + blockBytes > MARKDOWN_BYTE_CAP) {
        blocks.push(TRUNCATION_MARKER.trim());
        break;
      }
      blocks.push(block);
      total += blockBytes;
    }
    return blocks.join('\n\n');
  }

  private formatHistory(
    history: RefinementChatTurn[],
    pendingAnswers?: RefinementAnswer[],
  ): string {
    if (history.length === 0 && (!pendingAnswers || pendingAnswers.length === 0)) {
      return '';
    }
    const lines: string[] = [];
    for (const turn of history) {
      if (turn.role === 'user') {
        lines.push(`User: ${turn.text}`);
      } else if (turn.kind === 'message') {
        lines.push(`Assistant: ${turn.text}`);
      } else if (turn.kind === 'questions') {
        lines.push(
          `Assistant questions:\n${turn.questions
            .map((q) => `  - [${q.id}] ${q.question}`)
            .join('\n')}`,
        );
      } else {
        lines.push(`Assistant finalized: ${turn.instruction || '(no instruction)'}`);
      }
    }
    if (pendingAnswers && pendingAnswers.length > 0) {
      lines.push(
        `Pending answers:\n${pendingAnswers
          .map((a) => `  - [${a.questionId}] ${a.skipped ? '(skipped)' : a.value}`)
          .join('\n')}`,
      );
    }
    return lines.join('\n');
  }

  private parseResponse(value: unknown): RefinementChatLlmResponse | null {
    const candidate = this.extractCandidate(value);
    const validation = RefinementChatLlmResponseSchema.safeParse(candidate);
    if (validation.success) {
      const response = validation.data;
      if (response.decision === 'ask' && (!response.questions || response.questions.length === 0)) {
        return { decision: 'finalize', instruction: '' };
      }
      return response;
    }
    return null;
  }

  private extractCandidate(value: unknown): unknown {
    if (value && typeof value === 'object' && 'decision' in value) {
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

function byteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).length;
  }
  return value.length;
}

function stripRefinementChats(plan: Plan): Plan {
  return { ...plan, refinementChats: [] };
}