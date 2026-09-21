import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { MessageModule } from 'primeng/message';
import { ProjectStore } from '../../core/project.store';
import { LLM_PROVIDERS } from '../../core/llm-provider';

@Component({
  selector: 'app-clear-keys',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonModule, ConfirmDialogModule, MessageModule],
  providers: [ConfirmationService],
  template: `
    <section class="card">
      <div class="card-header">
        <h2>Clear Keys</h2>
      </div>
      <p class="help-text">
        Removes all saved API keys from this browser. Your plans, configuration, and saved
        plans are preserved. You will be prompted to enter each key again on next use.
      </p>
      <p class="count" data-testid="saved-keys-count">
        {{ savedCount() }} of {{ totalProviders }} providers have keys saved
      </p>
      <div class="actions">
        <p-button
          type="button"
          label="Clear all API keys"
          icon="pi pi-trash"
          severity="danger"
          [disabled]="savedCount() === 0"
          data-testid="clear-keys-button"
          (onClick)="onClearClick()"
        />
      </div>
      @if (successMessage(); as msg) {
        <div class="success-message">
          <p-message severity="success" [text]="msg" styleClass="w-full" />
        </div>
      }
      <p-confirmDialog />
    </section>
  `,
  styles: `
    :host {
      display: block;
    }

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

    .help-text {
      color: var(--text-color-secondary);
      font-size: 0.875rem;
      margin: 0 0 0.75rem;
    }

    .count {
      color: var(--text-color-secondary);
      font-size: 0.8125rem;
      font-variant-numeric: tabular-nums;
      margin: 0 0 1rem;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .success-message {
      margin-top: 1rem;
    }

    :host ::ng-deep .success-message .p-message-icon,
    :host ::ng-deep .success-message .p-message-close {
      display: none !important;
    }
  `,
})
export class ClearKeysComponent {
  private readonly store = inject(ProjectStore);
  private readonly confirmation = inject(ConfirmationService);

  protected readonly totalProviders = Object.keys(LLM_PROVIDERS).length;

  protected readonly savedCount = computed(
    () =>
      Object.values(this.store.providerApiKeys()).filter((key) => key.trim().length > 0)
        .length,
  );

  private readonly successSignal = signal<string | null>(null);
  protected readonly successMessage = this.successSignal.asReadonly();

  onClearClick(): void {
    if (this.savedCount() === 0) {
      return;
    }
    this.confirmation.confirm({
      header: 'Clear all API keys?',
      message:
        'This removes every saved API key from this browser. You will need to re-enter them to generate plans. This cannot be undone.',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Clear all keys',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.store.clearAllApiKeys();
        this.successSignal.set('All API keys cleared from this browser.');
      },
    });
  }
}
