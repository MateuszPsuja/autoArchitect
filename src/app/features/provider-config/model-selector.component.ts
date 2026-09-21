import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { InputTextModule } from 'primeng/inputtext';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { ButtonModule } from 'primeng/button';
import { LlmModelsClientService, LLM_PROVIDERS } from '../../core/llm-provider';
import { ProjectStore, LlmProvider } from '../../core/project.store';
import { input } from '@angular/core';
import { startWith } from 'rxjs';

@Component({
  standalone: true,
  selector: 'app-model-selector',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, AutoCompleteModule, InputTextModule, ButtonModule],
  template: `
    <label [for]="id()" class="field-label mb-2">Model</label>

    <div class="model-row">
      <p-autoComplete
        [id]="id()"
        [formControl]="control()"
        [suggestions]="suggestions()"
        (completeMethod)="search($event)"
        [placeholder]="placeholder()"
        [forceSelection]="false"
        [minLength]="1"
        [dropdown]="true"
        [completeOnFocus]="true"
        (onFocus)="onAutocompleteFocus()"
        (onDropdownClick)="onDropdownClick()"
        [emptyMessage]="emptyMessage()"
        (onBlur)="onInputBlur()"
        inputStyleClass="w-full"
        [styleClass]="autocompleteClass()"
        class="w-full"
      ></p-autoComplete>
      <p-button
        type="button"
        icon="pi pi-refresh"
        severity="secondary"
        [text]="true"
        [loading]="loading()"
        (onClick)="reloadModels()"
        ariaLabel="Reload models"
        styleClass="reload-button"
      />
    </div>
  `,
  styles: `
    :host {
      display: contents;
    }

    .field-label {
      color: var(--text-color);
      font-size: 0.875rem;
      font-weight: 500;
    }

    .model-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .model-row p-autoComplete {
      flex: 1 1 auto;
      min-width: 0;
    }

    :host ::ng-deep .reload-button {
      flex: 0 0 auto;
    }

    :host ::ng-deep .model-select--ready.p-autocomplete .p-autocomplete-input,
    :host ::ng-deep .model-select--ready.p-autocomplete .p-autocomplete-input:hover,
    :host ::ng-deep .model-select--ready.p-autocomplete .p-autocomplete-input:focus,
    :host ::ng-deep .model-select--ready.p-autocomplete.p-autocomplete-dd .p-autocomplete-input,
    :host ::ng-deep .model-select--ready.p-autocomplete.p-autocomplete-dd .p-autocomplete-input:hover,
    :host ::ng-deep .model-select--ready.p-autocomplete.p-autocomplete-dd .p-autocomplete-input:focus {
      border-color: var(--green-500, #22c55e);
      box-shadow: 0 0 0 1px var(--green-500, #22c55e);
    }
  `,
})
export class ModelSelectorComponent implements OnInit {
  readonly id = input('model');
  readonly control = input.required<FormControl<string>>();
  readonly providerControl = input.required<FormControl<LlmProvider>>();
  readonly customBaseUrlControl = input<FormControl<string>>();

  private readonly modelsClient = inject(LlmModelsClientService);
  private readonly store = inject(ProjectStore);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly suggestions = signal<string[]>([]);
  protected readonly loading = signal(false);
  protected readonly modelsNotLoaded = signal(false);
  private readonly loadedProvider = signal<LlmProvider | null>(null);

  ngOnInit(): void {
    this.providerControl()
      .valueChanges
      .pipe(startWith(this.providerControl().value), takeUntilDestroyed(this.destroyRef))
      .subscribe((provider) => {
        if (this.loadedProvider() === provider) {
          return;
        }
        this.refreshForProvider(provider);
      });
  }

  reload(): void {
    this.refreshForProvider(this.providerControl().value);
  }

  private refreshForProvider(provider: LlmProvider): void {
    const descriptor = LLM_PROVIDERS[provider];
    if (!descriptor) {
      return;
    }

    const customBaseUrl = descriptor.usesCustomBaseUrl
      ? (this.customBaseUrlControl?.()?.value || this.store.activeConfig().customBaseUrl || '').trim()
      : undefined;





    const providerKey = this.store.providerApiKeyFor(provider);

    if (descriptor.requiresApiKey && !providerKey.trim()) {
      this.markNotLoaded(provider);
      return;
    }

    this.loadModels(provider, { customBaseUrl });
  }

  private markNotLoaded(provider: LlmProvider): void {
    this.modelsNotLoaded.set(true);
    this.loading.set(false);
    this.suggestions.set([]);
    this.store.setAvailableModels([]);
    this.store.setError(null);
    this.loadedProvider.set(provider);
    if (this.control().value) {
      this.control().setValue('', { emitEvent: false });
    }
  }

  protected placeholder(): string {
    if (this.modelsNotLoaded()) {
      return 'List of models not loaded';
    }
    if (!this.control().value) {
      return 'Select model';
    }
    return '';
  }

  protected emptyMessage(): string {
    if (this.modelsNotLoaded()) {
      return 'List of models not loaded';
    }
    return 'No provider matches. Press Enter to use the typed model ID.';
  }

