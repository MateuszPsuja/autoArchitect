import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { FormControl } from '@angular/forms';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { LlmModelsClientService } from '../../core/llm-provider';
import { PlannerConfigState, ProjectStore, defaultProviderConfigs } from '../../core/project.store';
import { ModelSelectorComponent } from './model-selector.component';

type LlmProvider = PlannerConfigState['provider'];

describe('ModelSelectorComponent', () => {
  const initialConfig: PlannerConfigState = {
    provider: 'openrouter',
    providerConfigs: defaultProviderConfigs(),
    auditRepairMaxAttempts: 1,
    parallelSectionConcurrency: 6,
    plannerMaxAttempts: 30,
    requestTimeoutMs: 90_000,
  };

  function makeControlInputs(initialProvider: LlmProvider, initialLmStudioUrl = 'http://localhost:1234/v1') {
    return {
      control: new FormControl<string>('', { nonNullable: true }),
      providerControl: new FormControl<LlmProvider>(initialProvider, { nonNullable: true }),
      customBaseUrlControl: new FormControl<string>(initialLmStudioUrl, { nonNullable: true }),
    };
  }

  function makeStore(overrides: { apiKey?: string; config?: PlannerConfigState; availableModels?: string[]; providerApiKeys?: Record<string, string> } = {}) {
    const apiKeySig = signal(overrides.apiKey ?? '');
    const configSig = signal<PlannerConfigState>(overrides.config ?? initialConfig);
    const availableModelsSig = signal<string[]>(overrides.availableModels ?? []);
    const providerApiKeys: Record<string, string> = overrides.providerApiKeys ?? {
      openrouter: overrides.apiKey ?? '',
      lmstudio: '',
      claude: '',
      chatgpt: '',
      grok: '',
      minimax: '',
    };

    return {
      store: {
        apiKey: apiKeySig,
        providerApiKeyFor: (provider: string) => providerApiKeys[provider] ?? '',
        activeConfig: () => configSig().providerConfigs[configSig().provider],
        config: configSig,
        availableModels: availableModelsSig,
        setAvailableModels: vi.fn((models: string[]) => availableModelsSig.set(models)),
        setError: vi.fn(),
      },
      apiKeySig,
      availableModelsSig,
      providerApiKeys,
    };
  }

  it('loads models for the initial provider on mount when a key is set', async () => {
    const { store } = makeStore({ apiKey: 'sk-openai-1234567890' });
    const listModels = vi.fn(() => of<string[]>(['model-a', 'model-b']));

    TestBed.configureTestingModule({
      imports: [ModelSelectorComponent],
      providers: [
        { provide: ProjectStore, useValue: store },
        { provide: LlmModelsClientService, useValue: { listModels, mapHttpError: vi.fn() } },
      ],
    });

    const inputs = makeControlInputs('openrouter');
    const fixture = TestBed.createComponent(ModelSelectorComponent);
    fixture.componentRef.setInput('control', inputs.control);
    fixture.componentRef.setInput('providerControl', inputs.providerControl);
    fixture.componentRef.setInput('customBaseUrlControl', inputs.customBaseUrlControl);
    fixture.detectChanges();
    await Promise.resolve();

    expect(listModels).toHaveBeenCalledWith('openrouter', 'sk-openai-1234567890', undefined);
    expect(store.setAvailableModels).toHaveBeenCalledWith(['model-a', 'model-b']);
  });

  it('does NOT call the API when no key is set for a key-required provider', async () => {
    const { store } = makeStore();
    const listModels = vi.fn(() => of<string[]>(['model-a']));

    TestBed.configureTestingModule({
      imports: [ModelSelectorComponent],
      providers: [
        { provide: ProjectStore, useValue: store },
        { provide: LlmModelsClientService, useValue: { listModels, mapHttpError: vi.fn() } },
      ],
    });

    const inputs = makeControlInputs('openrouter');
    const fixture = TestBed.createComponent(ModelSelectorComponent);
    fixture.componentRef.setInput('control', inputs.control);
    fixture.componentRef.setInput('providerControl', inputs.providerControl);
    fixture.componentRef.setInput('customBaseUrlControl', inputs.customBaseUrlControl);
    fixture.detectChanges();
    await Promise.resolve();

    expect(listModels).not.toHaveBeenCalled();
    expect(store.setAvailableModels).toHaveBeenCalledWith([]);
  });

  it('shows "List of models not loaded" inside the select when no key is set', async () => {
    const { store } = makeStore();
    const listModels = vi.fn(() => of<string[]>([]));

    TestBed.configureTestingModule({
      imports: [ModelSelectorComponent],
      providers: [
        { provide: ProjectStore, useValue: store },
        { provide: LlmModelsClientService, useValue: { listModels, mapHttpError: vi.fn() } },
      ],
    });

    const inputs = makeControlInputs('claude');
    const fixture = TestBed.createComponent(ModelSelectorComponent);
    fixture.componentRef.setInput('control', inputs.control);
    fixture.componentRef.setInput('providerControl', inputs.providerControl);
    fixture.componentRef.setInput('customBaseUrlControl', inputs.customBaseUrlControl);
    fixture.detectChanges();
    await Promise.resolve();

    const component = fixture.componentInstance as any;
    expect(component.placeholder()).toBe('List of models not loaded');
    expect(component.emptyMessage()).toBe('List of models not loaded');
    expect(fixture.nativeElement.textContent).not.toContain('Type to search models');
    expect(fixture.nativeElement.textContent).not.toContain('Select a model from suggestions');
  });

  it('uses "Select model" as the placeholder when the list is loaded and no model is selected', async () => {
    const { store } = makeStore({ apiKey: 'sk-openai-1234567890' });
    const listModels = vi.fn(() => of<string[]>(['openai/gpt-4o']));

    TestBed.configureTestingModule({
      imports: [ModelSelectorComponent],
      providers: [
        { provide: ProjectStore, useValue: store },
        { provide: LlmModelsClientService, useValue: { listModels, mapHttpError: vi.fn() } },
      ],
    });

    const inputs = makeControlInputs('openrouter');
    const fixture = TestBed.createComponent(ModelSelectorComponent);
    fixture.componentRef.setInput('control', inputs.control);
    fixture.componentRef.setInput('providerControl', inputs.providerControl);
    fixture.componentRef.setInput('customBaseUrlControl', inputs.customBaseUrlControl);
    fixture.detectChanges();
    await Promise.resolve();

    const component = fixture.componentInstance as any;
    expect(component.placeholder()).toBe('Select model');
    expect(component.emptyMessage()).toBe('No provider matches. Press Enter to use the typed model ID.');

    inputs.control.setValue('openai/gpt-4o');
    expect(component.placeholder()).toBe('');
  });

  it('loads models for LM Studio without a key', async () => {
    const { store } = makeStore({ config: { ...initialConfig, provider: 'lmstudio' } });
    const listModels = vi.fn(() => of<string[]>(['local-model']));

    TestBed.configureTestingModule({
      imports: [ModelSelectorComponent],
      providers: [
        { provide: ProjectStore, useValue: store },
        { provide: LlmModelsClientService, useValue: { listModels, mapHttpError: vi.fn() } },
      ],
    });

    const inputs = makeControlInputs('lmstudio');
    const fixture = TestBed.createComponent(ModelSelectorComponent);
    fixture.componentRef.setInput('control', inputs.control);
    fixture.componentRef.setInput('providerControl', inputs.providerControl);
    fixture.componentRef.setInput('customBaseUrlControl', inputs.customBaseUrlControl);
    fixture.detectChanges();
    await Promise.resolve();

    expect(listModels).toHaveBeenCalledWith('lmstudio', '', 'http://localhost:1234/v1');
  });

  it('reloads models when the provider changes', async () => {
    const { store, providerApiKeys } = makeStore({ apiKey: 'sk-openai-1234567890' });
    const listModels = vi.fn(() => of<string[]>(['claude-3-7-sonnet-latest']));

    TestBed.configureTestingModule({
      imports: [ModelSelectorComponent],
      providers: [
        { provide: ProjectStore, useValue: store },
        { provide: LlmModelsClientService, useValue: { listModels, mapHttpError: vi.fn() } },
      ],
    });

    const inputs = makeControlInputs('openrouter');
    const fixture = TestBed.createComponent(ModelSelectorComponent);
    fixture.componentRef.setInput('control', inputs.control);
    fixture.componentRef.setInput('providerControl', inputs.providerControl);
    fixture.componentRef.setInput('customBaseUrlControl', inputs.customBaseUrlControl);
    fixture.detectChanges();
    await Promise.resolve();
    expect(listModels).toHaveBeenCalledTimes(1);
    expect(listModels).toHaveBeenLastCalledWith('openrouter', 'sk-openai-1234567890', undefined);

    providerApiKeys['claude'] = 'sk-ant-1234567890';
    inputs.providerControl.setValue('claude');
    fixture.detectChanges();
    await Promise.resolve();

    expect(listModels).toHaveBeenCalledTimes(2);
    expect(listModels).toHaveBeenLastCalledWith('claude', 'sk-ant-1234567890', undefined);
  });

  it('switches to "not loaded" when the provider changes to one without a key', async () => {
    const { store, providerApiKeys } = makeStore({ apiKey: 'sk-openai-1234567890' });
    const listModels = vi.fn(() => of<string[]>(['openai/gpt-4o']));

    TestBed.configureTestingModule({
      imports: [ModelSelectorComponent],
      providers: [
        { provide: ProjectStore, useValue: store },
        { provide: LlmModelsClientService, useValue: { listModels, mapHttpError: vi.fn() } },
      ],
    });

    const inputs = makeControlInputs('openrouter');
    const fixture = TestBed.createComponent(ModelSelectorComponent);
    fixture.componentRef.setInput('control', inputs.control);
    fixture.componentRef.setInput('providerControl', inputs.providerControl);
    fixture.componentRef.setInput('customBaseUrlControl', inputs.customBaseUrlControl);
    fixture.detectChanges();
    await Promise.resolve();
    expect(listModels).toHaveBeenCalledTimes(1);

    providerApiKeys['openrouter'] = '';
    inputs.providerControl.setValue('claude');
    fixture.detectChanges();
    await Promise.resolve();

    expect(listModels).toHaveBeenCalledTimes(1);
    const component = fixture.componentInstance as any;
    expect(component.placeholder()).toBe('List of models not loaded');
    expect(component.emptyMessage()).toBe('List of models not loaded');
    expect(store.setAvailableModels).toHaveBeenLastCalledWith([]);
  });

  it('reload() triggers a fetch when a key is now available', async () => {
    const { store, providerApiKeys } = makeStore();
    const listModels = vi.fn(() => of<string[]>(['claude-3-7-sonnet-latest']));

    TestBed.configureTestingModule({
      imports: [ModelSelectorComponent],
      providers: [
        { provide: ProjectStore, useValue: store },
        { provide: LlmModelsClientService, useValue: { listModels, mapHttpError: vi.fn() } },
      ],
    });

    const inputs = makeControlInputs('claude');
    const fixture = TestBed.createComponent(ModelSelectorComponent);
    fixture.componentRef.setInput('control', inputs.control);
    fixture.componentRef.setInput('providerControl', inputs.providerControl);
    fixture.componentRef.setInput('customBaseUrlControl', inputs.customBaseUrlControl);
    fixture.detectChanges();
    await Promise.resolve();
    expect(listModels).not.toHaveBeenCalled();

    providerApiKeys['claude'] = 'sk-ant-1234567890';
    (fixture.componentInstance as any).reload();
    await Promise.resolve();

    expect(listModels).toHaveBeenCalledWith('claude', 'sk-ant-1234567890', undefined);
  });

  it('surfaces the error from listModels', async () => {
    const { store } = makeStore({ apiKey: 'sk-bad-1234567890' });
    const rawError = { status: 401, statusText: 'Unauthorized' };
    const listModels = vi.fn(() => throwError(() => rawError));

    TestBed.configureTestingModule({
      imports: [ModelSelectorComponent],
      providers: [
        { provide: ProjectStore, useValue: store },
        { provide: LlmModelsClientService, useValue: { listModels, mapHttpError: vi.fn() } },
      ],
    });

    const inputs = makeControlInputs('openrouter');
    const fixture = TestBed.createComponent(ModelSelectorComponent);
    fixture.componentRef.setInput('control', inputs.control);
    fixture.componentRef.setInput('providerControl', inputs.providerControl);
    fixture.componentRef.setInput('customBaseUrlControl', inputs.customBaseUrlControl);
    fixture.detectChanges();
    await Promise.resolve();

    expect(store.setError).toHaveBeenCalledWith(rawError);
  });
});