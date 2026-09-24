import { Injectable, inject } from '@angular/core';
import { z } from 'zod';
import { Plan } from './plan.schema';
import {
  PlanSchemaService,
  STUB_MARKER,
  type Scaffold,
  type Tail,
  type StageKind,
  type StageValidationResult,
} from './plan-schema.service';
import { PlannerError } from './planner-error.model';
import { LlmModelsClientService } from './llm-provider';
import {
  ComplexityCaps,
  GeneratePromptInput,
  PromptBuilderService,
  RefinementInstructionBlock,
  resolveSkillForStage,
} from './prompt-builder.service';
import type { RefinementAnswer } from './refinement/refinement.schema';
import { parseFirstJsonObjectResult, ParseResult } from './json-output-parser';
import { AgentsStore } from './agents.store';
import { ParallelSectionRunner, type ParallelRunOptions } from './parallel-section-runner.service';
import { ProjectStore } from './project.store';
import { AuditRepairRunner } from './audit-repair-runner.service';
import { SectionRepairRunner, type SectionRepairErrorEvent } from './section-repair-runner.service';
import { AuditRunner, AuditFinding } from './audit-runner.service';
import { MermaidVerifyService } from './mermaid-verify.service';
import { PlannerAbortError, isPlannerAbortError } from './streaming/abort-error';
import { elementKey, UserEditSummary } from './diff/user-edit-summary';

export { STUB_MARKER, PlannerAbortError, isPlannerAbortError };

export interface LlmInvokerResult {
  text: string;
  finishReason?: string;
}

export interface PlannerErrorEvent {
  stage: StageKind;
  kind:
    | 'invalid_json'
    | 'schema_validation'
    | 'provider_error'
    | 'parse'
    | 'repair'
    | 'retry'
    | 'stub_fallback';
  jobId?: string;
  attempt?: number;
  repairPass?: number;
  message?: string;
}

export interface PlannerRunConfig {
  maxRetries?: number;
  llmInvoker: (promptText: string) => Promise<LlmInvokerResult>;
  onError?: (event: PlannerErrorEvent) => void;

  signal?: AbortSignal;

  onProgress?: (progress: PlannerRunProgress) => void;
  refinementContext?: RefinementAnswer[];
}

export interface PlannerRunProgress {
  input: GeneratePromptInput;
  stage: 'scaffold' | 'layers' | 'domains' | 'tail' | 'merge' | 'done';
  scaffold: Scaffold | null;
  layers: unknown[];
  domains: unknown[];
  tail: Tail | null;
}

export interface PlannerRunResult {
  plan: Plan | null;
  error: PlannerError | null;
  attempts: number;
}

const PARSE_FAILURE_MESSAGE = 'LLM returned invalid JSON.';

const RESERVED_CALLS = 8;

export function scoreIdeaComplexity(input: GeneratePromptInput): ComplexityCaps {
  const text = [input.idea, input.technicalConstraints, input.nfrs, input.hints]
    .filter(Boolean)
    .join(' ');
  const lengthScore = text.length / 500;
  const featureCount = (text.match(/,/g) ?? []).length;
  const keywords = [
    'platform',
    'marketplace',
    'multi-tenant',
    'analytics',
    'ml',
    'ai',
    'payments',
    'auth',
    'search',
    'notifications',
    'messaging',
    'admin',
    'dashboard',
    'reporting',
    'workflow',
    'pipeline',
  ];
  const kwHits = keywords.reduce(
    (n, kw) => n + (new RegExp(`\\b${kw}\\b`, 'i').test(text) ? 1 : 0),
    0,
  );
  const score = lengthScore + featureCount * 0.25 + kwHits * 0.3;
  if (score < 0.4) return { tier: 'low', maxLayers: 5, maxDomains: 6 };
  if (score < 1.0) return { tier: 'medium', maxLayers: 4, maxDomains: 4 };
  return { tier: 'high', maxLayers: 3, maxDomains: 3 };
}

export function computePerJobRetries(
  maxAttempts: number,
  maxRetries: number,
  layerCount: number,
  domainCount: number,
): number {
  const jobs = Math.max(1, layerCount + domainCount);
  return Math.max(2, Math.min(maxRetries, Math.floor((maxAttempts - RESERVED_CALLS) / jobs)));
}

@Injectable({ providedIn: 'root' })
export class PlannerGraphService {
  private readonly promptBuilder = inject(PromptBuilderService);
  private readonly schemaService = inject(PlanSchemaService);
  private readonly llmErrors = inject(LlmModelsClientService);
  private readonly agents = inject(AgentsStore);
  private readonly parallel = inject(ParallelSectionRunner);
  private readonly projectStore = inject(ProjectStore);
  private readonly auditRunner = inject(AuditRunner);
  private readonly auditRepair = inject(AuditRepairRunner);
  private readonly sectionRepair = inject(SectionRepairRunner);
  private readonly mermaidVerify = inject(MermaidVerifyService);

  async generate(input: GeneratePromptInput, config: PlannerRunConfig): Promise<PlannerRunResult> {
    return this.generateSectioned(input, config);
  }

  /**
   * Stamps the original user idea onto the plan meta so downstream rendering
   * (spec.md frontmatter, PDF export) can quote it. Only overwrites if the
   * caller-supplied idea is non-empty; preserved values on regenerate win so
   * the field survives across regenerations even when `input.idea` was tweaked.
   */
  private stampUserIdea(plan: Plan, idea: string | undefined): Plan {
    const trimmed = idea?.trim();
    if (!trimmed) return plan;
    if (plan.meta.userIdea?.trim() === trimmed) return plan;
    return { ...plan, meta: { ...plan.meta, userIdea: trimmed } };
  }

  async regenerateStubs(
    input: GeneratePromptInput,
    plan: Plan,
    llmInvoker: (promptText: string) => Promise<LlmInvokerResult>,
    options: {
      maxRetriesPerJob?: number;
      onError?: PlannerRunConfig['onError'];
    } = {},
  ): Promise<{ plan: Plan; residualStubs: string[]; rounds: number }> {
    const stubbedLayerIds = plan.architectureLayers
      .filter((l) => l.description.includes(STUB_MARKER))
      .map((l) => l.id);
    const stubbedDomainIds = plan.domains
      .filter((d) => d.description.includes(STUB_MARKER))
      .map((d) => d.id);

    if (stubbedLayerIds.length === 0 && stubbedDomainIds.length === 0) {
      return { plan, residualStubs: [], rounds: 0 };
    }

    const findings: AuditFinding[] = [
      ...stubbedLayerIds.map((id) => ({
        severity: 'error' as const,
        path: `architectureLayers[${id}].__stub_marker__`,
        message: `Layer '${id}' is an auto-generated stub (description contains ${STUB_MARKER}).`,
        fix: `Regenerate the '${id}' layer so the description is no longer the auto-generated stub.`,
      })),
      ...stubbedDomainIds.map((id) => ({
        severity: 'error' as const,
        path: `domains[${id}].__stub_marker__`,
        message: `Domain '${id}' is an auto-generated stub (description contains ${STUB_MARKER}).`,
        fix: `Regenerate the '${id}' domain so the description is no longer the auto-generated stub.`,
      })),
    ];

    const onRepairError = (event: SectionRepairErrorEvent): void => {
      options.onError?.({
        stage: event.stage,
        kind: event.kind,
        jobId: event.jobId,
        attempt: event.attempt,
        repairPass: event.repairPass,
        message: event.message,
      });
    };

    const result = await this.sectionRepair.invokeSectionScoped(
      plan,
      findings,
      input,
      async (promptText) => llmInvoker(promptText),
      {
        maxRetriesPerJob: options.maxRetriesPerJob ?? 4,
        onError: onRepairError,
        auditRepairMaxAttempts: 1,
      },
    );

    const residualStubs = this.collectResidualStubs(result.plan);
    return { plan: result.plan, residualStubs, rounds: 1 };
  }

  private collectResidualStubs(plan: Plan): string[] {
    return [
      ...plan.architectureLayers
        .filter((l) => l.description.includes(STUB_MARKER))
        .map((l) => `layer:${l.id}`),
      ...plan.domains
        .filter((d) => d.description.includes(STUB_MARKER))
        .map((d) => `domain:${d.id}`),
    ];
  }

