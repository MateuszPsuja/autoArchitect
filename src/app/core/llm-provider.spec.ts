import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { vi } from 'vitest';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import {
  CLAUDE_DEFAULT_MODELS,
  LLM_PROVIDERS,
  LlmModelsClientService,
  createLlm,
  createLlmFromConfig,
  isModelCompatibleWithProvider,
  resolveBaseUrlWithReason,
} from './llm-provider';
import { PlannerConfigState } from './project.store';

describe('llm-provider', () => {
  const baseConfig: PlannerConfigState = {
    provider: 'openrouter',
    providerConfigs: {
      openrouter: {
        selectedModel: 'openai/gpt-4o-mini',
        customBaseUrl: 'http://localhost:1234/v1',
        defaultTemperature: 0.2,
        defaultMaxTokens: 16384,
      },
      lmstudio: {
        selectedModel: '',
        customBaseUrl: 'http://localhost:1234/v1',
        defaultTemperature: 0.2,
        defaultMaxTokens: 16384,
      },
      claude: {
        selectedModel: '',
        customBaseUrl: 'https://api.anthropic.com',
        defaultTemperature: 0.2,
        defaultMaxTokens: 16384,
      },
      chatgpt: {
        selectedModel: '',
        customBaseUrl: 'https://api.openai.com/v1',
        defaultTemperature: 0.2,
        defaultMaxTokens: 16384,
      },
      grok: {
        selectedModel: '',
        customBaseUrl: 'https://api.x.ai/v1',
        defaultTemperature: 0.2,
        defaultMaxTokens: 16384,
      },
      minimax: {
        selectedModel: '',
        customBaseUrl: 'https://api.minimax.io/v1',
        defaultTemperature: 0.2,
        defaultMaxTokens: 16384,
      },
    },
    auditRepairMaxAttempts: 1,
    parallelSectionConcurrency: 6,
    plannerMaxAttempts: 30,
    requestTimeoutMs: 90_000,
  };

  describe('LLM_PROVIDERS catalog', () => {
    it('exposes descriptors for all six providers', () => {
      expect(Object.keys(LLM_PROVIDERS)).toEqual(
        expect.arrayContaining(['openrouter', 'lmstudio', 'claude', 'chatgpt', 'grok', 'minimax']),
      );
    });

    it('marks LM Studio as the only provider that does not require an API key', () => {
      const ids = Object.values(LLM_PROVIDERS)
        .filter((d) => !d.requiresApiKey)
        .map((d) => d.id);
      expect(ids).toEqual(['lmstudio']);
    });

    it('uses a curated models strategy for Claude and http for everyone else', () => {
      expect(LLM_PROVIDERS.claude.modelsStrategy).toBe('curated');
      expect(LLM_PROVIDERS.openrouter.modelsStrategy).toBe('http');
      expect(LLM_PROVIDERS.lmstudio.modelsStrategy).toBe('http');
      expect(LLM_PROVIDERS.chatgpt.modelsStrategy).toBe('http');
      expect(LLM_PROVIDERS.grok.modelsStrategy).toBe('http');
      expect(LLM_PROVIDERS.minimax.modelsStrategy).toBe('http');
    });

    it('uses x-api-key auth for Claude and bearer auth for the others', () => {
      expect(LLM_PROVIDERS.claude.authHeaderKind).toBe('x-api-key');
      expect(LLM_PROVIDERS.openrouter.authHeaderKind).toBe('bearer');
      expect(LLM_PROVIDERS.chatgpt.authHeaderKind).toBe('bearer');
      expect(LLM_PROVIDERS.grok.authHeaderKind).toBe('bearer');
      expect(LLM_PROVIDERS.minimax.authHeaderKind).toBe('bearer');
      expect(LLM_PROVIDERS.lmstudio.authHeaderKind).toBe('none');
    });
  });

  describe('isModelCompatibleWithProvider', () => {
    it('accepts any non-empty id for LM Studio', () => {
      expect(isModelCompatibleWithProvider('anything', 'lmstudio')).toBe(true);
    });

    it('accepts only slash-prefixed ids for the openrouter provider', () => {
      expect(isModelCompatibleWithProvider('openai/gpt-4o-mini', 'openrouter')).toBe(true);
      expect(isModelCompatibleWithProvider('gpt-4o-mini', 'openrouter')).toBe(false);
    });

    it('accepts only claude-* ids for Claude', () => {
      expect(isModelCompatibleWithProvider('claude-3-7-sonnet-latest', 'claude')).toBe(true);
      expect(isModelCompatibleWithProvider('Claude-3-opus-latest', 'claude')).toBe(true);
      expect(isModelCompatibleWithProvider('gpt-4o', 'claude')).toBe(false);
    });

    it('accepts gpt/o-prefixed ids for ChatGPT', () => {
      expect(isModelCompatibleWithProvider('gpt-4o', 'chatgpt')).toBe(true);
      expect(isModelCompatibleWithProvider('o3-mini', 'chatgpt')).toBe(true);
      expect(isModelCompatibleWithProvider('claude-3-7-sonnet', 'chatgpt')).toBe(false);
    });

    it('accepts grok-* ids for Grok', () => {
      expect(isModelCompatibleWithProvider('grok-2-latest', 'grok')).toBe(true);
      expect(isModelCompatibleWithProvider('gpt-4o', 'grok')).toBe(false);
    });

    it('accepts minimax-* ids for MiniMax', () => {
      expect(isModelCompatibleWithProvider('MiniMax-M3', 'minimax')).toBe(true);
      expect(isModelCompatibleWithProvider('gpt-4o', 'minimax')).toBe(false);
    });

    it('treats empty model as compatible', () => {
      expect(isModelCompatibleWithProvider('', 'claude')).toBe(true);
      expect(isModelCompatibleWithProvider('   ', 'chatgpt')).toBe(true);
    });
  });

  describe('LlmModelsClientService.listModels', () => {
    let service: LlmModelsClientService;
    let httpMock: HttpTestingController;

    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting()],
      });
      service = TestBed.inject(LlmModelsClientService);
      httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => httpMock.verify());

    it('returns the curated Claude model list without making any HTTP request', () => {
      let received: string[] | undefined;
      service.listModels('claude', '').subscribe((models) => (received = models));
      expect(received).toEqual(CLAUDE_DEFAULT_MODELS);
      httpMock.expectNone(() => true);
    });

    it('hits openrouter /models with Bearer + HTTP-Referer headers', () => {
      let received: string[] | undefined;
      service
        .listModels('openrouter', 'sk-test-1234567890')
        .subscribe((models) => (received = models));

      const req = httpMock.expectOne('https://openrouter.ai/api/v1/models');
      expect(req.request.method).toBe('GET');
      expect(req.request.headers.get('Authorization')).toBe('Bearer sk-test-1234567890');
      expect(req.request.headers.get('HTTP-Referer')).toBe('https://localhost');
      req.flush({ data: [{ id: 'openai/gpt-4o-mini' }, { id: 'anthropic/claude-3.7-sonnet' }] });

      expect(received).toEqual(['openai/gpt-4o-mini', 'anthropic/claude-3.7-sonnet']);
    });

    it('hits ChatGPT /models with Bearer header', () => {
      let received: string[] | undefined;
      service
        .listModels('chatgpt', 'sk-openai-1234567890')
        .subscribe((models) => (received = models));

      const req = httpMock.expectOne('https://api.openai.com/v1/models');
      expect(req.request.headers.get('Authorization')).toBe('Bearer sk-openai-1234567890');
      expect(req.request.headers.get('HTTP-Referer')).toBeNull();
      req.flush({ data: [{ id: 'gpt-4o' }] });

      expect(received).toEqual(['gpt-4o']);
    });

    it('hits Grok /models with Bearer header', () => {
      service.listModels('grok', 'xai-key-1234567890').subscribe();
      const req = httpMock.expectOne('https://api.x.ai/v1/models');
      expect(req.request.headers.get('Authorization')).toBe('Bearer xai-key-1234567890');
      req.flush({ data: [] });
    });

    it('hits MiniMax /models with Bearer header', () => {
      service.listModels('minimax', 'minimax-key-1234567890').subscribe();
      const req = httpMock.expectOne('https://api.minimax.io/v1/models');
      expect(req.request.headers.get('Authorization')).toBe('Bearer minimax-key-1234567890');
      req.flush({ data: [{ id: 'MiniMax-M3' }] });
    });

    it('hits the user-provided LM Studio base URL', () => {
      service.listModels('lmstudio', '', 'http://my-lmstudio:9999/v1').subscribe();
      const req = httpMock.expectOne('http://my-lmstudio:9999/v1/models');
      expect(req.request.headers.get('Authorization')).toBeNull();
      req.flush({ data: [{ id: 'local-model' }] });
    });

    it('maps HTTP 401 to a planner auth error', () => {
      let err: any;
      service.listModels('openrouter', 'sk-test-1234567890').subscribe({
        error: (e) => (err = e),
      });
      httpMock
        .expectOne('https://openrouter.ai/api/v1/models')
        .flush({}, { status: 401, statusText: 'Unauthorized' });
      expect(err.type).toBe('auth');
      expect(err.message).toContain('Authentication failed');
    });

    it('appends the nested MiniMax/OpenAI error message when present on a 401', () => {
      let err: any;
      service.listModels('minimax', 'minimax-key-1234567890').subscribe({
        error: (e) => (err = e),
      });
      httpMock
        .expectOne('https://api.minimax.io/v1/models')
        .flush(
          { error: { message: 'login fail: token does not match group (1004)' } },
          { status: 401, statusText: 'Unauthorized' },
        );
      expect(err.type).toBe('auth');
      expect(err.message).toContain('token does not match group (1004)');
    });

    it('appends the nested message on a network-level error', () => {
      let err: any;
      service.listModels('minimax', 'minimax-key-1234567890').subscribe({
        error: (e) => (err = e),
      });
      httpMock
        .expectOne('https://api.minimax.io/v1/models')
        .flush(
          { error: { message: 'upstream unreachable' } },
          { status: 0, statusText: 'Unknown Error' },
        );
      expect(err.type).toBe('network');
      expect(err.message).toContain('upstream unreachable');
    });
  });

  describe('mapLlmError', () => {
    let service: LlmModelsClientService;

    beforeEach(() => {
      TestBed.configureTestingModule({});
      service = TestBed.inject(LlmModelsClientService);
    });

    it('maps a LangChain-style 401 with "login fail" to an auth error with the MiniMax region hint', () => {
      const err = service.mapLlmError(
        new Error(
          "401 login fail: Please carry the API secret key in the 'Authorization' field of the request header (1004)",
        ),
      );
      expect(err.type).toBe('auth');
      expect(err.message).toContain('Authentication failed');
      expect(err.message).toContain('api.minimax.io');
      expect(err.message).toContain('api.minimaxi.com');
    });

    it('maps a generic browser "Failed to fetch" to a network error', () => {
      const err = service.mapLlmError(new TypeError('Failed to fetch'));
      expect(err.type).toBe('network');
      expect(err.message).toMatch(/Network error/i);
    });

    it('maps a CORS-shaped error to a network error with a CORS hint', () => {
      const err = service.mapLlmError(
        new TypeError('NetworkError when attempting to fetch resource.'),
      );
      expect(err.type).toBe('network');
      expect(err.message).toMatch(/CORS|browser-origin|different provider|local proxy/i);
    });

    it('falls back to provider_error for unknown shapes', () => {
      const err = service.mapLlmError(new Error('something exploded'));
      expect(err.type).toBe('provider_error');
      expect(err.message).toContain('something exploded');
    });

    it('handles thrown non-Error values', () => {
      const err = service.mapLlmError('just a string');
      expect(err.type).toBe('provider_error');
      expect(err.message).toContain('Unexpected planner generation failure');
    });
  });

  describe('MiniMax', () => {
    it('builds a MiniMaxChatModel instance for the minimax provider', () => {
      const llm = createLlm({
        provider: 'minimax',
        apiKey: 'minimax-key-1234567890',
        model: 'MiniMax-M3',
        temperature: 0.2,
        maxTokens: 16384,
        customBaseUrl: '',
      });



      expect(llm.constructor.name).toBe('MiniMaxChatModel');
    });

    it('passes the China-region base URL through to MiniMaxChatModel', () => {
      const llm = createLlm({
        provider: 'minimax',
        apiKey: 'minimax-key-1234567890',
        model: 'MiniMax-M3',
        temperature: 0.2,
        maxTokens: 16384,
        customBaseUrl: 'https://api.minimaxi.com/v1',
      }) as unknown as { baseURL: string };
      expect(llm.baseURL).toBe('https://api.minimaxi.com/v1');
    });

    it('falls back to the international base URL when customBaseUrl is empty', () => {
      const llm = createLlm({
        provider: 'minimax',
        apiKey: 'minimax-key-1234567890',
        model: 'MiniMax-M3',
        temperature: 0.2,
        maxTokens: 16384,
        customBaseUrl: '',
      }) as unknown as { baseURL: string };
      expect(llm.baseURL).toBe(LLM_PROVIDERS.minimax.baseUrl);
    });

    it('ignores a stale LM Studio URL stored in customBaseUrl when the active provider is MiniMax', () => {





      const llm = createLlm({
        provider: 'minimax',
        apiKey: 'minimax-key-1234567890',
        model: 'MiniMax-M3',
        temperature: 0.2,
        maxTokens: 16384,
        customBaseUrl: 'http://localhost:1234/v1',
      }) as unknown as { baseURL: string };
      expect(llm.baseURL).toBe(LLM_PROVIDERS.minimax.baseUrl);
    });

    it('marks MiniMax as usesCustomBaseUrl so the UI exposes the Base URL field', () => {
      expect(LLM_PROVIDERS.minimax.usesCustomBaseUrl).toBe(true);
    });
  });

  describe('resolveBaseUrlWithReason', () => {



    it('returns the custom URL unchanged for non-loopback URLs on any provider', () => {
      const decision = resolveBaseUrlWithReason({
        provider: 'minimax',
        apiKey: '',
        model: '',
        customBaseUrl: 'https://api.minimaxi.com/v1',
        temperature: 0.2,
        maxTokens: 0,
        streaming: false,
      });
      expect(decision).toEqual({ url: 'https://api.minimaxi.com/v1', reason: 'custom' });
    });

    it('classifies a loopback URL on a non-LM Studio provider as loopback-ignored', () => {
      const decision = resolveBaseUrlWithReason({
        provider: 'minimax',
        apiKey: '',
        model: '',
        customBaseUrl: 'http://localhost:1234/v1',
        temperature: 0.2,
        maxTokens: 0,
        streaming: false,
      });
      expect(decision.url).toBe(LLM_PROVIDERS.minimax.baseUrl);
      expect(decision.reason).toBe('loopback-ignored');
    });

    it('allows a loopback URL when the provider is LM Studio', () => {
      const decision = resolveBaseUrlWithReason({
        provider: 'lmstudio',
        apiKey: '',
        model: '',
        customBaseUrl: 'http://localhost:1234/v1',
        temperature: 0.2,
        maxTokens: 0,
        streaming: false,
      });
      expect(decision).toEqual({ url: 'http://localhost:1234/v1', reason: 'custom' });
    });

    it('falls back to the descriptor URL when customBaseUrl is empty', () => {
      const decision = resolveBaseUrlWithReason({
        provider: 'minimax',
        apiKey: '',
        model: '',
        customBaseUrl: '   ',
        temperature: 0.2,
        maxTokens: 0,
        streaming: false,
      });
      expect(decision.url).toBe(LLM_PROVIDERS.minimax.baseUrl);
      expect(decision.reason).toBe('empty-custom');
    });

    it('classifies non-customisable providers as provider-disallows-custom', () => {
      const decision = resolveBaseUrlWithReason({
        provider: 'claude',
        apiKey: '',
        model: '',
        customBaseUrl: 'https://example.com/v1',
        temperature: 0.2,
        maxTokens: 0,
        streaming: false,
      });
      expect(decision.url).toBe(LLM_PROVIDERS.claude.baseUrl);
      expect(decision.reason).toBe('provider-disallows-custom');
    });
  });

  describe('createLlm', () => {
    it('builds a ChatAnthropic instance for Claude with the right base URL', () => {
      const llm = createLlm({
        provider: 'claude',
        apiKey: 'sk-ant-1234567890',
        model: 'claude-3-7-sonnet-latest',
        temperature: 0.2,
        maxTokens: 16384,
        customBaseUrl: '',
      });

      expect(llm).toBeInstanceOf(ChatAnthropic);
    });

    it('builds a ChatOpenAI instance for the openrouter provider', () => {
      const llm = createLlm({
        provider: 'openrouter',
        apiKey: 'sk-test-1234567890',
        model: 'openai/gpt-4o-mini',
        temperature: 0.2,
        maxTokens: 16384,
        customBaseUrl: 'http://localhost:1234/v1',
      });
      expect(llm).toBeInstanceOf(ChatOpenAI);
    });

    it('builds a ChatOpenAI instance for ChatGPT, Grok, and LM Studio', () => {
      const providers = ['chatgpt', 'grok', 'lmstudio'] as const;
      for (const provider of providers) {
        const llm = createLlm({
          provider,
          apiKey: 'k',
          model: 'm',
          temperature: 0.2,
          maxTokens: 16384,
          customBaseUrl: 'http://localhost:1234/v1',
        });
        expect(llm).toBeInstanceOf(ChatOpenAI);
      }
    });

    it('honors streaming=true when passed in', () => {
      const llm = createLlm({
        provider: 'claude',
        apiKey: 'sk-ant-1234567890',
        model: 'claude-3-7-sonnet-latest',
        temperature: 0.2,
        maxTokens: 16384,
        customBaseUrl: '',
        streaming: true,
      });
      expect((llm as unknown as { streaming?: boolean }).streaming).toBe(true);
    });
  });

  describe('MiniMaxChatModel fetch headers', () => {
    it('sends only Authorization + Content-Type on the wire (no X-Stainless-* headers)', async () => {





      const seenHeaders: Record<string, string> = {};
      const original = globalThis.fetch;
      globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const headers = init?.headers;
        if (headers instanceof Headers) {
          headers.forEach((value, key) => {
            seenHeaders[key] = value;
          });
        } else if (headers && typeof headers === 'object') {
          for (const [k, v] of Object.entries(headers)) {
            seenHeaders[k.toLowerCase()] = String(v);
          }
        }
        return new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch;

      try {
        const llm = createLlm({
          provider: 'minimax',
          apiKey: 'minimax-key-1234567890',
          model: 'MiniMax-M3',
          temperature: 0.2,
          maxTokens: 16384,
          customBaseUrl: 'https://api.minimaxi.com/v1',
        });
        const messages = [{ _getType: () => 'human', content: 'hi' } as unknown as never];
        await (llm as unknown as { invoke: (m: unknown[]) => Promise<{ content: string }> }).invoke(
          messages,
        );

        expect(seenHeaders['authorization']).toBe('Bearer minimax-key-1234567890');
        expect(seenHeaders['content-type']).toBe('application/json');

        const stainlessKeys = Object.keys(seenHeaders).filter((k) => k.startsWith('x-stainless-'));
        expect(stainlessKeys).toEqual([]);
      } finally {
        globalThis.fetch = original;
      }
    });
  });

  describe('createLlmFromConfig', () => {
    it('delegates to createLlm with the right provider values', () => {
      const cfg: PlannerConfigState = {
        ...baseConfig,
        provider: 'claude',
        providerConfigs: {
          ...baseConfig.providerConfigs,
          claude: {
            ...baseConfig.providerConfigs.claude,
            selectedModel: 'claude-3-7-sonnet-latest',
          },
        },
      };
      const llm = createLlmFromConfig(cfg, 'sk-ant-1234567890');
      expect(llm).toBeInstanceOf(ChatAnthropic);
    });

    it('passes through streaming flag from options', () => {
      const llm = createLlmFromConfig(baseConfig, 'sk-1', { streaming: true });
      expect((llm as unknown as { streaming?: boolean }).streaming).toBe(true);
    });
  });

  it('exposes the exported helper for callers that want to stub it', () => {
    expect(typeof createLlm).toBe('function');
    expect(typeof createLlmFromConfig).toBe('function');
    vi.restoreAllMocks();
  });
});
