import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { Observable, catchError, map, of, throwError } from 'rxjs';
import type { LlmProvider, PlannerConfigState } from './project.store';
import { getActiveSlot } from './project.store';
import { DEFAULT_MODEL_PLACEHOLDERS } from './model.constants';
import { PlannerError } from './planner-error.model';
import { MiniMaxChatModel } from './minimax-chat-model';

export interface LlmProviderDescriptor {
  id: LlmProvider;
  label: string;
  apiKeyLabel: string;
  placeholder: string;
  requiresApiKey: boolean;
  baseUrl: string;
  usesCustomBaseUrl: boolean;
  authHeaderKind: 'bearer' | 'x-api-key' | 'none';
  modelsStrategy: 'http' | 'curated';
}

export const LLM_PROVIDERS: Record<LlmProvider, LlmProviderDescriptor> = {
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    apiKeyLabel: 'OpenRouter API Key',
    placeholder: DEFAULT_MODEL_PLACEHOLDERS.openrouter,
    requiresApiKey: true,
    baseUrl: 'https://openrouter.ai/api/v1',
    usesCustomBaseUrl: false,
    authHeaderKind: 'bearer',
    modelsStrategy: 'http',
  },
  lmstudio: {
    id: 'lmstudio',
    label: 'LM Studio',
    apiKeyLabel: 'LM Studio API Key',
    placeholder: DEFAULT_MODEL_PLACEHOLDERS.lmstudio,
    requiresApiKey: false,
    baseUrl: 'http://localhost:1234/v1',
    usesCustomBaseUrl: true,
    authHeaderKind: 'none',
    modelsStrategy: 'http',
  },
  claude: {
    id: 'claude',
    label: 'Claude (Anthropic)',
    apiKeyLabel: 'Anthropic API Key',
    placeholder: DEFAULT_MODEL_PLACEHOLDERS.claude,
    requiresApiKey: true,
    baseUrl: 'https://api.anthropic.com',
    usesCustomBaseUrl: false,
    authHeaderKind: 'x-api-key',
    modelsStrategy: 'curated',
  },
  chatgpt: {
    id: 'chatgpt',
    label: 'ChatGPT (OpenAI)',
    apiKeyLabel: 'OpenAI API Key',
    placeholder: DEFAULT_MODEL_PLACEHOLDERS.chatgpt,
    requiresApiKey: true,
    baseUrl: 'https://api.openai.com/v1',
    usesCustomBaseUrl: false,
    authHeaderKind: 'bearer',
    modelsStrategy: 'http',
  },
  grok: {
    id: 'grok',
    label: 'Grok (xAI)',
    apiKeyLabel: 'xAI API Key',
    placeholder: DEFAULT_MODEL_PLACEHOLDERS.grok,
    requiresApiKey: true,
    baseUrl: 'https://api.x.ai/v1',
    usesCustomBaseUrl: false,
    authHeaderKind: 'bearer',
    modelsStrategy: 'http',
  },
  minimax: {
    id: 'minimax',
    label: 'MiniMax',
    apiKeyLabel: 'MiniMax API Key',
    placeholder: DEFAULT_MODEL_PLACEHOLDERS.minimax,
    requiresApiKey: true,
    baseUrl: 'https://api.minimax.io/v1',
    usesCustomBaseUrl: true,
    authHeaderKind: 'bearer',
    modelsStrategy: 'http',
  },
};

export const CLAUDE_DEFAULT_MODELS: string[] = [
  'claude-3-7-sonnet-latest',
  'claude-3-5-sonnet-latest',
  'claude-3-5-haiku-latest',
  'claude-3-opus-latest',
];

interface ProviderModelsResponse {
  data: Array<{ id: string }>;
}

@Injectable({ providedIn: 'root' })
export class LlmModelsClientService {
  private readonly http = inject(HttpClient);