  private pickAdditions(value: unknown): {
    layers: unknown[];
    domains: unknown[];
    boundedContexts: unknown[];
    acceptedCount: number;
    entitiesFound: number;
    dropped: { kind: 'layer' | 'domain' | 'boundedContext'; id: string; reason: string }[];
  } {
    const result: ReturnType<PlannerGraphService['pickAdditions']> = {
      layers: [],
      domains: [],
      boundedContexts: [],
      acceptedCount: 0,
      entitiesFound: 0,
      dropped: [],
    };
    if (!value || typeof value !== 'object') return result;
    const record = value as Record<string, unknown>;

    const extractId = (raw: unknown): string => {
      const unwrapped = this.schemaService.unwrapPlanCandidate(raw);
      if (unwrapped && typeof unwrapped === 'object' && 'id' in (unwrapped as Record<string, unknown>)) {
        return String((unwrapped as Record<string, unknown>)['id'] ?? '?');
      }
      return '?';
    };

    const extractErrorFields = (err: unknown): string => {
      if (!err || typeof err !== 'object') return 'unknown';
      const fields = (err as { fields?: string[] }).fields;
      if (Array.isArray(fields) && fields.length > 0) return fields.join(', ');
      const issues = (err as { issues?: Array<{ path: (string | number)[]; message: string }> }).issues;
      if (Array.isArray(issues) && issues.length > 0) {
        return issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
      }
      return 'unknown';
    };

    const appendAccepted = (out: unknown[], data: unknown): void => {
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string') {
          out.push(item);
          result.acceptedCount += 1;
        }
      }
    };

    const schemaService = this.schemaService;
    const validateLayerChunk = schemaService.validateLayerChunk.bind(schemaService);
    const validateDomainChunk = schemaService.validateDomainChunk.bind(schemaService);
    const validateBoundedContexts = schemaService.validateBoundedContexts.bind(schemaService);
    const flattenAdditionsChunks = schemaService.flattenAdditionsChunks.bind(schemaService);

    const validateWithNormalise = (
      items: unknown[],
      kind: 'layer' | 'domain' | 'boundedContext',
      validate: (input: unknown) => { success: boolean; data?: unknown; error?: unknown },
    ): { accepted: unknown[]; fields: string[] } => {
      const out: unknown[] = [];
      const fields: string[] = [];
      for (const item of items) {
        const singleChunk = validate(item);
        if (singleChunk.success) {
          const items2 = Array.isArray(singleChunk.data) ? singleChunk.data : [singleChunk.data];
          for (const it of items2) {
            if (it && typeof it === 'object' && typeof (it as { id?: unknown }).id === 'string') {
              out.push(it);
            }
          }
          continue;
        }
        const flattened = flattenAdditionsChunks([item], { safeParse: validate } as z.ZodTypeAny);
        if (flattened.length > 0) {
          for (const it of flattened) {
            out.push(it);
          }
        } else {
          const id =
            item && typeof item === 'object' && 'id' in (item as Record<string, unknown>)
              ? String((item as Record<string, unknown>)['id'] ?? '?')
              : '?';
          fields.push(
            `${kind}[id=${id}]: ${(singleChunk as { fields?: string[] }).fields?.join(', ') ?? 'unknown'}`,
          );
        }
      }
      return { accepted: out, fields };
    };

    const groups: Array<{
      key: 'newLayers' | 'newDomains' | 'newBoundedContexts';
      kind: 'layer' | 'domain' | 'boundedContext';
      out: unknown[];
      validate: (input: unknown) => { success: boolean; data?: unknown; error?: unknown };
    }> = [
      { key: 'newLayers', kind: 'layer', out: result.layers, validate: validateLayerChunk },
      { key: 'newDomains', kind: 'domain', out: result.domains, validate: validateDomainChunk },
      {
        key: 'newBoundedContexts',
        kind: 'boundedContext',
        out: result.boundedContexts,
        validate: validateBoundedContexts,
      },
    ];

    for (const group of groups) {
      const raw = record[group.key];
      if (raw === undefined || raw === null) continue;
      const items = Array.isArray(raw) ? raw : [raw];
      result.entitiesFound += items.length;
      const validation = validateWithNormalise(items, group.kind, group.validate);
      for (const accepted of validation.accepted) {
        if (accepted && typeof accepted === 'object' && typeof (accepted as { id?: unknown }).id === 'string') {
          group.out.push(accepted);
          result.acceptedCount += 1;
        }
      }
      for (const field of validation.fields) {
        const idMatch = field.match(/\[id=([^\]]+)\]/);
        const reason = field.replace(/^[^:]+:\s*/, '');
        result.dropped.push({
          kind: group.kind,
          id: idMatch ? idMatch[1] : '?',
          reason,
        });
      }
    }

    return result;
  }

  async regenerateSectioned(args: {
    currentPlan: Plan;
    originalInput: GeneratePromptInput;
    editSummary: UserEditSummary;
    llmInvoker: (promptText: string) => Promise<LlmInvokerResult>;
    signal?: AbortSignal;
    perSectionMaxRetries?: number;
    onError?: (event: PlannerErrorEvent) => void;
    refinementInstruction?: RefinementInstructionBlock;
  }): Promise<{
    plan: Plan;
    structuralAdjustments: number;
    partialFailures: number;
  }> {
    const { currentPlan, originalInput, editSummary, llmInvoker, signal } = args;
    const perSectionMaxRetries = args.perSectionMaxRetries ?? 2;
    const refinementInstruction = args.refinementInstruction;
    const layerSkill = resolveSkillForStage(this.agents, 'layers');
    const domainSkill = resolveSkillForStage(this.agents, 'domains');
    const tailSkill = resolveSkillForStage(this.agents, 'tail');
    const onError = args.onError;

    const throwIfAborted = (): void => {
      if (signal?.aborted) throw new PlannerAbortError();
    };

    throwIfAborted();

    const baseValidation = this.schemaService.validate(currentPlan);
    if (!baseValidation.success) {
      throw {
        type: 'stage_failed',
        stage: 'merge',
        message: `Cannot regenerate: current plan failed schema validation (${baseValidation.fields.join(', ')}).`,
        fields: baseValidation.fields,
      } satisfies PlannerError;
    }

    const addedSet = new Set(editSummary.addedElements.map((e) => elementKey(e.kind, e.id)));
    const removedSet = new Set(editSummary.removedElements.map((e) => elementKey(e.kind, e.id)));

    const layerJobs = currentPlan.architectureLayers
      .filter((layer) => !removedSet.has(elementKey('architectureLayer', layer.id)))
      .map((layer) => {
        const isUserAdded = addedSet.has(elementKey('architectureLayer', layer.id));
        return {
          id: layer.id,
          isUserAdded,
          buildPrompt: (retry: string) =>
            this.promptBuilder.buildRegenerateLayerPrompt({
              layer,
              currentPlan,
              editSummary,
              isUserAdded,
              schema: this.schemaService.jsonSchema,
              skillOverride: layerSkill,
              retryContext: retry,
              refinementInstruction,
              originalInput,
            }),
        };
      });

    const domainJobs = currentPlan.domains
      .filter((domain) => !removedSet.has(elementKey('domain', domain.id)))
      .map((domain) => {
        const isUserAdded = addedSet.has(elementKey('domain', domain.id));
        return {
          id: domain.id,
          isUserAdded,
          buildPrompt: (retry: string) =>
            this.promptBuilder.buildRegenerateDomainPrompt({
              domain,
              currentPlan,
              editSummary,
              isUserAdded,
              schema: this.schemaService.jsonSchema,
              skillOverride: domainSkill,
              retryContext: retry,
              refinementInstruction,
              originalInput,
            }),
        };
      });

    let partialFailures = 0;
    let regeneratedLayerCount = 0;
    let regeneratedDomainCount = 0;
    let regeneratedTail = false;

    const regenLayer = async (job: { id: string; buildPrompt: (r: string) => Promise<unknown> }): Promise<unknown[] | null> => {
      const activityId = this.projectStore.startActivity({
        stage: 'layers',
        agentId: layerSkill?.agentId ?? null,
        skillId: layerSkill?.skill.id ?? null,
        label: `regen:${job.id}`,
        kind: 'parallel-job',
      });
      try {
        let lastError: string = '';
        for (let attempt = 1; attempt <= perSectionMaxRetries; attempt += 1) {
          if (signal?.aborted) throw new PlannerAbortError();
          const prompt = await job.buildPrompt(lastError);
          const rendered = (await (prompt as { format: (vars: object) => Promise<unknown> }).format({})) as { toString(): string } | string;
          const text = typeof rendered === 'string' ? rendered : (rendered as { toString(): string }).toString();
          try {
            const result = await llmInvoker(text);
            const parsed = parseFirstJsonObjectResult(result.text);
            if (parsed.ok) {
              const validation = this.schemaService.validateLayerChunk(parsed.value);
              if (validation.success) {
                return validation.data;
              }
              const fields = (validation as { fields: string[] }).fields;
              lastError = `layer chunk validation: ${fields.join(', ')}`;
              onError?.({ stage: 'layers', kind: 'schema_validation', jobId: job.id, attempt, message: lastError });
            } else {
              lastError = 'invalid JSON from LLM';
              onError?.({ stage: 'layers', kind: 'invalid_json', jobId: job.id, attempt, message: lastError });
            }
          } catch (invokerError) {
            if (isPlannerAbortError(invokerError) || signal?.aborted) throw new PlannerAbortError();
            lastError = invokerError instanceof Error ? invokerError.message : String(invokerError);
            onError?.({ stage: 'layers', kind: 'provider_error', jobId: job.id, attempt, message: lastError });
          }
        }
        partialFailures += 1;
        return null;
      } finally {
        this.projectStore.finishActivity(activityId);
      }
    };

    const regenDomain = async (job: { id: string; buildPrompt: (r: string) => Promise<unknown> }): Promise<unknown[] | null> => {
      const activityId = this.projectStore.startActivity({
        stage: 'domains',
        agentId: domainSkill?.agentId ?? null,
        skillId: domainSkill?.skill.id ?? null,
        label: `regen:${job.id}`,
        kind: 'parallel-job',
      });
      try {
        let lastError: string = '';
        for (let attempt = 1; attempt <= perSectionMaxRetries; attempt += 1) {
          if (signal?.aborted) throw new PlannerAbortError();
          const prompt = await job.buildPrompt(lastError);
          const rendered = (await (prompt as { format: (vars: object) => Promise<unknown> }).format({})) as { toString(): string } | string;
          const text = typeof rendered === 'string' ? rendered : (rendered as { toString(): string }).toString();
          try {
            const result = await llmInvoker(text);
            const parsed = parseFirstJsonObjectResult(result.text);
            if (parsed.ok) {
              const validation = this.schemaService.validateDomainChunk(parsed.value);
              if (validation.success) {
                return validation.data;
              }
              const fields = (validation as { fields: string[] }).fields;
              lastError = `domain chunk validation: ${fields.join(', ')}`;
              onError?.({ stage: 'domains', kind: 'schema_validation', jobId: job.id, attempt, message: lastError });
            } else {
              lastError = 'invalid JSON from LLM';
              onError?.({ stage: 'domains', kind: 'invalid_json', jobId: job.id, attempt, message: lastError });
            }
          } catch (invokerError) {
            if (isPlannerAbortError(invokerError) || signal?.aborted) throw new PlannerAbortError();
            lastError = invokerError instanceof Error ? invokerError.message : String(invokerError);
            onError?.({ stage: 'domains', kind: 'provider_error', jobId: job.id, attempt, message: lastError });
          }
        }
        partialFailures += 1;
        return null;
      } finally {
        this.projectStore.finishActivity(activityId);
      }
    };

    throwIfAborted();

    const concurrency = Math.max(1, this.projectStore.config().parallelSectionConcurrency ?? 6);
    const [layerChunks, domainChunks] = await Promise.all([
      runWithConcurrency(layerJobs.map((j) => () => regenLayer(j)), concurrency),
      runWithConcurrency(domainJobs.map((j) => () => regenDomain(j)), concurrency),
    ]);

    throwIfAborted();

    const flatLayers = layerChunks.filter((r): r is unknown[] => Array.isArray(r));
    const flatDomains = domainChunks.filter((r): r is unknown[] => Array.isArray(r));
    regeneratedLayerCount = flatLayers.reduce((sum, chunk) => sum + chunk.length, 0);
    regeneratedDomainCount = flatDomains.reduce((sum, chunk) => sum + chunk.length, 0);

    let tailValue: Tail | null = null;
    const tailActivityId = this.projectStore.startActivity({
      stage: 'tail',
      agentId: tailSkill?.agentId ?? null,
      skillId: tailSkill?.skill.id ?? null,
      label: 'regen',
      kind: 'stage',
    });
    try {
      let lastTailError = '';
      for (let attempt = 1; attempt <= perSectionMaxRetries; attempt += 1) {
        if (signal?.aborted) throw new PlannerAbortError();
        try {
          const prompt = await this.promptBuilder.buildRegenerateTailPrompt({
            currentPlan,
            editSummary,
            schema: this.schemaService.jsonSchema,
            skillOverride: tailSkill,
            retryContext: lastTailError,
            refinementInstruction,
            originalInput,
          });
          const rendered = (await prompt.format({})) as { toString(): string } | string;
          const text = typeof rendered === 'string' ? rendered : (rendered as { toString(): string }).toString();
          const result = await llmInvoker(text);
          const parsed = parseFirstJsonObjectResult(result.text);
          if (parsed.ok) {
            const validation = this.schemaService.validateTail(parsed.value);
            if (validation.success) {
              tailValue = validation.data;
              regeneratedTail = true;
              break;
            }
            const fields = (validation as { fields: string[] }).fields;
            lastTailError = `tail validation: ${fields.join(', ')}`;
            onError?.({ stage: 'tail', kind: 'schema_validation', attempt, message: lastTailError });
          } else {
            lastTailError = 'invalid JSON from LLM';
            onError?.({ stage: 'tail', kind: 'invalid_json', attempt, message: lastTailError });
          }
        } catch (tailErr) {
          if (isPlannerAbortError(tailErr) || signal?.aborted) throw new PlannerAbortError();
          lastTailError = tailErr instanceof Error ? tailErr.message : String(tailErr);
          onError?.({ stage: 'tail', kind: 'provider_error', attempt, message: lastTailError });
        }
      }
      if (!tailValue) {
        partialFailures += 1;
        tailValue = {
          workflows: currentPlan.workflows,
          adrs: currentPlan.adrs,
          agentTasks: currentPlan.agentTasks,
        };
      }
    } finally {
      this.projectStore.finishActivity(tailActivityId);
    }

    let regenBoundedContexts: Plan['boundedContexts'] | null = null;
    let regeneratedBoundedContexts = false;
    {
      const bcActivityId = this.projectStore.startActivity({
        stage: 'layers',
        agentId: layerSkill?.agentId ?? null,
        skillId: layerSkill?.skill.id ?? null,
        label: 'regen:bounded-contexts',
        kind: 'stage',
      });
      try {
        let lastError = '';
        for (let attempt = 1; attempt <= perSectionMaxRetries; attempt += 1) {
          if (signal?.aborted) throw new PlannerAbortError();
          try {
            const prompt = await this.promptBuilder.buildRegenerateBoundedContextsPrompt({
              currentPlan,
              editSummary,
              schema: this.schemaService.jsonSchema,
              skillOverride: layerSkill,
              retryContext: lastError,
              refinementInstruction,
              originalInput,
            });
            const rendered = (await prompt.format({})) as { toString(): string } | string;
            const text = typeof rendered === 'string' ? rendered : (rendered as { toString(): string }).toString();
            const result = await llmInvoker(text);
            const parsed = parseFirstJsonObjectResult(result.text);
            if (parsed.ok) {
              const validation = this.schemaService.validateBoundedContexts(parsed.value);
              if (validation.success) {
                regenBoundedContexts = validation.data;
                regeneratedBoundedContexts = true;
                break;
              }
              const fields = (validation as { fields: string[] }).fields;
              lastError = `bounded contexts validation: ${fields.join(', ')}`;
              onError?.({ stage: 'layers', kind: 'schema_validation', jobId: 'bounded-contexts', attempt, message: lastError });
            } else {
              lastError = 'invalid JSON from LLM';
              onError?.({ stage: 'layers', kind: 'invalid_json', jobId: 'bounded-contexts', attempt, message: lastError });
            }
          } catch (bcErr) {
            if (isPlannerAbortError(bcErr) || signal?.aborted) throw new PlannerAbortError();
            lastError = bcErr instanceof Error ? bcErr.message : String(bcErr);
            onError?.({ stage: 'layers', kind: 'provider_error', jobId: 'bounded-contexts', attempt, message: lastError });
          }
        }
        if (!regenBoundedContexts) {
          partialFailures += 1;
        }
      } finally {
        this.projectStore.finishActivity(bcActivityId);
      }
    }

    let regenSystemOverview: { boundedContextMap?: string; c4ContextDiagram?: string; c4ContainerDiagram?: string } | null = null;
    let regeneratedSystemOverview = false;
    {
      const soActivityId = this.projectStore.startActivity({
        stage: 'layers',
        agentId: layerSkill?.agentId ?? null,
        skillId: layerSkill?.skill.id ?? null,
        label: 'regen:system-overview',
        kind: 'stage',
      });
      try {
        let lastError = '';
        for (let attempt = 1; attempt <= perSectionMaxRetries; attempt += 1) {
          if (signal?.aborted) throw new PlannerAbortError();
          try {
            const prompt = await this.promptBuilder.buildRegenerateSystemOverviewPrompt({
              currentPlan,
              editSummary,
              schema: this.schemaService.jsonSchema,
              skillOverride: layerSkill,
              retryContext: lastError,
              refinementInstruction,
              originalInput,
            });
            const rendered = (await prompt.format({})) as { toString(): string } | string;
            const text = typeof rendered === 'string' ? rendered : (rendered as { toString(): string }).toString();
            const result = await llmInvoker(text);
            const parsed = parseFirstJsonObjectResult(result.text);
            if (parsed.ok) {
              const candidate = parsed.value as Record<string, unknown>;
              const next: { boundedContextMap?: string; c4ContextDiagram?: string; c4ContainerDiagram?: string } = {};
              if (typeof candidate['boundedContextMap'] === 'string' && candidate['boundedContextMap'].length > 0) {
                next.boundedContextMap = candidate['boundedContextMap'];
              }
              if (typeof candidate['c4'] === 'object' && candidate['c4']) {
                const c4 = candidate['c4'] as Record<string, unknown>;
                if (typeof c4['contextDiagram'] === 'string' && c4['contextDiagram'].length > 0) {
                  next.c4ContextDiagram = c4['contextDiagram'];
                }
                if (typeof c4['containerDiagram'] === 'string' && c4['containerDiagram'].length > 0) {
                  next.c4ContainerDiagram = c4['containerDiagram'];
                }
              } else {
                if (typeof candidate['c4ContextDiagram'] === 'string' && candidate['c4ContextDiagram'].length > 0) {
                  next.c4ContextDiagram = candidate['c4ContextDiagram'];
                }
                if (typeof candidate['c4ContainerDiagram'] === 'string' && candidate['c4ContainerDiagram'].length > 0) {
                  next.c4ContainerDiagram = candidate['c4ContainerDiagram'];
                }
              }
              if (next.boundedContextMap || next.c4ContextDiagram || next.c4ContainerDiagram) {
                regenSystemOverview = next;
                regeneratedSystemOverview = true;
                break;
              }
              lastError = 'system overview returned no usable mermaid strings';
              onError?.({ stage: 'layers', kind: 'schema_validation', jobId: 'system-overview', attempt, message: lastError });
            } else {
              lastError = 'invalid JSON from LLM';
              onError?.({ stage: 'layers', kind: 'invalid_json', jobId: 'system-overview', attempt, message: lastError });
            }
          } catch (soErr) {
            if (isPlannerAbortError(soErr) || signal?.aborted) throw new PlannerAbortError();
            lastError = soErr instanceof Error ? soErr.message : String(soErr);
            onError?.({ stage: 'layers', kind: 'provider_error', jobId: 'system-overview', attempt, message: lastError });
          }
        }
        if (!regenSystemOverview) {
          partialFailures += 1;
        }
      } finally {
        this.projectStore.finishActivity(soActivityId);
      }
    }

    const hasAdditionsSignal =
      !!refinementInstruction &&
      Boolean(
        refinementInstruction.instruction.trim() ||
          refinementInstruction.answers.some((a) => a.value.trim()) ||
          refinementInstruction.userPrompt?.trim() ||
          (refinementInstruction.chatTranscript ?? []).some((t) => t.text.trim()),
      );

    let additionalLayers: unknown[] | null = null;
    let additionalDomains: unknown[] | null = null;
    let additionalBoundedContexts: unknown[] | null = null;
    let additionsEntityCount = 0;

    if (hasAdditionsSignal) {
      const additionsActivityId = this.projectStore.startActivity({
        stage: 'layers',
        agentId: layerSkill?.agentId ?? null,
        skillId: layerSkill?.skill.id ?? null,
        label: 'regen:additions',
        kind: 'stage',
      });
      try {
        const userRequestedDomain = refinementMentionsDomain(refinementInstruction);
        const userRequestedLayer = refinementMentionsLayer(refinementInstruction);
        const userRequestedBoundedContext = refinementMentionsBoundedContext(refinementInstruction);
        let lastError = '';
        for (let attempt = 1; attempt <= perSectionMaxRetries; attempt += 1) {
          if (signal?.aborted) throw new PlannerAbortError();
          try {
            const prompt = await this.promptBuilder.buildRegenerateAdditionsPrompt({
              currentPlan,
              editSummary,
              schema: this.schemaService.jsonSchema,
              skillOverride: layerSkill,
              retryContext: lastError,
              refinementInstruction,
              originalInput,
            });
            const rendered = (await prompt.format({})) as { toString(): string } | string;
            const text = typeof rendered === 'string' ? rendered : (rendered as { toString(): string }).toString();
            const result = await llmInvoker(text);
            const parsed = parseFirstJsonObjectResult(result.text);
            if (parsed.ok) {
              const validated = this.pickAdditions(parsed.value);
              const keywordReminder = buildKeywordReminderError({
                userRequestedDomain,
                userRequestedLayer,
                userRequestedBoundedContext,
                returnedLayers: validated.layers.length,
                returnedDomains: validated.domains.length,
                returnedBoundedContexts: validated.boundedContexts.length,
              });
              if (validated.entitiesFound > 0) {
                additionalLayers = validated.layers;
                additionalDomains = validated.domains;
                additionalBoundedContexts = validated.boundedContexts;
                additionsEntityCount = validated.acceptedCount;
                for (const drop of validated.dropped) {
                  onError?.({
                    stage: 'layers',
                    kind: 'schema_validation',
                    jobId: 'additions',
                    attempt,
                    message: `additions dropped ${drop.kind}[id=${drop.id}]: ${drop.reason}`,
                  });
                }
                if (validated.acceptedCount > 0) {
                  break;
                }
                lastError = `additions returned ${validated.entitiesFound} entities but none passed schema validation: ${validated.dropped.map(d => `${d.kind}[${d.id}]`).join(', ')}. ${keywordReminder}`;
                continue;
              }
              if (validated.dropped.length > 0) {
                lastError = `additions response had no new entries (got ${validated.entitiesFound} candidates but all failed validation: ${validated.dropped.map(d => `${d.kind}[${d.id}]: ${d.reason}`).join('; ')}). ${keywordReminder}`;
              } else {
                lastError = `additions response had no new layers, domains, or bounded contexts (refinement may not imply any structural additions). ${keywordReminder}`;
              }
              onError?.({ stage: 'layers', kind: 'schema_validation', jobId: 'additions', attempt, message: lastError });
              // If the user explicitly asked for a structural kind (domain/layer/bounded context) and
              // the LLM ignored it, retry the additions stage with the keyword reminder appended so
              // the next attempt has a stronger nudge toward producing the missing kind.
              if (
                keywordReminder.length > 0 &&
                (userRequestedDomain || userRequestedLayer || userRequestedBoundedContext) &&
                attempt < perSectionMaxRetries
              ) {
                continue;
              }
              break;
            } else {
              lastError = `invalid JSON from additions LLM (${parsed.kind} near position ${parsed.position})`;
              onError?.({ stage: 'layers', kind: 'invalid_json', jobId: 'additions', attempt, message: lastError });
            }
          } catch (addErr) {
            if (isPlannerAbortError(addErr) || signal?.aborted) throw new PlannerAbortError();
            lastError = addErr instanceof Error ? addErr.message : String(addErr);
            onError?.({ stage: 'layers', kind: 'provider_error', jobId: 'additions', attempt, message: lastError });
          }
        }
        if (!additionalLayers && !additionalDomains && !additionalBoundedContexts) {
          partialFailures += 1;
        }
      } finally {
        this.projectStore.finishActivity(additionsActivityId);
      }
    }

    const mergeResult = this.schemaService.mergeRegeneratedSectioned(
      currentPlan,
      {
        architectureLayers: flatLayers.length > 0 ? flatLayers.flat() : undefined,
        domains: flatDomains.length > 0 ? flatDomains.flat() : undefined,
        boundedContexts: regenBoundedContexts ?? undefined,
        workflows: tailValue.workflows,
        adrs: tailValue.adrs,
        agentTasks: tailValue.agentTasks,
        additionalLayers: additionalLayers ?? undefined,
        additionalDomains: additionalDomains ?? undefined,
        additionalBoundedContexts: additionalBoundedContexts ?? undefined,
      },
      {
        removedBoundedContextIds: new Set(
          editSummary.removedElements
            .filter((e) => e.kind === 'boundedContext')
            .map((e) => e.id),
        ),
      },
    );
    if (!mergeResult.ok) {
      const reason = mergeResult.reason;
      throw {
        type: 'stage_failed',
        stage: 'merge',
        message: reason,
      } satisfies PlannerError;
    }
    let mergedPlan = mergeResult.plan;
    let sanitisedDiagramCount = mergeResult.sanitisedCount ?? 0;

    if (regenSystemOverview) {
      if (regenSystemOverview.boundedContextMap !== undefined) {
        const r = this.schemaService.replacePlanField(
          mergedPlan,
          'systemOverview.boundedContextMap',
          regenSystemOverview.boundedContextMap,
        );
        if (r.ok) {
          mergedPlan = r.plan;
          sanitisedDiagramCount += r.sanitisedCount;
        }
      }
      if (regenSystemOverview.c4ContextDiagram !== undefined) {
        const r = this.schemaService.replacePlanField(
          mergedPlan,
          'systemOverview.c4.contextDiagram',
          regenSystemOverview.c4ContextDiagram,
        );
        if (r.ok) {
          mergedPlan = r.plan;
          sanitisedDiagramCount += r.sanitisedCount;
        }
      }
      if (regenSystemOverview.c4ContainerDiagram !== undefined) {
        const r = this.schemaService.replacePlanField(
          mergedPlan,
          'systemOverview.c4.containerDiagram',
          regenSystemOverview.c4ContainerDiagram,
        );
        if (r.ok) {
          mergedPlan = r.plan;
          sanitisedDiagramCount += r.sanitisedCount;
        }
      }
    }

    if (sanitisedDiagramCount > 0) {
      const audit = this.projectStore.diagramAudit();
      const current = audit?.repaired ?? 0;
      this.projectStore.setDiagramAuditRepaired(current + sanitisedDiagramCount);
    }

    const additionsProduced =
      (additionalLayers?.length ?? 0) +
      (additionalDomains?.length ?? 0) +
      (additionalBoundedContexts?.length ?? 0);
    const totalSections = layerJobs.length + domainJobs.length + 1 + (hasAdditionsSignal ? 1 : 0);
    const regeneratedSections =
      regeneratedLayerCount +
      regeneratedDomainCount +
      (regeneratedTail ? 1 : 0) +
      (regeneratedBoundedContexts ? 1 : 0) +
      (regeneratedSystemOverview ? 1 : 0) +
      (additionsProduced > 0 ? additionsEntityCount : 0);
    if (regeneratedSections === 0) {
      throw {
        type: 'stage_failed',
        stage: 'merge',
        message: `Regeneration did not produce any usable output for any of ${totalSections} sections; the chat transcript likely exceeded the model's context window. Try a shorter refinement instruction or clear the chat before regenerating.`,
      } satisfies PlannerError;
    }
    const newLayerJson = JSON.stringify(mergedPlan.architectureLayers);
    const baseLayerJson = JSON.stringify(currentPlan.architectureLayers);
    const newDomainJson = JSON.stringify(mergedPlan.domains);
    const baseDomainJson = JSON.stringify(currentPlan.domains);
    const newTailJson = JSON.stringify({
      workflows: mergedPlan.workflows,
      adrs: mergedPlan.adrs,
      agentTasks: mergedPlan.agentTasks,
    });
    const baseTailJson = JSON.stringify({
      workflows: currentPlan.workflows,
      adrs: currentPlan.adrs,
      agentTasks: currentPlan.agentTasks,
    });
    const newBcJson = JSON.stringify(mergedPlan.boundedContexts);
    const baseBcJson = JSON.stringify(currentPlan.boundedContexts);
    const newBcm = JSON.stringify(mergedPlan.systemOverview.boundedContextMap ?? null);
    const baseBcm = JSON.stringify(currentPlan.systemOverview.boundedContextMap ?? null);
    const newC4Ctx = JSON.stringify(mergedPlan.systemOverview.c4.contextDiagram);
    const baseC4Ctx = JSON.stringify(currentPlan.systemOverview.c4.contextDiagram);
    const newC4Con = JSON.stringify(mergedPlan.systemOverview.c4.containerDiagram);
    const baseC4Con = JSON.stringify(currentPlan.systemOverview.c4.containerDiagram);
    const planHadRealChanges =
      newLayerJson !== baseLayerJson ||
      newDomainJson !== baseDomainJson ||
      newTailJson !== baseTailJson ||
      newBcJson !== baseBcJson ||
      newBcm !== baseBcm ||
      newC4Ctx !== baseC4Ctx ||
      newC4Con !== baseC4Con;
    if (!planHadRealChanges) {
      throw {
        type: 'stage_failed',
        stage: 'merge',
        message:
          'Regeneration produced output, but it did not change any layer, domain, tail, bounded context, or systemOverview diagram against the existing plan. Refine with a more specific instruction and try again.',
      } satisfies PlannerError;
    }

    const reconcileResult = this.schemaService.reconcileStructuralChanges(mergedPlan, editSummary);

    let auditFindings: AuditFinding[] = [];
    try {
      auditFindings = this.auditRunner.run(reconcileResult.plan);
    } catch (auditError) {
      if (isPlannerAbortError(auditError)) throw auditError;
      throw {
        type: 'stage_failed',
        stage: 'merge',
        message: `Audit runner failed during regeneration: ${auditError instanceof Error ? auditError.message : String(auditError)}`,
      } satisfies PlannerError;
    }
    this.projectStore.setLastAuditFindings(auditFindings);

    let finalPlan = reconcileResult.plan;
    if (auditFindings.some((f) => f.severity === 'error')) {
      try {
        const repairResult = await this.auditRepair.invoke(
          reconcileResult.plan,
          auditFindings,
          llmInvoker,
          originalInput,
          refinementInstruction,
        );
        finalPlan = repairResult.plan;
        this.projectStore.setLastAuditFindings(repairResult.residualFindings);
      } catch (repairError) {
        if (isPlannerAbortError(repairError)) throw repairError;
      }
    }

    const verification = this.schemaService.validate(finalPlan);
    if (!verification.success) {
      throw {
        type: 'stage_failed',
        stage: 'merge',
        message: `Final regenerated plan failed schema validation: ${verification.fields.join(', ')}`,
        fields: verification.fields,
      } satisfies PlannerError;
    }

    return {
      plan: this.stampUserIdea(verification.plan, originalInput.idea),
      structuralAdjustments: reconcileResult.adjustments + additionsEntityCount,
      partialFailures,
    };
  }

  async generateSectioned(
    input: GeneratePromptInput,
    config: PlannerRunConfig,
  ): Promise<PlannerRunResult> {
    const maxRetries = config.maxRetries ?? 4;
    const signal = config.signal;
    const onProgress = config.onProgress;
    const maxAttempts = Math.max(1, this.projectStore.config().plannerMaxAttempts ?? 75);
    const throwIfAborted = (): void => {
      if (signal?.aborted) throw new PlannerAbortError();
    };
    const budgetExceededError = (attemptsSoFar: number): PlannerError => ({
      type: 'stage_failed',
      stage: 'merge',
      message: `Planner run aborted after ${attemptsSoFar} LLM calls — exceeded plannerMaxAttempts budget of ${maxAttempts}.`,
    });

    const emitProgress = (state: Partial<PlannerRunProgress>): void => {
      onProgress?.({
        input,
        stage: 'scaffold',
        scaffold: null,
        layers: [],
        domains: [],
        tail: null,
        ...state,
      });
    };

    const scaffoldSkill = resolveSkillForStage(this.agents, 'scaffold');
    const layerSkill = resolveSkillForStage(this.agents, 'layers');
    const domainSkill = resolveSkillForStage(this.agents, 'domains');
    const tailSkill = resolveSkillForStage(this.agents, 'tail');

    const caps = scoreIdeaComplexity(input);

    throwIfAborted();
    const scaffoldActivityId = this.projectStore.startActivity({
      stage: 'scaffold',
      agentId: scaffoldSkill?.agentId ?? null,
      skillId: scaffoldSkill?.skill.id ?? null,
      label: null,
      kind: 'stage',
    });

    const scaffold = await this.runStage<Scaffold>({
      name: 'scaffold',
      maxRetries,
      llmInvoker: config.llmInvoker,
      buildPrompt: (retry) =>
        this.promptBuilder.buildScaffoldPrompt(
          input,
          retry,
          scaffoldSkill,
          caps,
          config.refinementContext,
        ),
      parse: parseFirstJsonObjectResult,
      validate: this.schemaService.validateScaffold.bind(this.schemaService),
      onError: config.onError,
      signal,
    });
    this.projectStore.finishActivity(scaffoldActivityId);

    if (scaffold.failure) {
      return { plan: null, error: scaffold.failure, attempts: scaffold.attempts };
    }

    let scaffoldValue = this.applyScaffoldCaps(scaffold.value as Scaffold, caps);
    emitProgress({ stage: 'scaffold', scaffold: scaffoldValue });

    const perJobRetries = computePerJobRetries(
      maxAttempts,
      maxRetries,
      scaffoldValue.architectureLayerIds.length,
      scaffoldValue.domainIds.length,
    );





    throwIfAborted();
    const layerHooks = this.parallelHooksFrom(config.onError, 'layers');
    const domainHooks = this.parallelHooksFrom(config.onError, 'domains');
    const tailActivityId = this.projectStore.startActivity({
      stage: 'tail',
      agentId: tailSkill?.agentId ?? null,
      skillId: tailSkill?.skill.id ?? null,
      label: null,
      kind: 'stage',
    });
    const [layerChunks, domainChunks, tailResult] = await Promise.all([
      this.runParallelLayers(
        input,
        scaffoldValue,
        config.llmInvoker,
        layerSkill,
        perJobRetries,
        layerHooks,
        signal,
        config.refinementContext,
      ),
      this.runParallelDomains(
        input,
        scaffoldValue,
        config.llmInvoker,
        domainSkill,
        perJobRetries,
        domainHooks,
        signal,
        config.refinementContext,
      ),
      this.runStage<Tail>({
        name: 'tail',
        maxRetries,
        llmInvoker: config.llmInvoker,
        buildPrompt: (retry) =>
          this.promptBuilder.buildTailPrompt(
            input,
            scaffoldValue,
            retry,
            tailSkill,
            config.refinementContext,
          ),
        parse: parseFirstJsonObjectResult,
        validate: this.schemaService.validateTail.bind(this.schemaService),
        onError: config.onError,
        signal,
      }),
    ]);
    this.projectStore.finishActivity(tailActivityId);

    if (layerChunks.error) {
      return {
        plan: null,
        error: this.annotateParallelError(
          layerChunks.error,
          'layers',
          scaffoldValue.architectureLayerIds,
        ),
        attempts: layerChunks.attempts + domainChunks.attempts + tailResult.attempts,
      };
    }

    const layerValues = layerChunks.value ?? [];
    emitProgress({ stage: 'layers', scaffold: scaffoldValue, layers: layerValues });

    if (domainChunks.error) {
      return {
        plan: null,
        error: this.annotateParallelError(domainChunks.error, 'domains', scaffoldValue.domainIds),
        attempts:
          scaffold.attempts + layerChunks.attempts + domainChunks.attempts + tailResult.attempts,
      };
    }

    const domainValues = domainChunks.value ?? [];
    emitProgress({
      stage: 'domains',
      scaffold: scaffoldValue,
      layers: layerValues,
      domains: domainValues,
    });

    if (tailResult.failure) {
      return {
        plan: null,
        error: tailResult.failure,
        attempts:
          scaffold.attempts + layerChunks.attempts + domainChunks.attempts + tailResult.attempts,
      };
    }

    const tailValue = tailResult.value as Tail;
    emitProgress({
      stage: 'tail',
      scaffold: scaffoldValue,
      layers: layerValues,
      domains: domainValues,
      tail: tailValue,
    });

    const totalAttempts =
      scaffold.attempts + layerChunks.attempts + domainChunks.attempts + tailResult.attempts;
    if (totalAttempts > maxAttempts) {
      return {
        plan: null,
        attempts: totalAttempts,
        error: budgetExceededError(totalAttempts),
      };
    }

    try {







      if (!Array.isArray(layerValues)) {
        throw new Error(
          `Internal merge error: layers chunk is ${typeof layerValues} (${describeShape(
            layerValues,
          )}); expected an array of layer objects.`,
        );
      }
      if (!Array.isArray(domainValues)) {
        throw new Error(
          `Internal merge error: domains chunk is ${typeof domainValues} (${describeShape(
            domainValues,
          )}); expected an array of domain objects.`,
        );
      }
      if (!tailValue || typeof tailValue !== 'object') {
        throw new Error(
          `Internal merge error: tail is ${typeof tailValue} (${describeShape(
            tailValue,
          )}); expected a Tail object with workflows / adrs / agentTasks.`,
        );
      }
      for (const tailField of ['workflows', 'adrs', 'agentTasks'] as const) {
        if (!Array.isArray((tailValue as Record<string, unknown>)[tailField])) {
          throw new Error(
            `Internal merge error: tail.${tailField} is ${typeof (tailValue as Record<string, unknown>)[tailField]} (${describeShape(
              (tailValue as Record<string, unknown>)[tailField],
            )}); expected an array.`,
          );
        }
      }

      let merged: Plan;
      let sanitisedDiagramCount = 0;
      try {
        const mergeResult = this.schemaService.mergeScaffold({
          scaffold: scaffoldValue,
          layers: layerValues,
          domains: domainValues,
          tail: tailValue,
        });
        if (!mergeResult.success) {
          throw new Error(
            `mergeScaffold failed (${mergeResult.field}): ${mergeResult.error} (layers shape: ${describeShape(layerValues)}; domains shape: ${describeShape(domainValues)}; tail shape: ${describeShape(tailValue)})`,
          );
        }
        merged = mergeResult.value;
        sanitisedDiagramCount = mergeResult.sanitisedCount ?? 0;
      } catch (e) {
        if (isPlannerAbortError(e)) throw e;



        throw new Error(
          `mergeScaffold failed: ${
            e instanceof Error ? e.message : String(e)
          } (layers shape: ${describeShape(layerValues)}; domains shape: ${describeShape(domainValues)}; tail shape: ${describeShape(tailValue)})`,
        );
      }





      let auditFindings: AuditFinding[];
      try {
        auditFindings = this.auditRunner.run(merged);
      } catch (e) {
        if (isPlannerAbortError(e)) throw e;
        throw new Error(
          `auditRunner.run failed: ${
            e instanceof Error ? e.message : String(e)
          } (plan shape: ${describeShape(merged)})`,
        );
      }
      this.projectStore.setLastAuditFindings(auditFindings);

      let finalPlan = merged;
      let residual: AuditFinding[] = auditFindings;
      const repairActivityId = this.projectStore.startActivity({
        stage: 'audit-repair',
        agentId: 'agent-3',
        skillId: 'skill-6',
        label: null,
        kind: 'audit-repair',
      });
      try {
        if (auditFindings.some((f) => f.severity === 'error')) {
          let repairResult;
          try {
            repairResult = await this.auditRepair.invoke(
              merged,
              auditFindings,
              config.llmInvoker,
              input,
            );
          } catch (e) {
            if (isPlannerAbortError(e)) throw e;
            throw new Error(
              `auditRepair.invoke failed: ${
                e instanceof Error ? e.message : String(e)
              } (plan shape: ${describeShape(merged)})`,
            );
          }
          finalPlan = repairResult.plan;
          residual = repairResult.residualFindings;
        }
      } finally {
        this.projectStore.finishActivity(repairActivityId);
      }
      this.projectStore.setLastAuditFindings(residual);









      const diagramRepairActivityId = this.projectStore.startActivity({
        stage: 'diagram-repair',
        agentId: 'agent-5',
        skillId: 'skill-9',
        label: null,
        kind: 'audit-repair',
      });
      let mermaidVerifyResult;
      try {
        mermaidVerifyResult = await this.mermaidVerify.verifyAndFix(
          finalPlan,
          config.llmInvoker,
          signal,
        );
      } catch (e) {
        if (isPlannerAbortError(e)) throw e;
        throw new Error(
          `mermaidVerify.verifyAndFix failed: ${
            e instanceof Error ? e.message : String(e)
          } (plan shape: ${describeShape(finalPlan)})`,
        );
      } finally {
        this.projectStore.finishActivity(diagramRepairActivityId);
      }
      finalPlan = mermaidVerifyResult.plan;
      if (Object.keys(mermaidVerifyResult.synthesisedPatches).length > 0) {
        this.projectStore.mergeSynthesisedDiagramPatches(
          mermaidVerifyResult.synthesisedPatches,
        );
      }
      if (mermaidVerifyResult.repairedCount > 0 || sanitisedDiagramCount > 0) {




        const auditRepairFixes =
          auditFindings.filter((f) => f.severity === 'error').length -
          residual.filter((f) => f.severity === 'error').length;
        this.projectStore.setDiagramAuditRepaired(
          Math.max(
            0,
            auditRepairFixes + mermaidVerifyResult.repairedCount + sanitisedDiagramCount,
          ),
        );
      }




      if (mermaidVerifyResult.residual.length > 0) {
        const residualFindings = this.mermaidVerify.residualToFindings(
          mermaidVerifyResult.residual,
        );
        const merged = [...residual, ...residualFindings];
        this.projectStore.setLastAuditFindings(merged);
      }

      emitProgress({
        stage: 'done',
        scaffold: scaffoldValue,
        layers: layerValues,
        domains: domainValues,
        tail: tailValue,
      });

      return {
        plan: this.stampUserIdea(finalPlan, input.idea),
        error: null,
        attempts: totalAttempts,
      };
    } catch (error) {
      if (isPlannerAbortError(error)) {

        throw error;
      }









      const salvaged = this.buildSalvagedPlan(scaffoldValue);
      if (salvaged) {

        // eslint-disable-next-line no-console
        console.error(
          '[planner] merge stage failed; salvaged a stub-only plan so the user keeps a complete (if skeletal) document.',
          error instanceof Error ? error.message : String(error),
        );
        const residual: AuditFinding[] = [];
        this.projectStore.setLastAuditFindings(residual);
        emitProgress({
          stage: 'done',
          scaffold: scaffoldValue,
          layers: layerValues,
          domains: domainValues,
          tail: tailValue,
        });
        return {
          plan: salvaged,
          error: null,
          attempts: totalAttempts,
        };
      }
      return {
        plan: null,
        attempts: totalAttempts,
        error: {
          type: 'stage_failed',
          message: `Merging staged plan failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          stage: 'merge',
        },
      };
    }
  }

  async resumeFromCheckpoint(
    progress: PlannerRunProgress,
    config: PlannerRunConfig,
  ): Promise<PlannerRunResult> {
    const { input } = progress;
    const maxRetries = config.maxRetries ?? 4;
    const signal = config.signal;
    const onProgress = config.onProgress;
    const maxAttempts = Math.max(1, this.projectStore.config().plannerMaxAttempts ?? 75);

    const throwIfAborted = (): void => {
      if (signal?.aborted) throw new PlannerAbortError();
    };

    const emitProgress = (state: Partial<PlannerRunProgress>): void => {
      onProgress?.({
        input,
        stage: progress.stage,
        scaffold: progress.scaffold,
        layers: progress.layers,
        domains: progress.domains,
        tail: progress.tail,
        ...state,
      });
    };

    if (!progress.scaffold) {

      return this.generateSectioned(input, config);
    }

    const scaffoldValue = progress.scaffold;
    const scaffoldSkill = resolveSkillForStage(this.agents, 'scaffold');
    const layerSkill = resolveSkillForStage(this.agents, 'layers');
    const domainSkill = resolveSkillForStage(this.agents, 'domains');
    const tailSkill = resolveSkillForStage(this.agents, 'tail');

    let layerValues: unknown[] = progress.layers;
    let domainValues: unknown[] = progress.domains;
    let tailValue: Tail | null = progress.tail;

    const stageIdx = ['scaffold', 'layers', 'domains', 'tail', 'merge', 'done'].indexOf(
      progress.stage,
    );





    const caps = scoreIdeaComplexity(input);
    let mutableScaffold: Scaffold = this.applyScaffoldCaps(scaffoldValue, caps);
    const perJobRetries = computePerJobRetries(
      maxAttempts,
      maxRetries,
      mutableScaffold.architectureLayerIds.length,
      mutableScaffold.domainIds.length,
    );

    let layerAttempts = 0;
    let domainAttempts = 0;
    let tailAttempts = 0;

    if (stageIdx < 1) {
      throwIfAborted();
      const layerHooks = this.parallelHooksFrom(config.onError, 'layers');
      const layerChunks = await this.runParallelLayers(
        input,
        mutableScaffold,
        config.llmInvoker,
        layerSkill,
        perJobRetries,
        layerHooks,
        signal,
        config.refinementContext,
      );
      layerAttempts = layerChunks.attempts;
      if (layerChunks.error) {
        return {
          plan: null,
          error: this.annotateParallelError(
            layerChunks.error,
            'layers',
            mutableScaffold.architectureLayerIds,
          ),
          attempts: layerChunks.attempts,
        };
      }
      layerValues = layerChunks.value ?? [];
      emitProgress({ stage: 'layers', layers: layerValues });
    }

    if (stageIdx < 2) {
      throwIfAborted();
      const domainHooks = this.parallelHooksFrom(config.onError, 'domains');
      const domainChunks = await this.runParallelDomains(
        input,
        mutableScaffold,
        config.llmInvoker,
        domainSkill,
        perJobRetries,
        domainHooks,
        signal,
        config.refinementContext,
      );
      domainAttempts = domainChunks.attempts;
      if (domainChunks.error) {
        return {
          plan: null,
          error: this.annotateParallelError(
            domainChunks.error,
            'domains',
            mutableScaffold.domainIds,
          ),
          attempts: layerAttempts + domainChunks.attempts,
        };
      }
      domainValues = domainChunks.value ?? [];
      emitProgress({ stage: 'domains', layers: layerValues, domains: domainValues });
    }

    if (stageIdx < 3 || !tailValue) {
      throwIfAborted();
      const tailActivityId = this.projectStore.startActivity({
        stage: 'tail',
        agentId: tailSkill?.agentId ?? null,
        skillId: tailSkill?.skill.id ?? null,
        label: null,
        kind: 'stage',
      });
      const tail = await this.runStage<Tail>({
        name: 'tail',
        maxRetries,
        llmInvoker: config.llmInvoker,
        buildPrompt: (retry) =>
          this.promptBuilder.buildTailPrompt(
            input,
            mutableScaffold,
            retry,
            tailSkill,
            config.refinementContext,
          ),
        parse: parseFirstJsonObjectResult,
        validate: this.schemaService.validateTail.bind(this.schemaService),
        onError: config.onError,
        signal,
      });
      this.projectStore.finishActivity(tailActivityId);
      tailAttempts = tail.attempts;
      if (tail.failure) {
        return {
          plan: null,
          error: tail.failure,
          attempts: layerAttempts + domainAttempts + tail.attempts,
        };
      }
      tailValue = tail.value as Tail;
      emitProgress({ stage: 'tail', layers: layerValues, domains: domainValues, tail: tailValue });
    }

    const totalAttempts = layerAttempts + domainAttempts + tailAttempts;
    if (totalAttempts > maxAttempts) {
      return {
        plan: null,
        attempts: totalAttempts,
        error: {
          type: 'stage_failed',
          stage: 'merge',
          message: `Planner run aborted after ${totalAttempts} LLM calls — exceeded plannerMaxAttempts budget of ${maxAttempts}.`,
        },
      };
    }

    try {





      if (!Array.isArray(layerValues)) {
        throw new Error(
          `Internal resume error: layers chunk is ${typeof layerValues} (${describeShape(
            layerValues,
          )}); expected an array of layer objects.`,
        );
      }
      if (!Array.isArray(domainValues)) {
        throw new Error(
          `Internal resume error: domains chunk is ${typeof domainValues} (${describeShape(
            domainValues,
          )}); expected an array of domain objects.`,
        );
      }
      if (!tailValue || typeof tailValue !== 'object') {
        throw new Error(
          `Internal resume error: tail is ${typeof tailValue} (${describeShape(
            tailValue,
          )}); expected a Tail object with workflows / adrs / agentTasks.`,
        );
      }
      for (const tailField of ['workflows', 'adrs', 'agentTasks'] as const) {
        if (!Array.isArray((tailValue as Record<string, unknown>)[tailField])) {
          throw new Error(
            `Internal resume error: tail.${tailField} is ${typeof (tailValue as Record<string, unknown>)[tailField]} (${describeShape(
              (tailValue as Record<string, unknown>)[tailField],
            )}); expected an array.`,
          );
        }
      }

      let merged: Plan;
      let sanitisedDiagramCount = 0;
      try {
        const mergeResult = this.schemaService.mergeScaffold({
          scaffold: mutableScaffold,
          layers: layerValues,
          domains: domainValues,
          tail: tailValue,
        });
        if (!mergeResult.success) {
          throw new Error(
            `mergeScaffold failed (${mergeResult.field}): ${mergeResult.error} (layers shape: ${describeShape(layerValues)}; domains shape: ${describeShape(domainValues)}; tail shape: ${describeShape(tailValue)})`,
          );
        }
        merged = mergeResult.value;
        sanitisedDiagramCount = mergeResult.sanitisedCount ?? 0;
      } catch (e) {
        if (isPlannerAbortError(e)) throw e;
        throw new Error(
          `mergeScaffold failed: ${
            e instanceof Error ? e.message : String(e)
          } (layers shape: ${describeShape(layerValues)}; domains shape: ${describeShape(domainValues)}; tail shape: ${describeShape(tailValue)})`,
        );
      }

      let auditFindings: AuditFinding[];
      try {
        auditFindings = this.auditRunner.run(merged);
      } catch (e) {
        if (isPlannerAbortError(e)) throw e;
        throw new Error(
          `auditRunner.run failed: ${
            e instanceof Error ? e.message : String(e)
          } (plan shape: ${describeShape(merged)})`,
        );
      }
      this.projectStore.setLastAuditFindings(auditFindings);

      let finalPlan = merged;
      let residual: AuditFinding[] = auditFindings;
      const repairActivityId = this.projectStore.startActivity({
        stage: 'audit-repair',
        agentId: 'agent-3',
        skillId: 'skill-6',
        label: null,
        kind: 'audit-repair',
      });
      try {
        if (auditFindings.some((f) => f.severity === 'error')) {
          let repairResult;
          try {
            repairResult = await this.auditRepair.invoke(
              merged,
              auditFindings,
              config.llmInvoker,
              input,
            );
          } catch (e) {
            if (isPlannerAbortError(e)) throw e;
            throw new Error(
              `auditRepair.invoke failed: ${
                e instanceof Error ? e.message : String(e)
              } (plan shape: ${describeShape(merged)})`,
            );
          }
          finalPlan = repairResult.plan;
          residual = repairResult.residualFindings;
        }
      } finally {
        this.projectStore.finishActivity(repairActivityId);
      }
      this.projectStore.setLastAuditFindings(residual);

      const diagramRepairActivityId = this.projectStore.startActivity({
        stage: 'diagram-repair',
        agentId: 'agent-5',
        skillId: 'skill-9',
        label: null,
        kind: 'audit-repair',
      });
      let mermaidVerifyResult;
      try {
        mermaidVerifyResult = await this.mermaidVerify.verifyAndFix(
          finalPlan,
          config.llmInvoker,
          signal,
        );
      } catch (e) {
        if (isPlannerAbortError(e)) throw e;
        throw new Error(
          `mermaidVerify.verifyAndFix failed: ${
            e instanceof Error ? e.message : String(e)
          } (plan shape: ${describeShape(finalPlan)})`,
        );
      } finally {
        this.projectStore.finishActivity(diagramRepairActivityId);
      }
      finalPlan = mermaidVerifyResult.plan;
      if (Object.keys(mermaidVerifyResult.synthesisedPatches).length > 0) {
        this.projectStore.mergeSynthesisedDiagramPatches(
          mermaidVerifyResult.synthesisedPatches,
        );
      }
      if (mermaidVerifyResult.repairedCount > 0 || sanitisedDiagramCount > 0) {
        const auditRepairFixes =
          auditFindings.filter((f) => f.severity === 'error').length -
          residual.filter((f) => f.severity === 'error').length;
        this.projectStore.setDiagramAuditRepaired(
          Math.max(
            0,
            auditRepairFixes + mermaidVerifyResult.repairedCount + sanitisedDiagramCount,
          ),
        );
      }
      if (mermaidVerifyResult.residual.length > 0) {
        const residualFindings = this.mermaidVerify.residualToFindings(
          mermaidVerifyResult.residual,
        );
        const merged = [...residual, ...residualFindings];
        this.projectStore.setLastAuditFindings(merged);
      }

      emitProgress({ stage: 'done', layers: layerValues, domains: domainValues, tail: tailValue });

      return { plan: this.stampUserIdea(finalPlan, input.idea), error: null, attempts: totalAttempts };
    } catch (error) {
      if (isPlannerAbortError(error)) {
        throw error;
      }
      const salvaged = this.buildSalvagedPlan(mutableScaffold);
      if (salvaged) {
        // eslint-disable-next-line no-console
        console.error(
          '[planner] resume merge stage failed; salvaged a stub-only plan so the user keeps a complete (if skeletal) document.',
          error instanceof Error ? error.message : String(error),
        );
        const residual: AuditFinding[] = [];
        this.projectStore.setLastAuditFindings(residual);
        emitProgress({ stage: 'done', layers: layerValues, domains: domainValues, tail: tailValue });
        return { plan: this.stampUserIdea(salvaged, input.idea), error: null, attempts: totalAttempts };
      }
      return {
        plan: null,
        attempts: totalAttempts,
        error: {
          type: 'stage_failed',
          message: `Resuming staged plan failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          stage: 'merge',
        },
      };
    }
  }

  private async runStage<R>(args: {
    name: StageKind;
    maxRetries: number;
    llmInvoker: (promptText: string) => Promise<LlmInvokerResult>;
    buildPrompt: (retryContext: string) => Promise<{ format: (vars: object) => Promise<unknown> }>;
    parse: (raw: string) => ParseResult;
    validate: (value: unknown) => StageValidationResult<StageKind, R>;
    onError?: (event: PlannerErrorEvent) => void;
    signal?: AbortSignal;
  }): Promise<{
    value: R | null;
    failure: PlannerError | null;
    attempts: number;
  }> {
    const { name, maxRetries, llmInvoker, buildPrompt, parse, validate, onError, signal } = args;
    let retryContext = '';
    let lastFinishReason: string | undefined;







    const recentSignatures: string[] = [];

    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
      if (signal?.aborted) throw new PlannerAbortError();

      const prompt = await buildPrompt(retryContext);
      const rendered = (await prompt.format({})) as { toString(): string } | string;
      const promptText =
        typeof rendered === 'string' ? rendered : (rendered as { toString(): string }).toString();

      let raw: string;
      try {
        const result = await llmInvoker(promptText);
        raw = result.text;
        lastFinishReason = result.finishReason;
      } catch (error) {
        if (signal?.aborted || (error instanceof Error && /abort/i.test(error.message))) {
          throw new PlannerAbortError();
        }
        const message = error instanceof Error ? error.message : String(error);
        recentSignatures.push('provider_error');
        if (recentSignatures.length > 3) recentSignatures.shift();
        onError?.({ stage: name, kind: 'provider_error', attempt, message });
        if (this.shouldBailOnNoProgress(recentSignatures)) {



          const repair = await this.attemptRepair({
            stage: name,
            raw: '',
            llmInvoker,
            validate,
          });
          return {
            value: null,
            attempts: attempt + 1,
            failure: repair.success
              ? null
              : {
                  type: 'provider_error',
                  message: `${name} stage stopped after identical provider errors three times in a row: ${message}`,
                },
          };
        }
        if (attempt > maxRetries) {
          return {
            value: null,
            attempts: attempt,
            failure: this.llmErrors.mapLlmError(error),
          };
        }
        retryContext = `LLM call failed: ${message}`;
        continue;
      }

      const parsed = parse(raw);
      if (!parsed.ok) {
        const kind = typeof parsed['kind'] === 'string' ? parsed['kind'] : 'invalid';
        const position = typeof parsed['position'] === 'number' ? parsed['position'] : -1;
        recentSignatures.push(`parse:${kind}:${position}`);
        if (recentSignatures.length > 3) recentSignatures.shift();
        const parseMessage = this.buildParseFailure(name, parsed, lastFinishReason).message;
        onError?.({ stage: name, kind: 'invalid_json', attempt, message: parseMessage });
        if (this.shouldBailOnNoProgress(recentSignatures)) {
          const repair = await this.attemptRepair({
            stage: name,
            raw,
            llmInvoker,
            validate,
          });
          if (repair.success) {
            onError?.({
              stage: name,
              kind: 'repair',
              attempt,
              message: 'no-progress repair succeeded',
            });
            return {
              value: repair.value as R,
              failure: null,
              attempts: attempt + 1,
            };
          }





          return {
            value: null,
            attempts: attempt + 1,
            failure: this.buildParseFailure(name, parsed, lastFinishReason),
          };
        }
        if (attempt > maxRetries) {
          const repair = await this.attemptRepair({
            stage: name,
            raw,
            llmInvoker,
            validate,
          });
          if (repair.success) {
            onError?.({ stage: name, kind: 'repair', attempt, message: 'parse repair succeeded' });
            return {
              value: repair.value as R,
              failure: null,
              attempts: attempt + 1,
            };
          }
          return {
            value: null,
            attempts: attempt + 1,
            failure: this.buildParseFailure(name, parsed, lastFinishReason),
          };
        }
        retryContext = this.composeParseRetryContext(name, parsed, lastFinishReason);
        continue;
      }

      const validation = validate(parsed.value);
      if (validation.success) {





        const normalised = extractNormalisedData(validation);
        return {
          value: (normalised ?? parsed.value) as R,
          failure: null,
          attempts: attempt,
        };
      }

      const fields = (validation as { fields: string[] }).fields;
      const message = (validation as { message: string }).message;
      const fieldSignature = fields.slice().sort().join('|');
      recentSignatures.push(`schema:${fieldSignature}`);
      if (recentSignatures.length > 3) recentSignatures.shift();
      onError?.({ stage: name, kind: 'schema_validation', attempt, message });





      if (this.shouldBailOnNoProgress(recentSignatures)) {
        const repair = await this.attemptRepair({
          stage: name,
          raw,
          llmInvoker,
          validate,
        });
        if (repair.success) {
          onError?.({
            stage: name,
            kind: 'repair',
            attempt,
            message: 'no-progress repair succeeded',
          });
          return {
            value: repair.value as R,
            failure: null,
            attempts: attempt + 1,
          };
        }
        return {
          value: null,
          attempts: attempt + 1,
          failure: {
            type: 'stage_failed',
            stage: name,
            message: `${name} stage stopped after producing identical failures three times in a row (${fields.join(', ')}).`,
            fields,
          },
        };
      }

      retryContext = `Schema issues at ${name} stage: ${fields.join(', ')}`;
      if (attempt > maxRetries) {
        const repair = await this.attemptRepair({
          stage: name,
          raw,
          llmInvoker,
          validate,
        });
        if (repair.success) {
          onError?.({ stage: name, kind: 'repair', attempt, message: 'schema repair succeeded' });
          return {
            value: repair.value as R,
            failure: null,
            attempts: attempt + 1,
          };
        }
        return {
          value: null,
          attempts: attempt + 1,
          failure: {
            type: 'stage_failed',
            stage: name,
            message,
            fields,
          },
        };
      }
    }

    return {
      value: null,
      attempts: maxRetries + 1,
      failure: {
        type: 'stage_failed',
        stage: name,
        message: `${name} stage exhausted all retries without producing a valid result.`,
      },
    };
  }

  private shouldBailOnNoProgress(recent: readonly string[]): boolean {
    return (
      recent.length >= 3 &&
      recent[recent.length - 1] === recent[recent.length - 2] &&
      recent[recent.length - 2] === recent[recent.length - 3]
    );
  }

  private buildParseFailure(
    stage: StageKind,
    parsed: Extract<ParseResult, { ok: false }>,
    finishReason: string | undefined,
  ): PlannerError {
    if (finishReason === 'length' || parsed.kind === 'truncated') {
      return {
        type: 'stage_failed',
        stage,
        message: `${stage} stage output was truncated by the model (finish_reason=length).`,
      };
    }
    if (parsed.kind === 'no_start') {
      return {
        type: 'invalid_json',
        message:
          `${stage} stage: LLM returned text with no JSON object or array. ` +
          `After ${parsed.tail.length} chars of output, no opening { or [ was found. ` +
          `Raw tail: "${parsed.tail.replace(/\s+/g, ' ').slice(0, 120)}"`,
        raw: parsed.tail,
      };
    }
    return {
      type: 'invalid_json',
      message:
        `${stage} stage: ${PARSE_FAILURE_MESSAGE} ` +
        `Syntax error near position ${parsed.position}. ` +
        `Raw tail: "${parsed.tail.replace(/\s+/g, ' ').slice(0, 120)}"`,
      raw: parsed.tail,
    };
  }

  private composeParseRetryContext(
    stage: StageKind,
    parsed: Extract<ParseResult, { ok: false }>,
    finishReason: string | undefined,
  ): string {
    if (finishReason === 'length' || parsed.kind === 'truncated') {
      if (stage === 'scaffold') {
        return (
          `${stage}: previous output was truncated by the model output limit. ` +
          `Return ONLY the lean scaffold: ≤ 4 bounded contexts, ≤ 4 ubiquitousLanguage terms per context (each ≤ 60 chars), ` +
          `≤ 3 keyActors/constraints/nfrs entries, each Mermaid diagram ≤ 6 lines, no prose. ` +
          `Drop optional fields rather than running long. Start with { on line 1.`
        );
      }
      return `${stage}: previous output truncated — return a SMALLER JSON (≤10-line diagrams, drop optional fields, no prose). Start with { on line 1.`;
    }
    if (parsed.kind === 'malformed') {
      return `${stage}: previous JSON had a syntax error near position ${parsed.position}. Re-emit a clean JSON object only.`;
    }
    return `${stage}: previous output had no JSON object. Return ONLY a single balanced JSON object starting with { on line 1.`;
  }

  private async attemptRepair<R>(args: {
    stage: StageKind;
    raw: string;
    llmInvoker: (promptText: string) => Promise<LlmInvokerResult>;
    validate: (value: unknown) => StageValidationResult<StageKind, R>;
  }): Promise<{ success: true; value: R } | { success: false }> {
    const { stage, raw, llmInvoker, validate } = args;
    try {
      const prompt = await this.promptBuilder.buildRepairPrompt(stage, raw);
      const rendered = (await prompt.format({})) as { toString(): string } | string;
      const promptText =
        typeof rendered === 'string' ? rendered : (rendered as { toString(): string }).toString();
      const result = await llmInvoker(promptText);
      const parsed = parseFirstJsonObjectResult(result.text);
      if (!parsed.ok) {
        return { success: false };
      }
      const validation = validate(parsed.value);
      if (!validation.success) {
        return { success: false };
      }
      return { success: true, value: (extractNormalisedData(validation) ?? parsed.value) as R };
    } catch (err) {
      if (isPlannerAbortError(err)) throw err;
      return { success: false };
    }
  }

  private async runParallelLayers(
    input: GeneratePromptInput,
    scaffold: Scaffold,
    llmInvoker: (promptText: string) => Promise<LlmInvokerResult>,
    skill: ReturnType<typeof resolveSkillForStage>,
    maxRetries: number,
    extraHooks?: ParallelRunOptions['hooks'],
    signal?: AbortSignal,
    refinementContext?: RefinementAnswer[],
  ): Promise<{ value: unknown[] | null; error: PlannerError | null; attempts: number }> {
    const ids = scaffold.architectureLayerIds;
    if (ids.length === 0) {
      return { value: [], error: null, attempts: 0 };
    }





    const jobs = ids.map((id) => {
      const scopedScaffold: Scaffold = { ...scaffold, architectureLayerIds: [id] };
      return {
        id,
        buildPrompt: (retry: string) =>
          this.promptBuilder.buildLayerChunkPrompt(
            input,
            scopedScaffold,
            retry,
            skill,
            refinementContext,
          ),
        validate: this.schemaService.validateLayerChunk.bind(this.schemaService),
      };
    });

    const result = await this.parallel.run(jobs, llmInvoker, parseFirstJsonObjectResult, {
      maxAttemptsPerJob: maxRetries,
      signal,
      stageKind: 'layers',
      hooks: {
        onJobStart: (id) => this.startParallelActivity('layers', skill, id),
        onJobEnd: (id) => this.finishParallelActivity('layers', id),
        ...(extraHooks ?? {}),
      },
    });

    const flat: unknown[] = [];
    const stubbed: string[] = [];
    for (const r of result.results) {
      if (r.value) {
        flat.push(...r.value);
      } else {
        const stub = this.schemaService.buildLayerStub(r.id);
        flat.push(stub);
        stubbed.push(r.id);
      }
    }
    if (stubbed.length > 0) {
      this.recordStubFallback('layers', stubbed, result.error);
    }
    return { value: flat, error: null, attempts: result.attempts };
  }

  private async runParallelDomains(
    input: GeneratePromptInput,
    scaffold: Scaffold,
    llmInvoker: (promptText: string) => Promise<LlmInvokerResult>,
    skill: ReturnType<typeof resolveSkillForStage>,
    maxRetries: number,
    extraHooks?: ParallelRunOptions['hooks'],
    signal?: AbortSignal,
    refinementContext?: RefinementAnswer[],
  ): Promise<{ value: unknown[] | null; error: PlannerError | null; attempts: number }> {
    const ids = scaffold.domainIds;
    if (ids.length === 0) {
      return { value: [], error: null, attempts: 0 };
    }
    const jobs = ids.map((id) => {
      const scopedScaffold: Scaffold = { ...scaffold, domainIds: [id] };
      return {
        id,
        buildPrompt: (retry: string) =>
          this.promptBuilder.buildDomainChunkPrompt(
            input,
            scopedScaffold,
            retry,
            skill,
            refinementContext,
          ),
        validate: this.schemaService.validateDomainChunk.bind(this.schemaService),
      };
    });

    const result = await this.parallel.run(jobs, llmInvoker, parseFirstJsonObjectResult, {
      maxAttemptsPerJob: maxRetries,
      signal,
      stageKind: 'domains',
      hooks: {
        onJobStart: (id) => this.startParallelActivity('domains', skill, id),
        onJobEnd: (id) => this.finishParallelActivity('domains', id),
        ...(extraHooks ?? {}),
      },
    });

    const fallbackLayer = scaffold.architectureLayerIds[0] ?? 'shared';
    const flat: unknown[] = [];
    const stubbed: string[] = [];
    for (const r of result.results) {
      if (r.value) {
        flat.push(...r.value);
      } else {
        const stub = this.schemaService.buildDomainStub(r.id, fallbackLayer);
        flat.push(stub);
        stubbed.push(r.id);
      }
    }
    if (stubbed.length > 0) {
      this.recordStubFallback('domains', stubbed, result.error);
    }
    return { value: flat, error: null, attempts: result.attempts };
  }

  private applyScaffoldCaps(value: Scaffold, caps: ComplexityCaps): Scaffold {
    if (
      value.architectureLayerIds.length <= caps.maxLayers &&
      value.domainIds.length <= caps.maxDomains
    ) {
      return value;
    }
    const truncatedLayers = value.architectureLayerIds.slice(0, caps.maxLayers);
    const truncatedDomains = value.domainIds.slice(0, caps.maxDomains);
    return {
      ...value,
      architectureLayerIds: truncatedLayers,
      domainIds: truncatedDomains,
      systemOverview: {
        ...value.systemOverview,
        constraints: [
          ...(value.systemOverview.constraints ?? []),
          `Plan auto-simplified to ${truncatedLayers.length} layers / ${truncatedDomains.length} domains (complexity: ${caps.tier}). Add more later via Regenerate stubs.`,
        ],
      },
    };
  }

  private recordStubFallback(
    stage: 'layers' | 'domains',
    stubbedIds: readonly string[],
    originalError: PlannerError | null,
  ): void {
    const idsList = stubbedIds.join(', ');
    const reason = originalError?.message ? ` (${originalError.message})` : '';
    // eslint-disable-next-line no-console
    console.warn(
      `[planner] ${stage} stage: synthesised auto-generated stubs for: ${idsList}${reason}`,
    );
  }

  private buildSalvagedPlan(scaffoldValue: Scaffold): Plan | null {
    try {
      const fallbackLayer = scaffoldValue.architectureLayerIds[0] ?? 'shared';
      const architectureLayers = scaffoldValue.architectureLayerIds.map((id) =>
        this.schemaService.buildLayerStub(id),
      );
      const domains = scaffoldValue.domainIds.map((id) =>
        this.schemaService.buildDomainStub(id, fallbackLayer),
      );
      const candidate = {
        meta: scaffoldValue.meta,
        systemOverview: scaffoldValue.systemOverview,
        boundedContexts: scaffoldValue.boundedContexts,
        architectureLayers,
        domains,
        workflows: [],
        adrs: [],
        agentTasks: [],
      };
      const parsed = this.schemaService.schema.safeParse(candidate);
      if (!parsed.success) return null;
      return parsed.data;
    } catch {
      return null;
    }
  }

  private parallelHooksFrom(
    onError: PlannerRunConfig['onError'],
    stage: 'layers' | 'domains',
  ): ParallelRunOptions['hooks'] {
    if (!onError) return undefined;
    return {
      onJobError: (event) =>
        onError({
          stage,
          jobId: event.jobId,
          kind: (event.kind as PlannerErrorEvent['kind']) ?? 'invalid_json',
          attempt: event.attempt,
          repairPass: event.repairPass,
          message: event.message,
        }),
      onJobRetry: (event) =>
        onError({ stage, jobId: event.jobId, kind: 'retry', attempt: event.attempt }),
      onJobRepair: (event) =>
        onError({ stage, jobId: event.jobId, kind: 'repair', repairPass: event.repairPass }),
    };
  }

  private readonly activeParallelIds = new Map<string, string>();

  private startParallelActivity(
    stage: 'layers' | 'domains',
    skill: ReturnType<typeof resolveSkillForStage>,
    label: string,
  ): void {
    const id = this.projectStore.startActivity({
      stage,
      agentId: skill?.agentId ?? null,
      skillId: skill?.skill.id ?? null,
      label,
      kind: 'parallel-job',
    });
    this.activeParallelIds.set(`${stage}:${label}`, id);
  }

  private finishParallelActivity(stage: 'layers' | 'domains', label: string): void {
    const id = this.activeParallelIds.get(`${stage}:${label}`);
    if (id) {
      this.projectStore.finishActivity(id);
      this.activeParallelIds.delete(`${stage}:${label}`);
    }
  }

  private annotateParallelError(
    error: PlannerError,
    stage: 'layers' | 'domains',
    ids: readonly string[],
  ): PlannerError {
    if (error.type !== 'schema_validation' && error.type !== 'invalid_json') {
      return error;
    }
    const attemptList = ids.length > 0 ? ` [tried: ${ids.join(', ')}]` : '';
    return { ...error, message: `${stage} stage${attemptList}: ${error.message}` };
  }
}

