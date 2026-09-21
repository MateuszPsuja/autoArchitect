import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { estimateTokensForText } from '../../core/token-estimator';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ProjectStore, AgentActivity } from '../../core/project.store';
import { GenerationAbortService } from '../../core/generation-abort.service';
import { AgentsStore } from '../../core/agents.store';
import { GeneratePromptInput } from '../../core/prompt-builder.service';
import {
  PlannerAbortError,
  PlannerGraphService,
  type PlannerRunProgress,
  isPlannerAbortError,
} from '../../core/planner-graph.service';
import { PlannerError } from '../../core/planner-error.model';
import type { RefinementAnswer } from '../../core/refinement/refinement.schema';
import { LLM_FACTORY, LLM_PROVIDERS, LlmModelsClientService } from '../../core/llm-provider';
import { RunStreamHost } from '../../core/streaming/run-stream-host.service';
import { GeneratePlanStatsComponent } from './generate-plan-stats.component';

@Component({
  selector: 'app-generate-plan',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonModule, MessageModule, RouterLink, GeneratePlanStatsComponent],
  template: `
    <div role="status" aria-live="polite" aria-atomic="true">
      @if (store.isGenerating()) {
        <p class="status">Planning in progress&#8230;</p>
      }
      @if (canResume()) {
        <div class="resume-banner" role="region" aria-label="Resume previous generation">
          <div class="resume-banner-text">
            <strong>Generation was stopped.</strong>
            <span>{{ resumeLabel() }}</span>
          </div>
          <p-button
            label="Resume"
            icon="pi pi-play"
            severity="success"
            size="small"
            data-testid="resume-generation"
            (onClick)="resumeGeneration()"
          />
        </div>
      }
    </div>

    @if (showActivities()) {
      <div class="activity-panel" aria-label="Active agents" data-testid="activity-panel">
        <p class="activity-label">
          Active agents
          <span class="activity-count">{{ displayedActivities().length }}</span>
        </p>
        <ul class="activity-list">
          @for (activity of displayedActivities(); track activity.id) {
            <li class="activity-row" [attr.data-stage]="activity.stage">
              <span class="activity-stage" [class]="kindClass(activity.kind)">
                {{ stageLabel(activity) }}
              </span>
              <span class="activity-agent">
                {{ agentLabel(activity) }}
              </span>
              <span class="activity-elapsed">{{ elapsedLabel(activity) }}</span>
            </li>
          }
        </ul>
      </div>
    }

    @if (showStream()) {
      <div class="stream-section">
        <p class="stream-label">Streaming output</p>
        <pre #streamPre role="log" aria-live="polite" aria-label="Streaming output">{{
          store.streamBuffer()
        }}</pre>
      </div>
    }

    <app-generate-plan-stats />

    @if (canStop()) {
      <div class="stop-row">
        <p-button
          label="Stop"
          icon="pi pi-stop"
          severity="danger"
          size="small"
          data-testid="stop-generation"
          (onClick)="stopGeneration()"
        />
      </div>
    }

    @if (showOpenEditorButton()) {
      <div class="open-editor">
        <p-button label="Open Editor" icon="pi pi-pencil" severity="success" routerLink="/editor" />
      </div>
    }

    @if (store.error()) {
      <div role="alert" class="error-block">
        <p-message severity="error" [text]="errorText()" styleClass="w-full" />
      </div>
    }
  `,
  styles: `
    :host {
      display: grid;
      gap: 0.75rem;
    }

    .status {
      color: var(--primary-color);
      font-weight: 600;
      margin: 0;
    }

    .resume-banner {
      align-items: center;
      background: var(--surface-ground);
      border: 1px solid var(--primary-color);
      border-radius: var(--radius-md);
      display: flex;
      gap: 1rem;
      justify-content: space-between;
      margin-top: 0.5rem;
      padding: 0.75rem 1rem;
    }

    .resume-banner-text {
      display: grid;
      gap: 0.15rem;
    }

    .resume-banner-text strong {
      color: var(--primary-color);
      font-size: 0.9rem;
    }

    .resume-banner-text span {
      color: var(--text-color-secondary);
      font-size: 0.8rem;
    }

    .stop-controls {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }

    .stats-header {
      align-items: center;
      display: flex;
      gap: 0.75rem;
      justify-content: space-between;
      margin-bottom: 0.5rem;
    }

    .stream-section {
      display: grid;
      gap: 0.35rem;
    }

    .stream-label {
      color: var(--text-muted);
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.06em;
      margin: 0;
      text-transform: uppercase;
    }

    pre {
      margin: 0;
      max-height: 14em;
      overflow: hidden;
      white-space: pre-wrap;
      word-break: break-word;
      max-width: 100%;
    }

    .stop-row {
      display: flex;
      justify-content: flex-end;
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
      color: var(--text-color-secondary);
      font-size: 0.85rem;
    }

    .stats-value {
      font-size: 0.9rem;
      font-variant-numeric: tabular-nums;
      font-weight: 600;
    }

    .stats-row-warning .stats-value {
      color: var(--orange-500, #f59e0b);
    }

    .stats-row-warning .stats-key {
      color: var(--orange-500, #f59e0b);
      font-weight: 600;
    }

    .open-editor {
      display: flex;
      justify-content: flex-start;
      padding-top: 0.25rem;
    }

    .error-block {
      margin-top: 0.5rem;
    }

    .activity-panel {
      background: var(--surface-ground);
      border: 1px solid var(--surface-border);
      border-radius: var(--radius-md);
      padding: 0.875rem;
    }

    .activity-label {
      align-items: center;
      color: var(--text-muted);
      display: flex;
      font-size: 0.72rem;
      font-weight: 600;
      gap: 0.5rem;
      letter-spacing: 0.08em;
      margin: 0 0 0.5rem;
      text-transform: uppercase;
    }

    .activity-count {
      background: var(--primary-color);
      border-radius: 999px;
      color: var(--primary-contrast-color);
      font-size: 0.7rem;
      font-weight: 700;
      padding: 0.1rem 0.5rem;
    }

    .activity-list {
      display: grid;
      gap: 0.35rem;
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .activity-row {
      align-items: center;
      background: var(--surface-card);
      border: 1px solid var(--surface-border);
      border-radius: var(--radius-sm, 4px);
      display: flex;
      gap: 0.6rem;
      padding: 0.4rem 0.6rem;
      transition: opacity 200ms ease;
    }

    .activity-stage {
      border-radius: 4px;
      font-size: 0.7rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      padding: 0.1rem 0.5rem;
      text-transform: uppercase;
    }

    .activity-stage.stage {
      background: #e3f2fd;
      color: #0d47a1;
    }

    .activity-stage.parallel-job {
      background: #ede7f6;
      color: #4527a0;
    }

    .activity-stage.audit-repair {
      background: #fff3e0;
      color: #e65100;
    }

    .activity-stage.pdf {
      background: #e0f7fa;
      color: #006064;
    }

    .activity-agent {
      color: var(--text-color-secondary);
      flex: 1;
      font-size: 0.85rem;
    }

    .activity-elapsed {
      color: var(--text-muted);
      font-size: 0.75rem;
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class GeneratePlanComponent {
  protected readonly store = inject(ProjectStore);
  private readonly agentsStore = inject(AgentsStore);
  private readonly plannerGraph = inject(PlannerGraphService);
  private readonly streamHost = inject(RunStreamHost);

  private readonly llmFactory = inject(LLM_FACTORY);

  private readonly llmErrors = inject(LlmModelsClientService);
  private readonly streamPre = viewChild<ElementRef<HTMLPreElement>>('streamPre');
  private readonly generationAbort = inject(GenerationAbortService);
  private readonly destroyRef = inject(DestroyRef);
  private abortController: AbortController | null = null;
  private lastProgress: PlannerRunProgress | null = null;
  private lastInput: GeneratePromptInput | null = null;

  constructor() {
    const detachScrollEffect = this.streamHost.attachScrollEffect({
      streamBuffer: this.store.streamBuffer,
      target: this.streamPre,
    });

    this.destroyRef.onDestroy(() => {
      detachScrollEffect();
      if (this.abortController && !this.abortController.signal.aborted) {
        this.stopGeneration();
      }
    });

    effect(() => {
      if (this.store.refinement.status() !== 'completed') {
        return;
      }
      const answers = this.store.refinement.answers();
      untracked(() => {
        this.store.clearRefinement();
        void this.runWithPendingInput(answers);
      });
    });
  }

  protected readonly showStream = computed(
    () => !!this.store.streamBuffer() && this.store.isGenerating(),
  );

  protected readonly showOpenEditorButton = computed(
    () => !this.store.isGenerating() && !!this.store.tokenStats()?.generatedAt,
  );

  protected errorText(): string {
    const err = this.store.error();
    if (!err) return '';
    return formatPlannerError(err);
  }

  private logPlanSize(plan: ReturnType<typeof this.store.plan>): void {
    if (!plan) return;
    const total = JSON.stringify(plan).length;
    const layerDiagrams = plan.architectureLayers.flatMap((layer) => [
      ['mermaidDiagram', layer.mermaidDiagram],
      ['componentTreeDiagram', layer.componentTreeDiagram ?? ''],
      ['dataFlowDiagram', layer.dataFlowDiagram ?? ''],
      ['moduleDependenciesDiagram', layer.moduleDependenciesDiagram ?? ''],
      ['stateManagementDiagram', layer.stateManagementDiagram ?? ''],
      ['apiContractDiagram', layer.apiContractDiagram ?? ''],
    ]);
    const tddBytes = plan.domains
      .flatMap((d) => d.components)
      .reduce((sum, c) => sum + JSON.stringify(c.tddSpec).length, 0);
    const componentFieldBytes = plan.domains
      .flatMap((d) => d.components)
      .reduce(
        (sum, c) =>
          sum +
          [
            c.responsibilities,
            c.inputs,
            c.outputs,
            c.dependencies,
            c.publicApi,
            c.acceptanceCriteria,
            c.outOfScope,
          ]
            .map((arr) => JSON.stringify(arr).length)
            .reduce((a, b) => a + b, 0),
        0,
      );
    const directoryBytes = plan.architectureLayers.reduce(
      (sum, l) => sum + JSON.stringify(l.directoryStructure).length,
      0,
    );
    const breakdown = {
      totalKB: (total / 1024).toFixed(1),
      layerDiagramsKB: (layerDiagrams.reduce((s, [, v]) => s + (v?.length ?? 0), 0) / 1024).toFixed(1),
      tddSpecKB: (tddBytes / 1024).toFixed(1),
      componentFieldArraysKB: (componentFieldBytes / 1024).toFixed(1),
      directoryStructureKB: (directoryBytes / 1024).toFixed(1),
      layers: plan.architectureLayers.length,
      domains: plan.domains.length,
      components: plan.domains.reduce((sum, d) => sum + d.components.length, 0),
    };
    // eslint-disable-next-line no-console
    console.info('[planner] final plan size breakdown', breakdown);
  }

  protected readonly activeActivities = computed<AgentActivity[]>(() => {
    const now = Date.now();

    const _tick = Math.floor(now / 1000);
    void _tick;
    return this.store.activeActivities();
  });

  protected readonly displayedActivities = computed<AgentActivity[]>(() => {
    const all = this.activeActivities();
    if (!this.store.isRegenerating()) return all;
    return [
      {
        id: 'regen-architect',
        stage: 'regenerate',
        agentId: null,
        skillId: null,
        label: 'Architect',
        startedAt: all.reduce((min, a) => Math.min(min, a.startedAt), Date.now()),
        kind: 'stage',
      },
    ];
  });

  protected readonly showActivities = computed(
    () => this.displayedActivities().length > 0,
  );

  protected stageLabel(activity: AgentActivity): string {
    if (activity.label) {
      return `${activity.stage}:${activity.label}`;
    }
    return activity.stage;
  }

  protected agentLabel(activity: AgentActivity): string {
    if (!activity.agentId) {
      return 'system';
    }
    const agent = this.agentsStore.getAgent(activity.agentId);
    const agentName = agent?.name ?? activity.agentId;
    if (activity.skillId) {
      const skill = agent?.skills.find((s) => s.id === activity.skillId);
      const skillName = skill?.name ?? activity.skillId;
      return `${agentName} · ${skillName}`;
    }
    return agentName;
  }

  protected kindClass(kind: AgentActivity['kind']): string {
    return kind;
  }

  protected elapsedLabel(activity: AgentActivity): string {
    const ms = Date.now() - activity.startedAt;
    if (!Number.isFinite(ms) || ms < 0) return '0s';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes === 0) return `${seconds}s`;
    return `${minutes}m ${seconds}s`;
  }

  async runWithPendingInput(refinementContext: RefinementAnswer[] = []): Promise<void> {
    if (this.store.isGenerating()) {
      return;
    }
    const pending = this.store.pendingInput?.() ?? null;
    if (!pending) {
      return;
    }
    await this.onGenerate(pending, refinementContext);
  }

  private async onGenerate(
    input: GeneratePromptInput,
    refinementContext: RefinementAnswer[] = [],
  ): Promise<void> {
    if (this.store.isGenerating()) {
      return;
    }

    const cfg = this.store.config();
    const descriptor = LLM_PROVIDERS[cfg.provider];
    const slot = cfg.providerConfigs[cfg.provider];
    const model = slot.selectedModel.trim();
    if (!model) {
      this.store.setError({
        type: 'auth',
        message: 'Select a model in Config before generating.',
      });
      return;
    }

    const apiKey = this.store.apiKey().trim();
    if (descriptor.requiresApiKey && !apiKey) {
      this.store.setError({
        type: 'auth',
        message: `Set your ${descriptor.apiKeyLabel} in Config before generating.`,
      });
      return;
    }
    const key = descriptor.requiresApiKey ? apiKey : 'lm-studio';

    const startedAtIso = new Date().toISOString();
    const generatedAtIso = startedAtIso;

    this.abortController = new AbortController();
    this.generationAbort.setActive(this.abortController);

    this.store.setIsGenerating(true);
    this.store.setError(null);
    this.store.setStreamBuffer('');
    this.store.clearActivities();
    this.store.clearDiagramAudit();
    this.store.setTokenStats({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      model,
      generatedAt: generatedAtIso,
      startedAt: startedAtIso,
      llmCalls: 0,
      errors: 0,
      retries: 0,
      repairs: 0,
    });

    this.streamHost.startRun({
      onFinished: () => {
        this.store.setIsGenerating(false);
        this.store.clearActivities();
      },
    });

    try {
      const chat = this.llmFactory(cfg, key, { streaming: true });

      let llmCalls = 0;
      let completionChars = 0;
      let promptTokens = 0;
      let completionTokens = 0;
      let errorCount = 0;
      let retryCount = 0;
      let repairCount = 0;
      let lastErrorKind: string | null = null;

      const updateLive = (): void => {
        this.store.setTokenStats({
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          model,
          generatedAt: generatedAtIso,
          startedAt: startedAtIso,
          llmCalls,
          errors: errorCount,
          retries: retryCount,
          repairs: repairCount,
        });
      };

      const wrappedInvoker = this.streamHost.createWrappedInvoker({
        chat,
        signal: this.abortController?.signal,
        appendStream: (chunk) => this.store.appendStream(chunk),
        setStreamBuffer: (buffer) => this.store.setStreamBuffer(buffer),
        getStreamBuffer: () => this.store.streamBuffer(),
        estimatePromptTokens: (prompt) => estimateTokensForText(prompt),
        onChunk: (stats) => {
          llmCalls = stats.llmCalls;
          promptTokens = stats.promptTokens;
          completionChars = stats.completionChars;
          completionTokens = stats.completionTokens;
          updateLive();
        },
      });

      this.lastInput = input;
      const plannerResult = await (async (): Promise<Awaited<ReturnType<PlannerGraphService['generate']>> | null> => {
        try {





          return await this.plannerGraph.generate(input, {
            llmInvoker: wrappedInvoker,
            signal: this.abortController?.signal,
            onProgress: (progress) => {
              this.lastProgress = progress;
              this.store.setPendingResume(progress);
            },
            onError: (event) => {
              if (event.kind === 'invalid_json' || event.kind === 'schema_validation' || event.kind === 'provider_error') {
                errorCount += 1;
                lastErrorKind = event.kind;
              } else if (event.kind === 'retry') {
                retryCount += 1;
              } else if (event.kind === 'repair') {
                repairCount += 1;
                lastErrorKind = event.kind;
              }
              updateLive();
            },
            refinementContext,
          });
        } catch (caught) {
          if (isPlannerAbortError(caught) || this.abortController?.signal.aborted) {
            return null;
          }
          throw caught;
        }
      })();

      if (this.abortController?.signal.aborted || plannerResult === null) {

        return;
      }

      const result = plannerResult;

      if (result.error) {
        this.store.setError(result.error);
        return;
      }

      this.store.setPendingResume(null);

      if (result.plan) {
        let finalPlan = result.plan;





        const autoFixActivityId = this.store.startActivity({
          stage: 'audit-repair',
          agentId: null,
          skillId: null,
          label: 'Auto-fixing stubs…',
          kind: 'audit-repair',
        });
        try {
          const regen = await this.plannerGraph.regenerateStubs(input, finalPlan, wrappedInvoker, {
            onError: (event) => {
              if (event.kind === 'invalid_json' || event.kind === 'schema_validation' || event.kind === 'provider_error') {
                errorCount += 1;
                lastErrorKind = event.kind;
              } else if (event.kind === 'retry') {
                retryCount += 1;
              } else if (event.kind === 'repair') {
                repairCount += 1;
                lastErrorKind = event.kind;
              }
              updateLive();
            },
          });
          if (regen.rounds > 0) {
            finalPlan = regen.plan;
            if (regen.residualStubs.length > 0) {
              // eslint-disable-next-line no-console
              console.warn(
                `[planner] auto-fix could not regenerate: ${regen.residualStubs.join(', ')}`,
              );
            }
          }
        } catch (regenError) {
          // eslint-disable-next-line no-console
          console.warn('[planner] auto-fix pass failed:', regenError);
        } finally {
          this.store.finishActivity(autoFixActivityId);
        }

        const finalCompletion = this.measureCompletionText(this.store.streamBuffer());
        completionTokens = finalCompletion;

        const generatedAt = finalPlan.meta.generatedAt;
        const finalStats = {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          model,
          generatedAt,
          startedAt: startedAtIso,
          llmCalls,
          errors: errorCount,
          retries: retryCount,
          repairs: repairCount,
        };



        this.logPlanSize(finalPlan);
        this.store.setPlan(finalPlan, finalStats, false);





      }
    } catch (error) {
      this.store.setError(this.llmErrors.mapLlmError(error));
    } finally {
      this.streamHost.markRunFinished();
    }
  }

  protected stopGeneration(): void {
    if (this.abortController && !this.abortController.signal.aborted) {
      this.abortController.abort();
    }
    this.generationAbort.abort();

    this.store.setIsGenerating(false);
    this.store.clearActivities();
    this.streamHost.markRunFinished();
    this.generationAbort.setActive(null);
  }

  protected async resumeGeneration(): Promise<void> {
    const pending = this.store.pendingResume();
    const input = this.lastInput ?? pending?.input;
    const refinementContext = this.getRefinementContext();
    if (!input) return;
    if (this.store.isGenerating()) return;

    const cfg = this.store.config();
    const descriptor = LLM_PROVIDERS[cfg.provider];
    const slot = cfg.providerConfigs[cfg.provider];
    const model = slot.selectedModel.trim();
    const apiKey = this.store.apiKey().trim();
    if (!model) {
      this.store.setError({ type: 'auth', message: 'Select a model in Config before generating.' });
      return;
    }
    if (descriptor.requiresApiKey && !apiKey) {
      this.store.setError({
        type: 'auth',
        message: `Set your ${descriptor.apiKeyLabel} in Config before generating.`,
      });
      return;
    }
    const key = descriptor.requiresApiKey ? apiKey : 'lm-studio';

    const startedAtIso = new Date().toISOString();
    const generatedAtIso = startedAtIso;
    this.abortController = new AbortController();

    this.store.setIsGenerating(true);
    this.store.setError(null);
    this.store.setStreamBuffer('');
    this.store.clearActivities();
    this.store.clearDiagramAudit();
    this.store.setTokenStats({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      model,
      generatedAt: generatedAtIso,
      startedAt: startedAtIso,
      llmCalls: 0,
      errors: 0,
      retries: 0,
      repairs: 0,
    });

    this.streamHost.startRun({
      onFinished: () => {
        this.store.setIsGenerating(false);
        this.store.clearActivities();
      },
    });
    this.lastInput = input;

    try {
      const chat = this.llmFactory(cfg, key, { streaming: true });
      let llmCalls = 0;
      let completionChars = 0;
      let promptTokens = 0;
      let completionTokens = 0;
      let errorCount = 0;
      let retryCount = 0;
      let repairCount = 0;

      const updateLive = (): void => {
        this.store.setTokenStats({
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          model,
          generatedAt: generatedAtIso,
          startedAt: startedAtIso,
          llmCalls,
          errors: errorCount,
          retries: retryCount,
          repairs: repairCount,
        });
      };

      const wrappedInvoker = this.streamHost.createWrappedInvoker({
        chat,
        signal: this.abortController?.signal,
        appendStream: (chunk) => this.store.appendStream(chunk),
        setStreamBuffer: (buffer) => this.store.setStreamBuffer(buffer),
        getStreamBuffer: () => this.store.streamBuffer(),
        estimatePromptTokens: (prompt) => estimateTokensForText(prompt),
        onChunk: (stats) => {
          llmCalls = stats.llmCalls;
          promptTokens = stats.promptTokens;
          completionChars = stats.completionChars;
          completionTokens = stats.completionTokens;
          updateLive();
        },
      });

      const result = await (async (): Promise<Awaited<ReturnType<PlannerGraphService['resumeFromCheckpoint']>> | null> => {
        try {
          return await this.plannerGraph.resumeFromCheckpoint(pending!, {
            maxRetries: 8,
            llmInvoker: wrappedInvoker,
            signal: this.abortController?.signal,
            onProgress: (progress) => {
              this.lastProgress = progress;
              this.store.setPendingResume(progress);
            },
            onError: (event) => {
              if (event.kind === 'invalid_json' || event.kind === 'schema_validation' || event.kind === 'provider_error') {
                errorCount += 1;
              } else if (event.kind === 'retry') {
                retryCount += 1;
              } else if (event.kind === 'repair') {
                repairCount += 1;
              }
              updateLive();
            },
            refinementContext,
          });
        } catch (caught) {
          if (isPlannerAbortError(caught) || this.abortController?.signal.aborted) {
            return null;
          }
          throw caught;
        }
      })();

      if (this.abortController?.signal.aborted || result === null) {
        return;
      }

      if (result.error) {
        this.store.setError(result.error);
        return;
      }

      this.store.setPendingResume(null);
      if (result.plan) {
        const finalCompletion = this.measureCompletionText(this.store.streamBuffer());
        completionTokens = finalCompletion;
        const finalStats = {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          model,
          generatedAt: result.plan.meta.generatedAt,
          startedAt: startedAtIso,
          llmCalls,
          errors: errorCount,
          retries: retryCount,
          repairs: repairCount,
        };
        this.logPlanSize(result.plan);
        this.store.setPlan(result.plan, finalStats, false);



      }
    } catch (error) {
      this.store.setError(this.llmErrors.mapLlmError(error));
    } finally {
      this.streamHost.markRunFinished();
    }
  }

  protected readonly canStop = computed(() => this.store.isGenerating());

  protected readonly canResume = computed(
    () => !this.store.isGenerating() && !!this.store.pendingResume(),
  );

  protected readonly resumeLabel = computed<string>(() => {
    const p = this.store.pendingResume();
    if (!p) return '';
    const stage = p.stage;
    const layerCount = p.layers.length;
    const domainCount = p.domains.length;
    if (stage === 'scaffold') return 'Resume from scaffold stage';
    if (stage === 'layers') return `Resume after ${layerCount} layer${layerCount === 1 ? '' : 's'}`;
    if (stage === 'domains')
      return `Resume after ${layerCount} layer${layerCount === 1 ? '' : 's'} + ${domainCount} domain${domainCount === 1 ? '' : 's'}`;
    if (stage === 'tail') return `Resume tail stage (${layerCount} layers, ${domainCount} domains ready)`;
    return 'Resume merge / audit-repair';
  });

  private getRefinementContext(): RefinementAnswer[] {
    const store = this.store as unknown as {
      refinement?: { answers?: () => RefinementAnswer[] };
    };
    return store.refinement?.answers?.() ?? [];
  }

  private measureCompletionText(text: string): number {
    return estimateTokensForText(text);
  }
}

function formatPlannerError(err: PlannerError): string {
  switch (err.type) {
    case 'stage_failed': {
      const fieldList =
        'fields' in err && err.fields && err.fields.length > 0
          ? `\nFailing fields: ${err.fields.join(', ')}`
          : '';
      return [
        `Generation failed at the ${err.stage} stage.`,
        'Try (a) using a larger-context model, (b) simplifying your idea, or (c) regenerating.',
        `Details: ${err.message}${fieldList}`,
      ].join(' ');
    }
    default:
      return err.message;
  }
}