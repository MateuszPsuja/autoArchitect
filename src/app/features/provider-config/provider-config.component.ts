import { ChangeDetectionStrategy, Component, DestroyRef, inject, viewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { PasswordModule } from 'primeng/password';
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { SliderModule } from 'primeng/slider';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { MessageModule } from 'primeng/message';
import { ProjectStore } from '../../core/project.store';
import { LlmProvider } from '../../core/project.store';
import {
  LLM_PROVIDERS,
  isModelCompatibleWithProvider,
  resolveBaseUrlWithReason,
} from '../../core/llm-provider';
import { ModelSelectorComponent } from './model-selector.component';
import { startWith } from 'rxjs';

@Component({
  selector: 'app-provider-config',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    DecimalPipe,
    PasswordModule,
    SelectModule,
    InputTextModule,
    SliderModule,
    ButtonModule,
    TagModule,
    MessageModule,
    ModelSelectorComponent,
  ],
  template: `
    <section class="card">
      <div class="card-header">
        <h2>Provider Configuration</h2>
        @if (form.valid && form.pristine) {
          <p-tag
            value="Configuration saved"
            severity="success"
            styleClass="saved-badge"
            data-testid="saved-badge"
          />
        }
      </div>

      @if (store.error()) {
        <div role="alert" class="config-error">
          <p-message severity="error" [text]="errorText()" styleClass="w-full" />
        </div>
      }

      <form [formGroup]="form" (ngSubmit)="save()" class="config-form">
        <div class="field">
          <label for="provider" class="field-label">Provider</label>
          <p-select
            formControlName="provider"
            inputId="provider"
            [options]="providerOptions"
            optionLabel="label"
            optionValue="value"
            styleClass="w-full"
          />
        </div>

        @if (form.controls.provider.value !== 'lmstudio') {
          <div class="field api-key-field">
            <label for="apiKey" class="field-label">{{ apiKeyLabel() }}</label>
            <div class="api-key-controls">
              <input
                type="text"
                name="username"
                [value]="usernameFor()"
                autocomplete="username"
                hidden
              />
              <p-password
                formControlName="apiKey"
                inputId="apiKey"
                [attr.aria-label]="apiKeyLabel()"
                [feedback]="false"
                [toggleMask]="true"
                autocomplete="current-password"
                styleClass="w-full"
                inputStyleClass="w-full"
              />
              <p-button
                type="button"
                [label]="keyButtonLabel()"
                [severity]="keyButtonSeverity()"
                (onClick)="onKeyButtonClick()"
              />
            </div>
          </div>
        }

        @if (showBaseUrlField()) {
          <div class="field">
            <label for="customBaseUrl" class="field-label">{{ baseUrlLabel() }}</label>
            <input
              pInputText
              id="customBaseUrl"
              type="text"
              formControlName="customBaseUrl"
              [placeholder]="baseUrlPlaceholder()"
              autocomplete="off"
              class="w-full"
            />
            @if (form.controls.provider.value === 'minimax') {
              <small class="field-hint">
                MiniMax API keys are region-scoped. International keys work against
                <code>https://api.minimax.io/v1</code>; China-region keys work against
                <code>https://api.minimaxi.com/v1</code>. Pick the one matching the account your key
                was issued under.
              </small>
            }
            @if (loopbackUrlIgnored()) {
              <p-message
                severity="warn"
                styleClass="w-full loopback-warning"
                data-testid="loopback-base-url-warning"
                text="This URL points at a local server (loopback). It will be ignored because the
                  selected provider isn't LM Studio — switch the Provider to 'LM Studio' to route
                  traffic to this address, or change the URL to the provider's official endpoint."
              />
            }
          </div>
        }

        <div class="field">
          <app-model-selector
            id="model"
            [control]="form.controls.selectedModel"
            [providerControl]="form.controls.provider"
            [customBaseUrlControl]="form.controls.customBaseUrl"
          />
        </div>

        <div class="field">
          <label for="temperature" class="field-label">Temperature</label>
          <div class="slider-row">
            <p-slider
              formControlName="defaultTemperature"
              inputId="temperature"
              [min]="0"
              [max]="2"
              [step]="0.1"
              styleClass="w-full"
            />
            <span class="slider-value" data-testid="temperature-value">
              {{ form.controls.defaultTemperature.value | number: '1.0-1' }}
            </span>
          </div>
        </div>

        <div class="field">
          <label for="maxTokens" class="field-label">Max Tokens</label>
          <div class="slider-row">
            <p-slider
              formControlName="defaultMaxTokens"
              inputId="maxTokens"
              [min]="4096"
              [max]="65536"
              [step]="1024"
              styleClass="w-full"
            />
            <span class="slider-value" data-testid="max-tokens-value">
              {{ form.controls.defaultMaxTokens.value | number: '1.0-0' }}
            </span>
          </div>
        </div>

        <div class="actions">
          <p-button
            type="submit"
            label="Save Configuration"
            styleClass="save-button"
            [disabled]="form.invalid || form.pristine"
          />
        </div>

        @if (store.availableModels().length > 0) {
          <p class="model-count">{{ store.availableModels().length }} models available</p>
        }
      </form>
    </section>
  `,
  styles: `
    .card {
      max-width: none;
      width: 100%;
    }

    .card-header {
      align-items: center;
      display: flex;
      justify-content: space-between;
      margin-bottom: 1.25rem;
    }

    .card-header h2 {
      font-size: 1.25rem;
      font-weight: 700;
      margin: 0;
    }

    .saved-badge {
      font-size: 0.75rem;
    }

    .config-error {
      margin-bottom: 1rem;
    }

    .config-form {
      display: grid;
      gap: 1.5rem;
    }

    .field {
      display: grid;
      gap: 0.375rem;
    }

    .field-label {
      color: var(--text-color);
      font-size: 0.875rem;
      font-weight: 500;
    }

    .field-hint {
      color: var(--text-color-secondary);
      display: block;
      font-size: 0.75rem;
      line-height: 1.4;
      margin-top: 0.25rem;
    }

    .loopback-warning {
      margin-top: 0.5rem;
    }

    .field-hint code {
      background: var(--surface-100);
      border-radius: 3px;
      font-size: 0.75rem;
      padding: 0 0.25rem;
    }

    .slider-row {
      align-items: center;
      display: grid;
      gap: 0.75rem;
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .slider-value {
      color: var(--text-color-secondary);
      font-size: 0.875rem;
      font-variant-numeric: tabular-nums;
      min-width: 3.5rem;
      text-align: right;
    }

    .api-key-controls {
      align-items: stretch;
      display: grid;
      gap: 0.5rem;
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .api-key-field {
      gap: 0.5rem;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 0.25rem;
    }

    :host ::ng-deep .save-button.p-button[disabled] {
      background: #6b7280;
      border-color: #6b7280;
      color: #ffffff;
      cursor: not-allowed;
      opacity: 1;
    }

    .model-count {
      color: var(--text-color-secondary);
      font-size: 0.8125rem;
      font-variant-numeric: tabular-nums;
      margin: 0;
    }

    /* Hide the two bomb-like icons PrimeNG's p-message renders: the
       severity icon (pi pi-times-circle / pi pi-exclamation-triangle) and
       the close button. The text body stays visible. */
    :host ::ng-deep .config-error .p-message-icon,
    :host ::ng-deep .config-error .p-message-close {
      display: none !important;
    }
  `,
})
export class ProviderConfigComponent {
  protected readonly store = inject(ProjectStore);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly modelSelector = viewChild(ModelSelectorComponent);
  private previousProvider!: LlmProvider;
  public static readonly MAX_TOKENS_MIN = 4_096;
  public static readonly MAX_TOKENS_MAX = 65_536;