function extractNormalisedData<R>(validation: StageValidationResult<StageKind, R>): R | undefined {
  return validation.success ? validation.data : undefined;
}

function describeShape(value: unknown): string {
  if (Array.isArray(value)) return `array (length ${value.length})`;
  if (value === null) return 'null';
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).slice(0, 8);
    return `object (keys: ${keys.join(', ')}${keys.length === 8 ? ', …' : ''})`;
  }
  if (typeof value === 'string') {
    const trimmed = value.length > 60 ? `${value.slice(0, 60)}…` : value;
    return `string "${trimmed}"`;
  }
  return typeof value;
}

async function runWithConcurrency<T>(
  jobs: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(jobs.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= jobs.length) return;
      results[current] = await jobs[current]();
    }
  };
  const laneCount = Math.max(1, Math.min(concurrency, jobs.length));
  await Promise.all(Array.from({ length: laneCount }, () => worker()));
  return results;
}

function refinementMentionsDomain(block: RefinementInstructionBlock | undefined): boolean {
  return refinementMentionsAny(block, [/\bdomains?\b/i, /\bbounded[\s-]?contexts?\b/i, /\bsubdomains?\b/i]);
}

function refinementMentionsLayer(block: RefinementInstructionBlock | undefined): boolean {
  return refinementMentionsAny(block, [/\blayers?\b/i, /\barchitectures?\b/i, /\btiers?\b/i]);
}

