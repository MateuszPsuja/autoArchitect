import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TokenUsage } from '../../../core/token-usage.model';

@Component({
  selector: 'app-export-pdf-stats',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  template: `
    @if (visible()) {
      <section
        class="pdf-stats"
        [class.pdf-stats--active]="active()"
        aria-live="polite"
        aria-atomic="true"
      >
        <p class="pdf-stats-label">
          @if (active()) {
            <span class="pdf-stats-spinner" aria-hidden="true">
              <i class="pi pi-spin pi-spinner"></i>
            </span>
            Generating PDF…
          } @else if (done()) {
            PDF ready
          } @else {
            PDF statistics
          }
        </p>

        @if (stats(); as s) {
          <div class="pdf-stats-grid">
            <div class="pdf-stats-row">
              <span class="pdf-stats-key">Model</span>
              <span class="pdf-stats-value">{{ s.model }}</span>
            </div>
            <div class="pdf-stats-row">
              <span class="pdf-stats-key">Prompt tokens</span>
              <span class="pdf-stats-value">{{ s.promptTokens }}</span>
            </div>
            <div class="pdf-stats-row">
              <span class="pdf-stats-key">Completion tokens</span>
              <span class="pdf-stats-value">{{ s.completionTokens }}</span>
            </div>
            <div class="pdf-stats-row">
              <span class="pdf-stats-key">Total tokens</span>
              <span class="pdf-stats-value">{{ s.totalTokens }}</span>
            </div>
            <div class="pdf-stats-row">
              <span class="pdf-stats-key">Duration</span>
              <span class="pdf-stats-value">{{ durationLabel() }}</span>
            </div>
            <div class="pdf-stats-row">
              <span class="pdf-stats-key">Rate</span>
              <span class="pdf-stats-value">{{ rateLabel() }}</span>
            </div>
            @if (active() && etaLabel(); as eta) {
              <div class="pdf-stats-row">
                <span class="pdf-stats-key">ETA</span>
                <span class="pdf-stats-value">{{ eta }}</span>
              </div>
            }
            <div class="pdf-stats-row">
              <span class="pdf-stats-key">LLM calls</span>
              <span class="pdf-stats-value">{{ s.llmCalls ?? 0 }}</span>
            </div>
            @if (!active() && s.generatedAt) {
              <div class="pdf-stats-row">
                <span class="pdf-stats-key">Generated at</span>
                <span class="pdf-stats-value">{{ s.generatedAt | date: 'short' }}</span>
              </div>
            }
          </div>
        }
      </section>
    }
  `,
  styleUrl: './export-pdf-stats.component.scss',
})
export class ExportPdfStatsComponent {
  readonly stats = input<TokenUsage | null>(null);
  readonly active = input(false);
  readonly done = input(false);
  readonly durationLabel = input('');
  readonly rateLabel = input('');
  readonly etaLabel = input<string | null>(null);

  protected readonly visible = computed(() => this.stats() !== null || this.active());
}
