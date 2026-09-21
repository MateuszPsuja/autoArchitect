import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { LlmModelsClientService } from '../../core/llm-provider';
import {
  PlannerConfigState,
  ProjectStore,
  ProviderConfigsMap,
  defaultProviderConfigs,
} from '../../core/project.store';
import { ProviderConfigComponent } from './provider-config.component';

type SlotOverrides = Partial<{
  selectedModel: string;
  customBaseUrl: string;
  defaultTemperature: number;
  defaultMaxTokens: number;
}>;

function buildConfig(
  provider: PlannerConfigState['provider'],
  slot: SlotOverrides = {},
): PlannerConfigState {
  const defaults = defaultProviderConfigs();
  const providerDefaults = defaults[provider];
  const nextProviderConfigs: ProviderConfigsMap = {
    ...defaults,
    [provider]: {
      selectedModel: slot.selectedModel ?? providerDefaults.selectedModel,
      customBaseUrl: slot.customBaseUrl ?? providerDefaults.customBaseUrl,
      defaultTemperature: slot.defaultTemperature ?? providerDefaults.defaultTemperature,
      defaultMaxTokens: slot.defaultMaxTokens ?? providerDefaults.defaultMaxTokens,
    },
  };
  return {
    provider,
    providerConfigs: nextProviderConfigs,
    auditRepairMaxAttempts: 1,
    parallelSectionConcurrency: 6,
    plannerMaxAttempts: 30,
    requestTimeoutMs: 90_000,
  };
}

