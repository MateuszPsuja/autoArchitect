import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { RunStreamHost } from '../../core/streaming/run-stream-host.service';
import { ProjectStore } from '../../core/project.store';

@Component({
  selector: 'app-generate-plan-stats',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, ButtonModule, MessageModule],
  template: `
    @if (stats(); as s) {
      <div class="stats-section" aria-label="Generation statistics">
        <div class="stats-header">
          <p class="stats-label">Generation statistics</p>
        </div>
        <div class="stats-grid">
          <div class="stats-row">
            <span class="stats-key">Model</span>
            <span class="stats-value">{{ s.model }}</span>
          </div>
          <div class="stats-row">
            <span class="stats-key">Duration</span>
            <span class="stats-value">{{ formatDuration(s.durationMs) }}</span>
          </div>
          <div class="stats-row">
            <span class="stats-key">LLM calls</span>
            <span class="stats-value">{{ s.llmCalls }}</span>
          </div>
          <div class="stats-row">
            <span class="stats-key">Prompt tokens</span>
            <span class="stats-value">{{ s.promptTokens }}</span>
          </div>
          <div class="stats-row">
            <span class="stats-key">Completion tokens</span>
            <span class="stats-value">{{ s.completionTokens }}</span>
          </div>
          <div class="stats-row">
            <span class="stats-key">Total tokens</span>
            <span class="stats-value">{{ s.totalTokens }}</span>
          </div>
          <div class="stats-row">
            <span class="stats-key">Rate</span>
            <span class="stats-value">{{ formatRate(s.tokensPerSecond) }}</span>
          </div>
          <div class="stats-row">
            <span class="stats-key">ETA</span>
            <span class="stats-value">{{ formatEta(s.etaSeconds) }}</span>
          </div>
          <div
            class="stats-row"
            [class.stats-row-warning]="s.errors > 0"
            [attr.aria-label]="s.errors + ' errors recovered'"
          >
            <span class="stats-key">Errors</span>
            <span class="stats-value">{{ s.errors }}</span>
          </div>
          <div class="stats-row">
            <span class="stats-key">Retries</span>
            <span class="stats-value">{{ s.retries }}</span>
          </div>
          <div class="stats-row">
            <span class="stats-key">Repairs</span>
            <span class="stats-value">{{ s.repairs }}</span>
          </div>
          @if (s.generatedAt) {
            <div class="stats-row">
              <span class="stats-key">GeneratedAt</span>
              <span class="stats-value">{{ s.generatedAt | date: 'short' }}</span>
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }

    .stats-section {
      background: var(--surface-ground);
      border: 1px solid var(--surface-border);
      border-radius: var(--radius-md);
      padding: 0.875rem;
    }

    .stats-label {
      color: var(--text-muted);
      font-size: 0.72rem;
      font-weight: 600;
      letter-spacing: 0.08em;
      margin: 0;
      text-transform: uppercase;
    }

    .stats-header {
      align-items: center;
      display: flex;
      gap: 0.75rem;
      justify-content: space-between;
      margin-bottom: 0.5rem;
    }

    .stats-grid {
      column-gap: 1.5rem;
      display: grid;
      grid-template-columns: 1fr 1fr;
      row-gap: 0.4rem;
    }

    .stats-row {
      align-items: baseline;
      display: flex;
      gap: 0.75rem;
      justify-content: space-between;
    }

    .stats-key {
      color: var(--text-muted);
      font-size: 0.8rem;
    }

    .stats-value {
      font-feature-settings: 'tnum';
      font-variant-numeric: tabular-nums;
      font-weight: 500;
    }

    .stats-row-warning .stats-value {
      color: var(--orange-500, #f59e0b);
    }
  `,
})
export class GeneratePlanStatsComponent {
  private readonly store = inject(ProjectStore);
  private readonly streamHost = inject(RunStreamHost);

  protected readonly stats = computed(() => {
    this.streamHost.tick();
    const ts = this.store.tokenStats();
    if (!ts) return null;
    const startedAtMs = ts.startedAt ? new Date(ts.startedAt).getTime() : null;
    const durationMs = startedAtMs ? Math.max(0, Date.now() - startedAtMs) : 0;

    const now = Date.now();
    const cutoff = now - 5_000;
    const recent = this.streamHost.chunkTimestamps().filter((t) => t >= cutoff);
    let tokensPerSecond: number;
    if (recent.length >= 2) {
      const span = Math.max(1, recent[recent.length - 1] - recent[0]);
      tokensPerSecond = ((recent.length - 1) / span) * 1000;
    } else {
      const elapsedSeconds = durationMs / 1000 || 1;
      tokensPerSecond = ts.completionTokens / elapsedSeconds;
    }

    const etaSeconds: number | null =
      tokensPerSecond > 0.05 && ts.completionTokens > 0
        ? Math.round(ts.completionTokens / tokensPerSecond)
        : null;

    return {
      model: ts.model,
      promptTokens: ts.promptTokens,
      completionTokens: ts.completionTokens,
      totalTokens: ts.totalTokens,
      llmCalls: ts.llmCalls ?? 0,





      errors: (ts.errors ?? 0) + (this.store.diagramAudit()?.failed ?? 0),
      retries: ts.retries ?? 0,



      repairs: (ts.repairs ?? 0) + (this.store.diagramAudit()?.repaired ?? 0),
      durationMs,
      generatedAt: ts.generatedAt,
      tokensPerSecond,
      etaSeconds,
    };
  });

  protected formatDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) return '0s';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes === 0) return `${seconds}s`;
    return `${minutes}m ${seconds}s`;
  }

  protected formatRate(tokensPerSecond: number): string {
    if (!Number.isFinite(tokensPerSecond) || tokensPerSecond <= 0) return '0.0 tok/s';
    return `${tokensPerSecond.toFixed(1)} tok/s`;
  }

  protected formatEta(seconds: number | null): string {
    if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '—';
    return this.formatDuration(seconds * 1000);
  }
}