  listModels(provider: LlmProvider, apiKey: string, customBaseUrl?: string): Observable<string[]> {
    const descriptor = LLM_PROVIDERS[provider];

    if (descriptor.modelsStrategy === 'curated') {
      return of(CLAUDE_DEFAULT_MODELS);
    }

    const trimmedCustom = (customBaseUrl ?? '').trim();
    let isLoopbackList = false;
    try {
      if (trimmedCustom) {
        isLoopbackList = /^localhost$|^127(?:\.\d{1,3}){3}$|^\[::1\]$/.test(
          new URL(trimmedCustom).hostname,
        );
      }
    } catch {

    }
    const baseUrl =
      descriptor.usesCustomBaseUrl && trimmedCustom && (provider === 'lmstudio' || !isLoopbackList)
        ? trimmedCustom
        : descriptor.baseUrl;
    const modelsUrl = `${baseUrl}/models`;
    const headers = this.buildHeaders(provider, apiKey);

    return this.http.get<ProviderModelsResponse>(modelsUrl, { headers }).pipe(
      map((response) => response.data.map((model) => model.id)),
      catchError((error: HttpErrorResponse) => throwError(() => this.mapHttpError(error))),
    );
  }

  mapLlmError(error: unknown): PlannerError {
    if (error instanceof HttpErrorResponse) {
      return this.mapHttpError(error);
    }

    if (error instanceof Error) {
      const msg = error.message ?? '';





      const authLike =
        /^(\d{3})\s+(login fail|authentication|invalid_api_key|incorrect api key|unauthorized|please carry the api secret key)/i;
      const rateLike =
        /^(\d{3})\s+/.test(msg) && /\b(429|quota|rate limit|tokens per min)\b/i.test(msg);
      const status401Or403 =
        /\b(401|403)\b/.test(msg) &&
        /\b(login fail|api.?key|authentic|authoriz|secret key)\b/i.test(msg);

      if (authLike.test(msg) || status401Or403) {
        const regionHint = /please carry the api secret key|login fail/i.test(msg)
          ? ' MiniMax API keys are region-scoped: an international key works against api.minimax.io, a China-region key against api.minimaxi.com. Verify the Base URL below.'
          : '';
        return {
          type: 'auth',
          message: `Authentication failed.${msg ? ` ${msg}` : ''}${regionHint}`,
        };
      }
      if (rateLike) {
        return { type: 'rate_limit', message: msg };
      }

      if (/failed to fetch|networkerror|load failed|cors/i.test(msg)) {
        return {
          type: 'network',
          message: `Network error reaching the provider. If this looks like a CORS error, the provider's API endpoint may block browser-origin requests — try a different provider or use a local proxy. (${msg})`,
        };
      }
      return { type: 'provider_error', message: msg };
    }

    return { type: 'provider_error', message: 'Unexpected planner generation failure.' };
  }

  mapHttpError(error: HttpErrorResponse): PlannerError {



    const nested = (error.error as { error?: { message?: string } } | null)?.error?.message;
    const detail = nested ? ` — ${nested}` : '';

    if (error.status === 401 || error.status === 403) {
      return { type: 'auth', message: `Authentication failed. Check your API key${detail}` };
    }

    if (error.status === 429) {
      return { type: 'rate_limit', message: `Rate limit reached. Try again shortly${detail}` };
    }

    if (error.status === 0) {
      return { type: 'network', message: `Network error. Is the provider reachable?${detail}` };
    }

    return {
      type: 'provider_error',
      message: `Provider request failed (${error.status})${detail}`,
    };
  }

  private buildHeaders(provider: LlmProvider, apiKey: string): HttpHeaders {
    const descriptor = LLM_PROVIDERS[provider];
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (descriptor.authHeaderKind === 'bearer' && apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    if (descriptor.id === 'openrouter' && apiKey) {
      headers['HTTP-Referer'] = 'https://localhost';
      headers['X-Title'] = 'Auto Architect Planner';
    }

    return new HttpHeaders(headers);
  }
}

export interface CreateLlmInput {
  provider: LlmProvider;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  customBaseUrl: string;
  streaming?: boolean;

  requestTimeoutMs?: number;