  protected readonly providerOptions: Array<{ label: string; value: LlmProvider }> = [
    { label: LLM_PROVIDERS.openrouter.label, value: 'openrouter' },
    { label: LLM_PROVIDERS.lmstudio.label, value: 'lmstudio' },
    { label: LLM_PROVIDERS.claude.label, value: 'claude' },
    { label: LLM_PROVIDERS.chatgpt.label, value: 'chatgpt' },
    { label: LLM_PROVIDERS.grok.label, value: 'grok' },
    { label: LLM_PROVIDERS.minimax.label, value: 'minimax' },
  ];

  protected readonly form = this.fb.nonNullable.group({
    provider: [this.store.config().provider],
    apiKey: [this.store.providerApiKeyFor(this.store.config().provider), Validators.minLength(10)],
    customBaseUrl: [this.store.activeConfig().customBaseUrl, Validators.required],
    selectedModel: [this.store.activeConfig().selectedModel, Validators.required],
    defaultTemperature: [this.store.activeConfig().defaultTemperature],
    defaultMaxTokens: [this.store.activeConfig().defaultMaxTokens],
  });

  constructor() {
    const providerControl = this.form.controls.provider;
    this.previousProvider = providerControl.value;

    providerControl.valueChanges
      .pipe(startWith(providerControl.value), takeUntilDestroyed(this.destroyRef))
      .subscribe((provider) => {
        if (provider !== this.previousProvider) {
          this.store.setAvailableModels([]);







          const slot = this.store.config().providerConfigs[provider];
          this.form.controls.apiKey.setValue(this.store.providerApiKeyFor(provider));
          this.form.controls.customBaseUrl.setValue(slot.customBaseUrl);
          this.form.controls.selectedModel.setValue(slot.selectedModel);
          this.form.controls.defaultTemperature.setValue(slot.defaultTemperature);
          this.form.controls.defaultMaxTokens.setValue(slot.defaultMaxTokens);
          this.previousProvider = provider;
        }
        this.applyProviderValidators(provider);
        this.resetModelIfIncompatible(provider);
        this.modelSelector()?.reload();
      });
  }