  protected autocompleteClass(): string {
    return this.modelsNotLoaded() ? 'w-full model-select' : 'w-full model-select model-select--ready';
  }

  protected onInputBlur(): void {
    this.control().markAsTouched();
  }

  protected search(event: { query: string }): void {
    const q = (event?.query || '').trim();
    const provider = this.providerControl?.()?.value ?? this.store.config().provider;
    const key = this.store.providerApiKeyFor(provider);
    // eslint-disable-next-line no-console
    console.debug('[model-selector] search()', {
      provider,
      query: q,
      keyLength: key.length,
      keyHead: key.slice(0, 6),
      cached: this.store.availableModels().length,
      loadedProvider: this.loadedProvider(),
    });
    void this.loadModels(provider).then(() => {
      this.updateSuggestions(q);
    });
  }

  private async loadModels(
    provider: LlmProvider,
    overrides?: { customBaseUrl?: string },
  ): Promise<void> {
    const descriptor = LLM_PROVIDERS[provider];
    if (!descriptor) {
      return;
    }

    if (descriptor.requiresApiKey && !this.store.providerApiKeyFor(provider).trim()) {



      this.store.setError({
        type: 'auth',
        message: `Set your ${descriptor.apiKeyLabel} before loading models.`,
      });
      this.markNotLoaded(provider);
      return;
    }

    const apiKey = this.store.providerApiKeyFor(provider);
    const descriptor2 = LLM_PROVIDERS[provider];







    const rawCustomBaseUrl = (overrides?.customBaseUrl
      || this.customBaseUrlControl?.()?.value
      || this.store.activeConfig().customBaseUrl
      || '').trim();
    const isLoopback = /^(https?:)?\/\/(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?\//i.test(rawCustomBaseUrl);
    const customBaseUrl = descriptor2.usesCustomBaseUrl
      ? (provider !== 'lmstudio' && isLoopback ? undefined : rawCustomBaseUrl)
      : undefined;

    // eslint-disable-next-line no-console
    console.debug('[model-selector] loadModels → http.get', {
      provider,
      url: `${descriptor.baseUrl}/models`,
      keyLength: apiKey.length,
      keyHead: apiKey.slice(0, 6),
      keyTail: apiKey.slice(-6),
    });

    this.loading.set(true);

    return new Promise((resolve) => {
      this.modelsClient
        .listModels(provider, apiKey, customBaseUrl)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
        next: (models) => {
          this.store.setAvailableModels(models);
          this.loadedProvider.set(provider);
          this.modelsNotLoaded.set(false);
          this.store.setError(null);
          this.loading.set(false);
          resolve();
        },
        error: (err) => {
          this.store.setError(err);
          this.store.setAvailableModels([]);
          this.modelsNotLoaded.set(false);
          this.loading.set(false);
          resolve();
        },
        });
    });
  }

  protected onDropdownClick(): void {
    const provider = this.providerControl?.()?.value ?? this.store.config().provider;
    const key = this.store.providerApiKeyFor(provider);
    // eslint-disable-next-line no-console
    console.debug('[model-selector] onDropdownClick()', {
      provider,
      keyLength: key.length,
      keyHead: key.slice(0, 6),
    });

    const descriptor = LLM_PROVIDERS[provider];
    if (descriptor?.requiresApiKey && !key.trim()) {
      this.markNotLoaded(provider);
      return;
    }

    void this.loadModels(provider).then(() => {
      this.suggestions.set(this.store.availableModels().slice(0, 200));
    });
  }

  protected reloadModels(): void {
    const provider = this.providerControl?.()?.value ?? this.store.config().provider;
    const key = this.store.providerApiKeyFor(provider);
    // eslint-disable-next-line no-console
    console.debug('[model-selector] reloadModels()', {
      provider,
      keyLength: key.length,
      keyHead: key.slice(0, 6),
    });

    const descriptor = LLM_PROVIDERS[provider];
    if (!descriptor) {
      return;
    }
    this.store.setError(null);
    void this.loadModels(provider).then(() => {
      this.suggestions.set(this.store.availableModels().slice(0, 200));
    });
  }

  protected onAutocompleteFocus(): void {





    const provider = this.providerControl?.()?.value ?? this.store.config().provider;
    const key = this.store.providerApiKeyFor(provider);
    if (LLM_PROVIDERS[provider]?.requiresApiKey && !key.trim()) {
      return;
    }
    void this.loadModels(provider);
  }

  private updateSuggestions(query: string): void {
    const matches = this.filterModels(this.store.availableModels(), query);
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      this.suggestions.set(matches);
      return;
    }

    if (matches.length === 0) {
      this.suggestions.set([normalizedQuery]);
      return;
    }

    this.suggestions.set(matches);
  }

  private filterModels(models: string[], query: string): string[] {
    const normalizedQuery = query.toLowerCase();
    return models.filter((m) => m.toLowerCase().includes(normalizedQuery)).slice(0, 200);
  }
}