  responseFormat?: { type: string };
}

export function createLlm(input: CreateLlmInput): BaseChatModel {
  const descriptor = LLM_PROVIDERS[input.provider];

  if (input.provider === 'claude') {
    return new ChatAnthropic({
      model: input.model,
      anthropicApiKey: input.apiKey,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      streaming: input.streaming ?? false,
      clientOptions: {
        baseURL: descriptor.baseUrl,
      },
    });
  }

  if (input.provider === 'minimax') {













    return new MiniMaxChatModel({
      apiKey: input.apiKey,
      baseURL: resolveBaseUrl(input),
      model: input.model,
      temperature: input.temperature,
      maxCompletionTokens: input.maxTokens,
      requestTimeoutMs: input.requestTimeoutMs,
      responseFormat: input.responseFormat,
    });
  }

  const baseURL = resolveBaseUrl(input);

  return new ChatOpenAI({
    apiKey: input.apiKey,
    model: input.model,
    temperature: input.temperature,
    maxTokens: input.maxTokens,
    streaming: input.streaming ?? false,
    configuration: {
      baseURL,
      defaultHeaders:
        input.provider === 'openrouter'
          ? {
              'HTTP-Referer': 'https://localhost',
              'X-Title': 'Auto Architect Planner',
            }
          : undefined,
    },
  });
}

function resolveBaseUrl(input: CreateLlmInput): string {
  const decision = resolveBaseUrlWithReason(input);
  return decision.url;
}

export function resolveBaseUrlWithReason(input: CreateLlmInput): {
  url: string;
  reason: 'custom' | 'loopback-ignored' | 'provider-disallows-custom' | 'empty-custom';
} {
  const descriptor = LLM_PROVIDERS[input.provider];
  const trimmedCustomBaseUrl = input.customBaseUrl.trim();







  let isLoopbackUrl = false;
  try {
    if (trimmedCustomBaseUrl) {
      isLoopbackUrl = /^localhost$|^127(?:\.\d{1,3}){3}$|^\[::1\]$/.test(
        new URL(trimmedCustomBaseUrl).hostname,
      );
    }
  } catch {



  }
  if (!descriptor.usesCustomBaseUrl) {
    return { url: descriptor.baseUrl, reason: 'provider-disallows-custom' };
  }
  if (!trimmedCustomBaseUrl) {
    return { url: descriptor.baseUrl, reason: 'empty-custom' };
  }
  if (input.provider !== 'lmstudio' && isLoopbackUrl) {





    return { url: descriptor.baseUrl, reason: 'loopback-ignored' };
  }
  return { url: trimmedCustomBaseUrl, reason: 'custom' };
}

export function createLlmFromConfig(
  cfg: PlannerConfigState,
  apiKey: string,
  options: { streaming?: boolean; maxTokens?: number; requestTimeoutMs?: number; responseFormat?: { type: string } } = {},
): BaseChatModel {
  const slot = getActiveSlot(cfg);
  return createLlm({
    provider: cfg.provider,
    apiKey,
    model: slot.selectedModel.trim(),
    temperature: slot.defaultTemperature,
    maxTokens: options.maxTokens ?? slot.defaultMaxTokens,
    customBaseUrl: slot.customBaseUrl,
    streaming: options.streaming,
    requestTimeoutMs: options.requestTimeoutMs ?? cfg.requestTimeoutMs,
    responseFormat: options.responseFormat,
  });
}

export function isModelCompatibleWithProvider(model: string, provider: LlmProvider): boolean {
  const trimmed = model.trim();
  if (!trimmed) {
    return true;
  }

  switch (provider) {
    case 'openrouter':
      return trimmed.includes('/');
    case 'claude':
      return trimmed.toLowerCase().startsWith('claude-');
    case 'chatgpt':
      return /^(gpt-|o[0-9])/i.test(trimmed);
    case 'grok':
      return trimmed.toLowerCase().startsWith('grok-');
    case 'minimax':
      return trimmed.toLowerCase().startsWith('minimax-');
    case 'lmstudio':
      return true;
    default:
      return false;
  }
}

export const LLM_FACTORY = new InjectionToken<typeof createLlmFromConfig>('LLM_FACTORY', {
  providedIn: 'root',
  factory: () => createLlmFromConfig,
});
