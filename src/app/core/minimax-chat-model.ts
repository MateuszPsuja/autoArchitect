import {
  BaseChatModel,
  type BaseChatModelParams,
  type BaseChatModelCallOptions,
} from '@langchain/core/language_models/chat_models';
import { AIMessageChunk, type BaseMessage } from '@langchain/core/messages';
import { ChatGenerationChunk, type ChatResult } from '@langchain/core/outputs';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';

interface MiniMaxChatModelInput extends BaseChatModelParams {
  apiKey: string;
  baseURL: string;
  model: string;
  temperature?: number;
  maxCompletionTokens: number;

  requestTimeoutMs?: number;

  responseFormat?: { type: string };
}

export class MiniMaxChatModel extends BaseChatModel {
  private readonly apiKey: string;
  private readonly baseURL: string;
  readonly modelName: string;
  private readonly temperatureValue: number;
  private readonly maxCompletionTokensValue: number;
  private readonly requestTimeoutMsValue: number;
  private readonly responseFormatValue: { type: string } | undefined;

  constructor(fields: MiniMaxChatModelInput) {
    super(fields);
    this.apiKey = fields.apiKey;
    this.baseURL = fields.baseURL.replace(/\/+$/, '');
    this.modelName = fields.model;
    this.temperatureValue = fields.temperature ?? 0.2;
    this.maxCompletionTokensValue = fields.maxCompletionTokens;
    this.requestTimeoutMsValue = Math.max(1000, fields.requestTimeoutMs ?? 90_000);
    this.responseFormatValue = fields.responseFormat;
  }

  _llmType(): string {
    return 'minimax';
  }

  override lc_namespace: string[] = ['langchain', 'chat_models', 'minimax'];

  override get callKeys(): string[] {
    return ['maxCompletionTokens', 'modelName', 'temperatureValue'];
  }

  override get lc_secrets(): { [key: string]: string } | undefined {
    return { apiKey: 'MINIMAX_API_KEY' };
  }

  override get lc_aliases(): Record<string, string> {
    return { apiKey: 'api_key', modelName: 'model' };
  }

  private convertMessages(messages: BaseMessage[]): Array<Record<string, unknown>> {
    return messages.map((m) => {
      const type = (m as unknown as { _getType(): string })._getType();
      const role =
        type === 'system'
          ? 'system'
          : type === 'ai'
            ? 'assistant'
            : type === 'human'
              ? 'user'
              : type === 'tool'
                ? 'tool'
                : type === 'function'
                  ? 'function'
                  : type;
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      const out: Record<string, unknown> = { role, content };
      const toolCallId = (m as unknown as { tool_call_id?: string }).tool_call_id;
      if (type === 'tool' && toolCallId) {
        out['tool_call_id'] = toolCallId;
      }
      const name = (m as unknown as { name?: string }).name;
      if (type === 'function' && name) {
        out['name'] = name;
      }
      return out;
    });
  }

  private createTimeoutSignal(parent: AbortSignal | undefined): {
    signal: AbortSignal;
    cleanup: () => void;
  } {
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), this.requestTimeoutMsValue);
    const composed = parent
      ? AbortSignal.any([parent, timeoutController.signal])
      : timeoutController.signal;
    return {
      signal: composed,
      cleanup: () => clearTimeout(timer),
    };
  }

  override async _generate(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
  ): Promise<ChatResult> {
    const body: Record<string, unknown> = {
      model: this.modelName,
      messages: this.convertMessages(messages),
      temperature: this.temperatureValue,
      max_completion_tokens: this.maxCompletionTokensValue,
    };
    if (this.responseFormatValue) {
      body['response_format'] = this.responseFormatValue;
    }
    const { signal, cleanup } = this.createTimeoutSignal(options.signal);
    let response: Response;
    try {
      response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
    } finally {
      cleanup();
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `MiniMax chat completion failed: ${response.status} ${response.statusText} — ${text}`,
      );
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    };
    const content = data.choices?.[0]?.message?.content ?? '';
    const finishReason = data.choices?.[0]?.finish_reason;
    const message = new AIMessageChunk({
      content,
      response_metadata: finishReason ? { finish_reason: finishReason } : undefined,
    });
    return {
      generations: [{ message, text: content } as unknown as ChatGenerationChunk],
      llmOutput: finishReason ? { finish_reason: finishReason } : {},
    };
  }

  override async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const body: Record<string, unknown> = {
      model: this.modelName,
      messages: this.convertMessages(messages),
      temperature: this.temperatureValue,
      max_completion_tokens: this.maxCompletionTokensValue,
      stream: true,
    };
    if (this.responseFormatValue) {
      body['response_format'] = this.responseFormatValue;
    }
    const { signal, cleanup } = this.createTimeoutSignal(options.signal);
    let response: Response;
    try {
      response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
    } finally {
      cleanup();
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `MiniMax chat stream failed: ${response.status} ${response.statusText} — ${text}`,
      );
    }
    if (!response.body) {
      throw new Error('MiniMax chat stream returned an empty body.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lastFinishReason: string | undefined;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '' || payload === '[DONE]') {
          if (payload === '[DONE]') {
            if (lastFinishReason) {
              yield new ChatGenerationChunk({
                message: new AIMessageChunk({
                  content: '',
                  response_metadata: { finish_reason: lastFinishReason },
                }),
                text: '',
              });
            }
            return;
          }
          continue;
        }
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{
              delta?: { content?: string };
              finish_reason?: string;
            }>;
          };
          const choice = parsed.choices?.[0];
          if (choice?.finish_reason) {
            lastFinishReason = choice.finish_reason;
          }
          const content = choice?.delta?.content;
          if (typeof content === 'string' && content.length > 0) {
            const message = new AIMessageChunk({ content });
            const chunk = new ChatGenerationChunk({
              message,
              text: content,
            });
            yield chunk;
            await runManager?.handleLLMNewToken(content);
          }
        } catch {

        }
      }
    }
    if (lastFinishReason) {
      yield new ChatGenerationChunk({
        message: new AIMessageChunk({
          content: '',
          response_metadata: { finish_reason: lastFinishReason },
        }),
        text: '',
      });
    }
  }
}