describe('ProviderConfigComponent', () => {
  const initialConfig: PlannerConfigState = buildConfig('openrouter');

  function setupStore(
    overrides?: Partial<{
      apiKey: string;
      config: PlannerConfigState;
      availableModels: string[];
      providerApiKeys?: Record<string, string>;
    }>,
  ) {
    const providerApiKeys: Record<string, string> = overrides?.providerApiKeys ?? {
      openrouter: overrides?.apiKey ?? '',
      lmstudio: '',
      claude: '',
      chatgpt: '',
      grok: '',
      minimax: '',
    };
    const state = {
      config: overrides?.config ?? initialConfig,
      availableModels: overrides?.availableModels ?? [],
      error: null as unknown,
    };

    const store = {
      apiKey: () => providerApiKeys[state.config.provider] ?? '',
      providerApiKeyFor: (provider: string) => providerApiKeys[provider] ?? '',
      activeConfig: () => state.config.providerConfigs[state.config.provider],
      config: () => state.config,
      availableModels: () => state.availableModels,
      error: () => state.error,
      setApiKey: vi.fn((apiKey: string, provider: string) => {
        providerApiKeys[provider] = apiKey;
      }),
      clearApiKey: vi.fn((provider?: string) => {
        const slot = provider ?? state.config.provider;
        providerApiKeys[slot] = '';
      }),
      clearAllApiKeys: vi.fn(() => {
        for (const key of Object.keys(providerApiKeys)) {
          providerApiKeys[key] = '';
        }
      }),
      setConfig: vi.fn((config: PlannerConfigState) => {
        state.config = config;
      }),
      setError: vi.fn(),
      setAvailableModels: vi.fn((models: string[]) => {
        state.availableModels = models;
      }),
    };

    return { state, store, providerApiKeys };
  }

  function setup(
    overrides?: Partial<{
      apiKey: string;
      config: PlannerConfigState;
      availableModels: string[];
      providerApiKeys?: Record<string, string>;
    }>,
  ) {
    const { store, state, providerApiKeys } = setupStore(overrides);
    const openRouterClient = {
      listModels: vi.fn(() => of(['openai/gpt-4o-mini'])),
    };

    TestBed.configureTestingModule({
      imports: [ProviderConfigComponent],
      providers: [
        { provide: ProjectStore, useValue: store },
        { provide: LlmModelsClientService, useValue: openRouterClient },
      ],
    });

    const fixture = TestBed.createComponent(ProviderConfigComponent);
    fixture.detectChanges();

    return {
      fixture,
      component: fixture.componentInstance as any,
      store,
      state,
      providerApiKeys,
      openRouterClient,
    };
  }

  it('requires a selected model before saving', () => {
    const { component, store } = setup();

    component.form.controls.apiKey.setValue('sk-live-1234567890');
    component.form.controls.selectedModel.setValue('');

    component.save();

    expect(store.setConfig).not.toHaveBeenCalled();
    expect(component.form.controls.selectedModel.touched).toBe(true);
  });

  it('allows saving with an existing in-memory provider key', () => {
    const { component, store } = setup({ apiKey: 'sk-live-existing-1234567890' });

    component.form.controls.selectedModel.setValue('openai/gpt-4o-mini');

    component.save();

    expect(store.setConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openrouter',
        providerConfigs: expect.objectContaining({
          openrouter: expect.objectContaining({ selectedModel: 'openai/gpt-4o-mini' }),
        }),
      }),
    );
    expect(store.setError).toHaveBeenCalledWith(null);
    expect(component.form.valid).toBe(true);
    expect(component.form.pristine).toBe(true);
  });

  describe('Save button dirty-state gating', () => {
    function findSaveButton(fixture: { nativeElement: HTMLElement }) {
      const buttons = Array.from(fixture.nativeElement.querySelectorAll('button'));
      return buttons.find((b) => b.textContent?.trim() === 'Save Configuration') as
        | HTMLButtonElement
        | undefined;
    }

    it('disables the Save button when the form is valid and pristine', () => {
      const { component, fixture } = setup({
        apiKey: 'sk-live-existing-1234567890',
        config: buildConfig('openrouter', { selectedModel: 'openai/gpt-4o-mini' }),
      });
      fixture.detectChanges();

      expect(component.form.valid).toBe(true);
      expect(component.form.pristine).toBe(true);

      const button = findSaveButton(fixture);
      expect(button).toBeDefined();
      expect(button!.disabled).toBe(true);
    });

    it('enables the Save button after the user edits a field', () => {
      const { component, fixture } = setup({
        apiKey: 'sk-live-existing-1234567890',
        config: buildConfig('openrouter', { selectedModel: 'openai/gpt-4o-mini' }),
      });
      fixture.detectChanges();

      const disabledButton = findSaveButton(fixture);
      expect(disabledButton!.disabled).toBe(true);

      component.form.controls.apiKey.setValue('sk-different-1234567890');
      component.form.controls.apiKey.markAsDirty();
      fixture.detectChanges();

      const enabledButton = findSaveButton(fixture);
      expect(enabledButton!.disabled).toBe(false);
    });

    it('disables the Save button again after a successful save (form returns to pristine)', () => {
      const { component, fixture } = setup({
        apiKey: 'sk-live-existing-1234567890',
        config: buildConfig('openrouter', { selectedModel: 'openai/gpt-4o-mini' }),
      });
      fixture.detectChanges();

      component.form.controls.apiKey.setValue('sk-different-1234567890');
      component.form.controls.apiKey.markAsDirty();
      fixture.detectChanges();

      const dirtyButton = findSaveButton(fixture);
      expect(dirtyButton!.disabled).toBe(false);

      component.save();
      fixture.detectChanges();

      expect(component.form.pristine).toBe(true);
      const savedButton = findSaveButton(fixture);
      expect(savedButton!.disabled).toBe(true);
    });

    it('keeps the Save button disabled when the form is invalid', () => {
      const { component, fixture } = setup();
      fixture.detectChanges();

      expect(component.form.invalid).toBe(true);
      const button = findSaveButton(fixture);
      expect(button!.disabled).toBe(true);
    });

    it('does not render the inline "Configuration saved." message', () => {
      const { component, fixture } = setup({
        apiKey: 'sk-live-existing-1234567890',
        config: buildConfig('openrouter', { selectedModel: 'openai/gpt-4o-mini' }),
      });

      component.form.controls.apiKey.setValue('sk-different-1234567890');
      component.form.controls.apiKey.markAsDirty();
      component.save();
      fixture.detectChanges();

      const confirmation = fixture.nativeElement.querySelector('[data-testid="save-confirmation"]');
      expect(confirmation).toBeNull();
    });

    it('renders the Save button with the save-button styleClass', () => {
      const { fixture } = setup({
        apiKey: 'sk-live-existing-1234567890',
        config: buildConfig('openrouter', { selectedModel: 'openai/gpt-4o-mini' }),
      });
      fixture.detectChanges();

      const button = findSaveButton(fixture);
      expect(button).toBeDefined();
      expect(button!.classList.contains('save-button')).toBe(true);
    });
  });

  describe('Saved badge in header', () => {
    function findSavedBadge(fixture: { nativeElement: HTMLElement }) {
      return fixture.nativeElement.querySelector(
        '[data-testid="saved-badge"]',
      ) as HTMLElement | null;
    }

    it('shows the "Configuration saved" badge when the form is valid and pristine', () => {
      const { component, fixture } = setup({
        apiKey: 'sk-live-existing-1234567890',
        config: buildConfig('openrouter', { selectedModel: 'openai/gpt-4o-mini' }),
      });
      fixture.detectChanges();

      expect(component.form.valid).toBe(true);
      expect(component.form.pristine).toBe(true);

      const badge = findSavedBadge(fixture);
      expect(badge).not.toBeNull();
      expect(badge?.textContent).toContain('Configuration saved');
    });

    it('hides the badge when the form is invalid', () => {
      const { component, fixture } = setup();
      fixture.detectChanges();

      expect(component.form.invalid).toBe(true);
      expect(findSavedBadge(fixture)).toBeNull();
    });

    it('hides the badge after the user edits a field', () => {
      const { component, fixture } = setup({
        apiKey: 'sk-live-existing-1234567890',
        config: buildConfig('openrouter', { selectedModel: 'openai/gpt-4o-mini' }),
      });
      fixture.detectChanges();
      expect(findSavedBadge(fixture)).not.toBeNull();

      component.form.controls.apiKey.setValue('sk-different-1234567890');
      component.form.controls.apiKey.markAsDirty();
      fixture.detectChanges();

      expect(findSavedBadge(fixture)).toBeNull();
    });

    it('shows the badge again after a successful save', () => {
      const { component, fixture } = setup({
        apiKey: 'sk-live-existing-1234567890',
        config: buildConfig('openrouter', { selectedModel: 'openai/gpt-4o-mini' }),
      });
      fixture.detectChanges();
      expect(findSavedBadge(fixture)).not.toBeNull();

      component.form.controls.apiKey.setValue('sk-different-1234567890');
      component.form.controls.apiKey.markAsDirty();
      fixture.detectChanges();
      expect(findSavedBadge(fixture)).toBeNull();

      component.save();
      fixture.detectChanges();

      expect(component.form.pristine).toBe(true);
      const badge = findSavedBadge(fixture);
      expect(badge).not.toBeNull();
      expect(badge?.textContent).toContain('Configuration saved');
    });
  });

  it('forwards slider values through setConfig with numeric coercion', () => {
    const { component, store } = setup({ apiKey: 'sk-live-existing-1234567890' });

    component.form.controls.selectedModel.setValue('openai/gpt-4o-mini');
    component.form.controls.defaultTemperature.setValue(1.5);
    component.form.controls.defaultMaxTokens.setValue(8192);

    component.save();

    expect(store.setConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        providerConfigs: expect.objectContaining({
          openrouter: expect.objectContaining({
            defaultTemperature: 1.5,
            defaultMaxTokens: 8192,
          }),
        }),
      }),
    );
  });

  it('displays the current slider values next to the sliders', () => {
    const { fixture } = setup({
      apiKey: 'sk-live-existing-1234567890',
      config: buildConfig('openrouter', { defaultTemperature: 0.7, defaultMaxTokens: 4096 }),
    });
    fixture.detectChanges();

    const temperatureValue = fixture.nativeElement.querySelector(
      '[data-testid="temperature-value"]',
    ) as HTMLElement | null;
    const maxTokensValue = fixture.nativeElement.querySelector(
      '[data-testid="max-tokens-value"]',
    ) as HTMLElement | null;

    expect(temperatureValue?.textContent?.trim()).toBe('0.7');
    expect(maxTokensValue?.textContent?.trim()).toMatch(/4[\s\u00A0,]096/);
  });

  it('shows an existing in-memory provider key when the component is recreated', () => {
    const { component } = setup({ apiKey: 'sk-live-existing-1234567890' });

    expect(component.form.controls.apiKey.value).toBe('sk-live-existing-1234567890');
  });

  it('renders the existing provider key as a masked password field by default', () => {
    const { fixture } = setup({ apiKey: 'sk-live-existing-1234567890' });
    const input = fixture.nativeElement.querySelector('#apiKey') as HTMLInputElement | null;

    expect(input).not.toBeNull();
    expect(input?.type).toBe('password');
    expect(input?.value).toBe('sk-live-existing-1234567890');
  });

  it('clears incompatible model when switching back to that provider', () => {
    const { component } = setup();

    component.form.controls.provider.setValue('lmstudio');
    component.form.controls.selectedModel.setValue('local-model');
    component.form.controls.provider.setValue('openrouter');

    expect(component.form.controls.selectedModel.value).toBe('');
  });

  describe('API key Save / Forget button', () => {
    it('shows "Save Key" when no key is in memory', () => {
      const { component } = setup();
      expect(component.keyButtonLabel()).toBe('Save Key');
      expect(component.keyButtonSeverity()).toBe('success');
    });

    it('shows "Saved" when form and store hold the same key', () => {
      const { component } = setup({ apiKey: 'sk-existing-1234567890' });

      expect(component.keyButtonLabel()).toBe('Saved');
      expect(component.keyButtonSeverity()).toBe('success');
    });

    it('shows "Forget" when the form is empty but a key is in memory', () => {
      const { component } = setup({ apiKey: 'sk-existing-1234567890' });
      component.form.controls.apiKey.setValue('');
      expect(component.keyButtonLabel()).toBe('Forget');
      expect(component.keyButtonSeverity()).toBe('danger');
    });

    it('shows "Save Key" when the form has a different value than the stored key', () => {
      const { component } = setup({ apiKey: 'sk-existing-1234567890' });
      component.form.controls.apiKey.setValue('sk-different-1234567890');
      expect(component.keyButtonLabel()).toBe('Save Key');
    });

    it('clicking "Save Key" stores the typed key under the form\'s selected provider, not the store\'s current one', () => {
      const { component, store } = setup();
      component.form.controls.provider.setValue('minimax');
      component.form.controls.apiKey.setValue('sk-new-1234567890');

      component.onKeyButtonClick();

      expect(store.setApiKey).toHaveBeenCalledWith('sk-new-1234567890', 'minimax');
    });

    it('clicking "Save Key" does nothing when the field is empty', () => {
      const { component, store } = setup();
      component.form.controls.apiKey.setValue('');

      component.onKeyButtonClick();

      expect(store.setApiKey).not.toHaveBeenCalled();
    });

    it('clicking "Forget" clears the in-memory key and the form field', () => {
      const { component, store } = setup({ apiKey: 'sk-existing-1234567890' });



      component.form.controls.apiKey.setValue('');

      component.onKeyButtonClick();

      expect(store.clearApiKey).toHaveBeenCalled();
      expect(component.form.controls.apiKey.value).toBe('');
    });

    it('clicking "Save Key" then "Forget" restores the unsaved state', () => {
      const { component, store, providerApiKeys } = setup();
      component.form.controls.apiKey.setValue('sk-new-1234567890');
      component.onKeyButtonClick();

      expect(component.keyButtonLabel()).toBe('Saved');

      component.form.controls.apiKey.setValue('');
      component.onKeyButtonClick();
      expect(providerApiKeys['openrouter']).toBe('');
      expect(component.keyButtonLabel()).toBe('Save Key');
    });

    it('does not auto-save the API key as the user types', () => {
      const { component, store } = setup();
      component.form.controls.apiKey.setValue('sk-typed-1234567890');
      expect(store.setApiKey).not.toHaveBeenCalled();
    });
  });

  describe('provider switch hydrates form from per-provider slot', () => {
    it('does NOT wipe the per-provider API keys when switching providers', () => {
      const { component, store, providerApiKeys } = setup({
        providerApiKeys: {
          openrouter: 'sk-openai-1234567890',
          claude: 'sk-ant-1234567890',
          chatgpt: 'sk-openai-9999999999',
          grok: 'xai-live-1234567890',
          minimax: 'minimax-live-1234567890',
          lmstudio: '',
        },
      });

      expect(component.form.controls.apiKey.value).toBe('sk-openai-1234567890');

      component.form.controls.provider.setValue('claude');

      expect(store.clearAllApiKeys).not.toHaveBeenCalled();
      expect(providerApiKeys['openrouter']).toBe('sk-openai-1234567890');
      expect(providerApiKeys['claude']).toBe('sk-ant-1234567890');
      expect(providerApiKeys['chatgpt']).toBe('sk-openai-9999999999');
      expect(providerApiKeys['grok']).toBe('xai-live-1234567890');
      expect(providerApiKeys['minimax']).toBe('minimax-live-1234567890');
    });

    it("hydrates the apiKey from the new provider's saved slot", () => {
      const { component } = setup({
        providerApiKeys: {
          openrouter: 'sk-openai-1234567890',
          claude: 'sk-ant-1234567890',
          chatgpt: '',
          grok: '',
          minimax: '',
          lmstudio: '',
        },
      });

      component.form.controls.provider.setValue('claude');

      expect(component.form.controls.apiKey.value).toBe('sk-ant-1234567890');
    });

    it("hydrates the custom base URL, model, temperature, and max tokens from the new provider's saved slot", () => {
      const { component } = setup({
        providerApiKeys: {
          openrouter: '',
          lmstudio: '',
          claude: 'sk-ant-1234567890',
          chatgpt: '',
          grok: '',
          minimax: '',
        },
        config: buildConfig('openrouter', {
          selectedModel: 'openai/gpt-4o-mini',
          customBaseUrl: 'http://localhost:1234/v1',
          defaultTemperature: 0.4,
          defaultMaxTokens: 9000,
        }),
      });

      component.form.controls.provider.setValue('claude');

      const claude = component.form.controls;
      expect(claude.customBaseUrl.value).toBe('https://api.anthropic.com');
      expect(claude.selectedModel.value).toBe('');
      expect(claude.defaultTemperature.value).toBeCloseTo(0.2, 5);
      expect(claude.defaultMaxTokens.value).toBe(16_384);
    });

    it('still calls setAvailableModels([]) on switch so the model autocomplete starts fresh', () => {
      const { component, store } = setup({
        availableModels: ['openai/gpt-4o-mini'],
      });

      component.form.controls.provider.setValue('claude');

      expect(store.setAvailableModels).toHaveBeenCalledWith([]);
    });

    it('restores previously-saved provider values on switch-back (no leakage)', () => {
      const { component, store } = setup({
        providerApiKeys: {
          openrouter: 'sk-openai-1234567890',
          lmstudio: '',
          claude: 'sk-ant-1234567890',
          chatgpt: '',
          grok: '',
          minimax: '',
        },
        config: buildConfig('openrouter', {
          selectedModel: 'openai/gpt-4o-mini',
          customBaseUrl: 'http://localhost:1234/v1',
          defaultTemperature: 0.3,
          defaultMaxTokens: 4096,
        }),
      });

      const configAfterSetup = store.config();
      const configWithClaude = {
        ...configAfterSetup,
        providerConfigs: {
          ...configAfterSetup.providerConfigs,
          claude: {
            selectedModel: 'claude-3-5-haiku-latest',
            customBaseUrl: 'https://api.anthropic.com',
            defaultTemperature: 0.7,
            defaultMaxTokens: 8192,
          },
        },
      } as PlannerConfigState;
      store.setConfig(configWithClaude);



      component.form.controls.provider.setValue('claude');
      expect(component.form.controls.selectedModel.value).toBe('claude-3-5-haiku-latest');
      expect(component.form.controls.defaultTemperature.value).toBeCloseTo(0.7, 5);
      expect(component.form.controls.defaultMaxTokens.value).toBe(8192);

      component.form.controls.provider.setValue('openrouter');
      expect(component.form.controls.selectedModel.value).toBe('openai/gpt-4o-mini');
      expect(component.form.controls.defaultTemperature.value).toBeCloseTo(0.3, 5);
      expect(component.form.controls.defaultMaxTokens.value).toBe(4096);
    });
  });

  describe('saveKey syncs config.provider', () => {
    it('updates config.provider when saving a key for a provider that is not the active one', () => {
      const { component, store } = setup();
      component.form.controls.provider.setValue('minimax');
      component.form.controls.apiKey.setValue('minimax-live-1234567890');

      component.saveKey();

      expect(store.setApiKey).toHaveBeenCalledWith('minimax-live-1234567890', 'minimax');
      expect(store.setConfig).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'minimax' }),
      );
    });

    it('does not call setConfig when saving a key for the already-active provider', () => {
      const { component, store } = setup();
      component.form.controls.apiKey.setValue('sk-openai-1234567890');

      component.saveKey();

      expect(store.setApiKey).toHaveBeenCalledWith('sk-openai-1234567890', 'openrouter');
      expect(store.setConfig).not.toHaveBeenCalled();
    });

    it('strips zero-width and non-breaking spaces before saving', () => {
      const { component, store } = setup();
      component.form.controls.apiKey.setValue('sk-openai-\u200B\u200C1234567890');

      component.saveKey();

      expect(store.setApiKey).toHaveBeenCalledWith('sk-openai-1234567890', 'openrouter');
    });

    it('does nothing when the cleaned key is empty', () => {
      const { component, store } = setup();
      component.form.controls.apiKey.setValue('   \u200B  ');

      component.saveKey();

      expect(store.setApiKey).not.toHaveBeenCalled();
      expect(store.setConfig).not.toHaveBeenCalled();
    });
  });

  describe('forgetKey clears the form-provider slot', () => {
    it('clears the form-provider slot, not the active config provider', () => {
      const { component, store, providerApiKeys } = setup({
        providerApiKeys: {
          openrouter: '',
          lmstudio: '',
          claude: '',
          chatgpt: '',
          grok: '',
          minimax: 'minimax-live-1234567890',
        },
        config: buildConfig('minimax'),
      });

      component.forgetKey();

      expect(store.clearApiKey).toHaveBeenCalledWith('minimax');
      expect(providerApiKeys['minimax']).toBe('');
    });
  });

  describe('with new providers (claude, chatgpt, grok, minimax)', () => {
    it('lists all six providers in the dropdown', () => {
      const { component } = setup();
      const values = component.providerOptions.map((o: { value: string }) => o.value);
      expect(values).toEqual(['openrouter', 'lmstudio', 'claude', 'chatgpt', 'grok', 'minimax']);
    });

    it.each([
      ['claude', 'claude-3-7-sonnet-latest', 'Anthropic API Key'],
      ['chatgpt', 'gpt-4o', 'OpenAI API Key'],
      ['grok', 'grok-2-latest', 'xAI API Key'],
      ['minimax', 'MiniMax-M3', 'MiniMax API Key'],
    ] as const)(
      'requires a %s API key (label "%s") before saving',
      (provider, model, apiKeyLabel) => {
        const { component, store, providerApiKeys } = setup({
          providerApiKeys: {
            openrouter: '',
            lmstudio: '',
            claude: provider === 'claude' ? 'sk-existing-1234567890' : '',
            chatgpt: provider === 'chatgpt' ? 'sk-existing-1234567890' : '',
            grok: provider === 'grok' ? 'sk-existing-1234567890' : '',
            minimax: provider === 'minimax' ? 'sk-existing-1234567890' : '',
          },
          config: buildConfig(provider, { selectedModel: model }),
        });

        providerApiKeys[provider] = '';
        component.form.controls.apiKey.setValue('');
        component.form.controls.selectedModel.setValue(model);

        component.save();

        expect(store.setConfig).not.toHaveBeenCalled();
        expect(store.setError).toHaveBeenCalledWith({
          type: 'auth',
          message: `Set your ${apiKeyLabel} before saving config.`,
        });
      },
    );

    it.each([
      ['claude', 'claude-3-7-sonnet-latest', 'sk-ant-live-1234567890'],
      ['chatgpt', 'gpt-4o', 'sk-openai-live-1234567890'],
      ['grok', 'grok-2-latest', 'xai-live-1234567890'],
      ['minimax', 'MiniMax-M3', 'minimax-live-1234567890'],
    ] as const)('allows saving %s config with a valid key', (provider, model, apiKey) => {
      const { component, store } = setup({
        config: buildConfig(provider, { selectedModel: model }),
      });

      component.form.controls.apiKey.setValue(apiKey);
      component.form.controls.selectedModel.setValue(model);

      component.save();

      expect(store.setConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          provider,
          providerConfigs: expect.objectContaining({
            [provider]: expect.objectContaining({ selectedModel: model }),
          }),
        }),
      );
      expect(store.setApiKey).toHaveBeenCalledWith(apiKey, provider);
      expect(store.setError).toHaveBeenCalledWith(null);
    });

    it('hides the API key field when LM Studio is selected', () => {
      const { fixture } = setup({ config: buildConfig('lmstudio') });
      fixture.detectChanges();

      const apiKeyField = fixture.nativeElement.querySelector(
        '.api-key-field',
      ) as HTMLElement | null;
      const customBaseUrlField = fixture.nativeElement.querySelector(
        '#customBaseUrl',
      ) as HTMLInputElement | null;
      expect(apiKeyField).toBeNull();
      expect(customBaseUrlField).not.toBeNull();
    });

    it('shows the right label per provider in the API key field', () => {
      const cases = [
        { provider: 'claude', label: 'Anthropic API Key' },
        { provider: 'chatgpt', label: 'OpenAI API Key' },
        { provider: 'grok', label: 'xAI API Key' },
        { provider: 'minimax', label: 'MiniMax API Key' },
      ] as const;

      for (const { provider, label } of cases) {
        TestBed.resetTestingModule();
        const { component } = setup({
          config: buildConfig(provider),
          apiKey: 'sk-live-1234567890',
        });
        expect(component.apiKeyLabel()).toBe(label);
      }
    });

    it('clears incompatible model when switching between providers', () => {
      const { component } = setup({
        config: buildConfig('claude', { selectedModel: 'claude-3-7-sonnet-latest' }),
      });

      component.form.controls.provider.setValue('openrouter');

      expect(component.form.controls.selectedModel.value).toBe('');
    });

    describe('loopbackUrlIgnored()', () => {
      it('returns true for a loopback customBaseUrl on a non-LM Studio provider', () => {
        const { component } = setup({
          config: buildConfig('minimax', {
            customBaseUrl: 'http://localhost:1234/v1',
          }),
        });
        expect(component.loopbackUrlIgnored()).toBe(true);
      });

      it('returns false when the loopback URL is paired with the LM Studio provider', () => {
        const { component } = setup({
          config: buildConfig('lmstudio', {
            customBaseUrl: 'http://localhost:1234/v1',
          }),
        });
        expect(component.loopbackUrlIgnored()).toBe(false);
      });

      it('returns false when the customBaseUrl is not loopback', () => {
        const { component } = setup({
          config: buildConfig('minimax', {
            customBaseUrl: 'https://api.minimaxi.com/v1',
          }),
        });
        expect(component.loopbackUrlIgnored()).toBe(false);
      });

      it('renders the loopback warning in the DOM for a stored-loopback + non-LM Studio config', () => {
        const { fixture } = setup({
          config: buildConfig('minimax', {
            customBaseUrl: 'http://localhost:1234/v1',
          }),
        });
        fixture.detectChanges();
        const warning = fixture.nativeElement.querySelector(
          '[data-testid="loopback-base-url-warning"]',
        );
        expect(warning).not.toBeNull();
        expect(warning.textContent).toContain('LM Studio');
      });
    });
  });

  describe('usernameFor()', () => {
    const providers: Array<PlannerConfigState['provider']> = [
      'openrouter',
      'claude',
      'chatgpt',
      'grok',
      'minimax',
    ];

    for (const provider of providers) {
      it(`returns autoArchitect_${provider} for ${provider}`, () => {
        const { component } = setup({ config: buildConfig(provider) });
        expect(component.usernameFor()).toBe(`autoArchitect_${provider}`);
      });
    }

    it('reflects provider changes when the user switches providers', () => {
      const { component } = setup({ config: buildConfig('openrouter') });
      expect(component.usernameFor()).toBe('autoArchitect_openrouter');

      component.form.controls.provider.setValue('claude');
      expect(component.usernameFor()).toBe('autoArchitect_claude');
    });

    it('renders the provider-specific username into the hidden autocomplete input', () => {
      const { fixture } = setup({ config: buildConfig('claude') });
      fixture.detectChanges();
      const input = fixture.nativeElement.querySelector(
        'input[name="username"][autocomplete="username"]',
      ) as HTMLInputElement | null;
      expect(input).not.toBeNull();
      expect(input!.value).toBe('autoArchitect_claude');
      expect(input!.hidden).toBe(true);
    });
  });
});