function refinementMentionsBoundedContext(block: RefinementInstructionBlock | undefined): boolean {
  return refinementMentionsAny(block, [/\bbounded[\s-]?contexts?\b/i, /\bsubdomains?\b/i]);
}

function refinementMentionsAny(
  block: RefinementInstructionBlock | undefined,
  patterns: RegExp[],
): boolean {
  if (!block) return false;
  const haystack = [
    block.instruction ?? '',
    block.userPrompt ?? '',
    ...(block.chatTranscript ?? []).flatMap((turn) => [
      turn.text ?? '',
    ]),
  ]
    .join('\n')
    .toLowerCase();
  return patterns.some((pattern) => pattern.test(haystack));
}

function buildKeywordReminderError(input: {
  userRequestedDomain: boolean;
  userRequestedLayer: boolean;
  userRequestedBoundedContext: boolean;
  returnedLayers: number;
  returnedDomains: number;
  returnedBoundedContexts: number;
}): string {
  const lines: string[] = [];
  if (input.userRequestedDomain && input.returnedDomains === 0) {
    lines.push(
      "The user's chat request explicitly mentioned 'domain' / 'domains' (or a synonym like 'bounded context' / 'subdomain'), but your previous response did not include any `newDomains` entries. You MUST populate the `newDomains` key with at least one fully-formed domain object that references an existing layer id. A workflow tweak or a new layer alone is NOT sufficient — the user asked for a domain.",
    );
  }
  if (input.userRequestedLayer && input.returnedLayers === 0) {
    lines.push(
      "The user's chat request explicitly mentioned 'layer' / 'architecture' / 'tier', but your previous response did not include any `newLayers` entries. You MUST populate the `newLayers` key with at least one fully-formed architecture layer.",
    );
  }
  if (input.userRequestedBoundedContext && input.returnedBoundedContexts === 0) {
    lines.push(
      "The user's chat request explicitly mentioned 'bounded context' / 'subdomain', but your previous response did not include any `newBoundedContexts` entries. You MUST populate the `newBoundedContexts` key with at least one entry.",
    );
  }
  return lines.length > 0 ? `Reminder for the next attempt: ${lines.join(' ')}` : '';
}