  protected save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const { provider, apiKey, customBaseUrl, selectedModel, defaultTemperature, defaultMaxTokens } =
      this.form.controls;
    const descriptor = LLM_PROVIDERS[provider.value];
    const requiresApiKey = descriptor.requiresApiKey;

    const effectiveApiKey = (apiKey.value || this.store.providerApiKeyFor(provider.value)).trim();
    if (requiresApiKey && !effectiveApiKey) {
      apiKey.markAsTouched();
      this.store.setError({
        type: 'auth',
        message: `Set your ${descriptor.apiKeyLabel} before saving config.`,
      });
      return;
    }

    if (requiresApiKey && apiKey.value.trim()) {
      this.store.setApiKey(apiKey.value.trim(), provider.value);
    }

    const current = this.store.config();
    const nextProviderConfigs = {
      ...current.providerConfigs,
      [provider.value]: {
        selectedModel: selectedModel.value.trim(),
        customBaseUrl: customBaseUrl.value.trim(),
        defaultTemperature: Number(defaultTemperature.value),
        defaultMaxTokens: Number(defaultMaxTokens.value),
      },
    };
    this.store.setConfig({
      ...current,
      provider: provider.value,
      providerConfigs: nextProviderConfigs,
    });

    this.store.setError(null);
    this.modelSelector()?.reload();
    this.form.markAsPristine();
  }

  protected keyButtonLabel(): string {







    const inputValue = (this.form.controls.apiKey.value ?? '').trim();
    const storeValue = this.store.providerApiKeyFor(this.form.controls.provider.value).trim();
    if (inputValue) {

      return inputValue === storeValue ? 'Saved' : 'Save Key';
    }
    return storeValue ? 'Forget' : 'Save Key';
  }

  protected keyButtonSeverity(): 'danger' | 'success' | 'warn' {
    const inputValue = (this.form.controls.apiKey.value ?? '').trim();
    const storeValue = this.store.providerApiKeyFor(this.form.controls.provider.value).trim();
    if (inputValue) {



      return inputValue === storeValue ? 'success' : 'warn';
    }
    return storeValue ? 'danger' : 'success';
  }

  protected onKeyButtonClick(): void {
    const inputValue = (this.form.controls.apiKey.value ?? '').trim();
    const storeValue = this.store.providerApiKeyFor(this.form.controls.provider.value).trim();
    if (inputValue && inputValue !== storeValue) {

      this.saveKey();
      return;
    }
    if (!inputValue && storeValue) {

      this.forgetKey();
      return;
    }



    if (inputValue) {
      this.saveKey();
    }
  }

  protected saveKey(): void {





    const raw = this.form.controls.apiKey.value;
    const cleaned = (raw ?? '')
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
      .replace(/\u00A0/g, ' ')
      .trim();
    if (!cleaned) {
      this.form.controls.apiKey.markAsTouched();
      return;
    }
    const provider = this.form.controls.provider.value;
    // eslint-disable-next-line no-console
    console.debug('[provider-config] saveKey', {
      rawLength: raw?.length ?? 0,
      cleanedLength: cleaned.length,
      head: cleaned.slice(0, 6),
      tail: cleaned.slice(-6),
      provider,
    });
    this.store.setApiKey(cleaned, provider);





    const currentConfig = this.store.config();
    if (currentConfig.provider !== provider) {
      this.store.setConfig({ ...currentConfig, provider });
    }
    this.modelSelector()?.reload();
  }

  protected forgetKey(): void {
    const provider = this.form.controls.provider.value;
    this.store.clearApiKey(provider);
    this.form.controls.apiKey.setValue('');
    this.form.controls.apiKey.updateValueAndValidity();
    this.modelSelector()?.reload();
  }

  protected apiKeyLabel(): string {
    const provider = this.form.controls.provider.value;
    return LLM_PROVIDERS[provider]?.apiKeyLabel ?? 'API Key';
  }

  protected usernameFor(): string {
    return `autoArchitect_${this.form.controls.provider.value}`;
  }

  protected errorText(): string {
    const err = this.store.error();
    if (!err) return '';
    return typeof err === 'object' ? JSON.stringify(err) : String(err);
  }

  protected showBaseUrlField(): boolean {
    return LLM_PROVIDERS[this.form.controls.provider.value]?.usesCustomBaseUrl === true;
  }

  protected baseUrlLabel(): string {
    const provider = this.form.controls.provider.value;
    if (provider === 'lmstudio') return 'LM Studio Base URL';
    if (provider === 'minimax') return 'MiniMax Base URL';
    return 'Base URL';
  }

  protected baseUrlPlaceholder(): string {
    const provider = this.form.controls.provider.value;
    if (provider === 'lmstudio') return 'http://localhost:1234/v1';
    if (provider === 'minimax') return 'https://api.minimax.io/v1';
    return '';
  }

  protected loopbackUrlIgnored(): boolean {
    const provider = this.form.controls.provider.value;
    const customBaseUrl = (this.form.controls.customBaseUrl.value ?? '').trim();
    if (!customBaseUrl) return false;
    const decision = resolveBaseUrlWithReason({
      provider,
      apiKey: '',
      model: '',
      customBaseUrl,
      temperature: 0,
      maxTokens: 0,
      streaming: false,
    });
    return decision.reason === 'loopback-ignored';
  }

  private applyProviderValidators(provider: LlmProvider): void {
    const apiKeyControl = this.form.controls.apiKey;
    const customBaseUrlControl = this.form.controls.customBaseUrl;
    const descriptor = LLM_PROVIDERS[provider];

    const apiKeyValidators = [Validators.minLength(10)];
    if (descriptor.requiresApiKey && !this.store.apiKey()) {
      apiKeyValidators.unshift(Validators.required);
    }

    apiKeyControl.setValidators(apiKeyValidators);
    if (descriptor.usesCustomBaseUrl) {
      customBaseUrlControl.setValidators([Validators.required]);
    } else {
      customBaseUrlControl.clearValidators();
    }

    apiKeyControl.updateValueAndValidity({ emitEvent: false });
    customBaseUrlControl.updateValueAndValidity({ emitEvent: false });
  }

  private resetModelIfIncompatible(provider: LlmProvider): void {
    const modelControl = this.form.controls.selectedModel;
    const value = modelControl.value.trim();
    if (!value) {
      return;
    }

    const availableModels = this.store.availableModels();
    if (availableModels.length > 0 && availableModels.includes(value)) {
      return;
    }

    if (!isModelCompatibleWithProvider(value, provider)) {
      modelControl.setValue('');
      modelControl.markAsDirty();
    }
  }
}
