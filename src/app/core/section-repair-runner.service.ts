import { Injectable, inject } from '@angular/core';
import { ArchitectureLayer, Domain, Plan } from './plan.schema';
import {
  PlanSchemaService,
  type StageValidationResult,
} from './plan-schema.service';
import {
  GeneratePromptInput,
  PromptBuilderService,
  RefinementInstructionBlock,
  resolveSkillForStage,
} from './prompt-builder.service';
import { AgentsStore } from './agents.store';
import { isPlannerAbortError } from './streaming/abort-error';
import {
  ParallelSectionRunner,
  type ParallelJob,
  type ParallelRunOptions,
} from './parallel-section-runner.service';
import { ProjectStore } from './project.store';
import { AuditFinding, AuditRunner } from './audit-runner.service';
import { LocalAuditFixer } from './local-audit-fixer.service';
import { parseFirstJsonObjectResult, ParseResult } from './json-output-parser';

export type SectionRepairErrorEvent = {
  stage: 'scaffold' | 'layers' | 'domains' | 'tail';
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
};

export type SectionRepairHooks = ParallelRunOptions['hooks'];

export interface SectionRepairOptions {
  signal?: AbortSignal;
  hooks?: SectionRepairHooks;

  onError?: (event: SectionRepairErrorEvent) => void;

  maxRetriesPerJob?: number;

  auditRepairMaxAttempts?: number;
  refinementInstruction?: RefinementInstructionBlock;
}

export interface SectionRepairResult {
  plan: Plan;
  residualFindings: AuditFinding[];

  attempts: number;
}

export type SectionGroup =
  | { kind: 'layer'; id: string; findings: AuditFinding[] }
  | { kind: 'domain'; id: string; findings: AuditFinding[] }
  | {
      kind: 'planField';
      path: string;
      findings: AuditFinding[];
      section: 'scaffold' | 'tail';
    };

type LlmInvoker = (promptText: string) => Promise<{ text: string }>;

@Injectable({ providedIn: 'root' })
export class SectionRepairRunner {
  private readonly promptBuilder = inject(PromptBuilderService);
  private readonly schemaService = inject(PlanSchemaService);
  private readonly agents = inject(AgentsStore);
  private readonly parallel = inject(ParallelSectionRunner);
  private readonly projectStore = inject(ProjectStore);
  private readonly auditRunner = inject(AuditRunner);
  private readonly localFixer = inject(LocalAuditFixer);

  async invokeSectionScoped(
    plan: Plan,
    findings: readonly AuditFinding[],
    input: GeneratePromptInput | null,
    llmInvoker: LlmInvoker,
    options: SectionRepairOptions = {},
  ): Promise<SectionRepairResult> {
    const maxAttempts = Math.max(0, options.auditRepairMaxAttempts ?? 1);
    const maxRetriesPerJob = Math.max(1, options.maxRetriesPerJob ?? 3);
    const hooks = this.composeHooks(options);
    const attemptsRef = { value: 0 };
    const budgetExhausted = (): boolean =>
      attemptsRef.value >=
      Math.max(1, this.projectStore.config().plannerMaxAttempts ?? 75);



    let current = plan;
    let residual: AuditFinding[] = [...findings];
    const localResult = this.localFixer.tryFixInPlace(current, residual);
    if (localResult.fixedPaths.length > 0) {
      current = localResult.plan;
      const fixedSet = new Set(localResult.fixedPaths);
      residual = residual.filter((f) => !fixedSet.has(f.path));
    }
    if (residual.length === 0 || maxAttempts === 0) {
      return { plan: current, residualFindings: residual, attempts: attemptsRef.value };
    }

    let previousPathSet = new Set(residual.map((f) => f.path));

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (residual.length === 0) {
        return { plan: current, residualFindings: residual, attempts: attemptsRef.value };
      }
      if (budgetExhausted()) {
        return { plan: current, residualFindings: residual, attempts: attemptsRef.value };
      }

      const groups = SectionRepairRunner.groupFindings(current, residual);
      const layerGroups = groups.filter(
        (g): g is Extract<SectionGroup, { kind: 'layer' }> => g.kind === 'layer',
      );
      const domainGroups = groups.filter(
        (g): g is Extract<SectionGroup, { kind: 'domain' }> => g.kind === 'domain',
      );
      const planFieldGroups = groups.filter(
        (g): g is Extract<SectionGroup, { kind: 'planField' }> => g.kind === 'planField',
      );

      if (layerGroups.length > 0) {
        const next = await this.dispatchLayerGroups(
          current,
          input,
          layerGroups,
          llmInvoker,
          maxRetriesPerJob,
          hooks,
          attemptsRef,
         options.signal,
         options.refinementInstruction,
       );
        if (next) current = next;
      }

      if (domainGroups.length > 0) {
        const next = await this.dispatchDomainGroups(
          current,
          input,
          domainGroups,
          llmInvoker,
          maxRetriesPerJob,
          hooks,
          attemptsRef,
         options.signal,
         options.refinementInstruction,
       );
        if (next) current = next;
      }



      if (planFieldGroups.length > 0) {
        for (const group of planFieldGroups) {
          if (group.findings.length === 0) continue;
          if (budgetExhausted()) break;
          const next = await this.dispatchPlanFieldGroup(
            current,
            group,
            llmInvoker,
            attemptsRef,
            options.signal,
          );
          if (next) current = next;
        }
      }

      const nextResidual = this.auditRunner.run(current);
      const nextPathSet = new Set(nextResidual.map((f) => f.path));
      if (SectionRepairRunner.shouldBailAuditRepair(previousPathSet, nextPathSet)) {
        return {
          plan: current,
          residualFindings: nextResidual,
          attempts: attemptsRef.value,
        };
      }
      residual = nextResidual;
      previousPathSet = nextPathSet;
    }

    return { plan: current, residualFindings: residual, attempts: attemptsRef.value };
  }

  static groupFindings(plan: Plan, findings: readonly AuditFinding[]): SectionGroup[] {
    const layerGroups = new Map<string, AuditFinding[]>();
    const domainGroups = new Map<string, AuditFinding[]>();
    const planFieldGroups = new Map<string, AuditFinding[]>();

    for (const finding of findings) {
      const classification = classifyFindingPath(plan, finding.path);
      if (classification.kind === 'layer') {
        const list = layerGroups.get(classification.id) ?? [];
        list.push(finding);
        layerGroups.set(classification.id, list);
      } else if (classification.kind === 'domain') {
        const list = domainGroups.get(classification.id) ?? [];
        list.push(finding);
        domainGroups.set(classification.id, list);
      } else {
        const key = classification.path;
        const list = planFieldGroups.get(key) ?? [];
        list.push(finding);
        planFieldGroups.set(key, list);
      }
    }

    const groups: SectionGroup[] = [];
    for (const [id, list] of layerGroups) {
      groups.push({ kind: 'layer', id, findings: list });
    }
    for (const [id, list] of domainGroups) {
      groups.push({ kind: 'domain', id, findings: list });
    }
    for (const [path, list] of planFieldGroups) {
      const section: 'scaffold' | 'tail' = path.startsWith('boundedContexts[') ||
        path.startsWith('workflows[') ||
        path.startsWith('adrs[') ||
        path.startsWith('agentTasks[')
        ? 'tail'
        : 'scaffold';
      groups.push({ kind: 'planField', path, findings: list, section });
    }
    return groups;
  }

  static applyGroup(plan: Plan, group: SectionGroup, replacement: unknown): Plan {
    if (group.kind === 'layer') {
      if (!Array.isArray(replacement)) return plan;
      return replaceLayers(plan, [
        { id: group.id, value: replacement as ArchitectureLayer[] },
      ]);
    }
    if (group.kind === 'domain') {
      if (!Array.isArray(replacement)) return plan;
      return replaceDomains(plan, [
        { id: group.id, value: replacement as Domain[] },
      ]);
    }

    const write = new PlanSchemaService().replacePlanField(plan, group.path, replacement);
    return write.ok ? write.plan : plan;
  }

  static shouldBailAuditRepair(
    previous: ReadonlySet<string>,
    next: ReadonlySet<string>,
  ): boolean {
    if (next.size === 0) return false;
    if (next.size >= previous.size && [...next].every((p) => previous.has(p))) {
      return true;
    }
    let overlap = 0;
    for (const p of next) {
      if (previous.has(p)) overlap += 1;
    }
    if (overlap === 0) return true;
    return false;
  }

  private async dispatchLayerGroups(
    plan: Plan,
    input: GeneratePromptInput | null,
    groups: ReadonlyArray<Extract<SectionGroup, { kind: 'layer' }>>,
    llmInvoker: LlmInvoker,
    maxRetries: number,
    hooks: SectionRepairHooks | undefined,
    attemptsRef: { value: number },
    signal?: AbortSignal,
    refinementInstruction?: RefinementInstructionBlock,
  ): Promise<Plan | null> {
    if (!input) {



      return null;
    }
    const skill = resolveSkillForStage(this.agents, 'layers');
    const ids = groups.map((g) => g.id);
    const scaffold = makeRegenScaffold(plan, ids, []);
    const jobs: ParallelJob<ArchitectureLayer[]>[] = ids.map((id) =>
      this.buildRegenLayerJob(input, scaffold, id, skill),
    );
    const result = await this.parallel.run<ArchitectureLayer[]>(
      jobs,
      llmInvoker,
      parseFirstJsonObjectResult,
      {
        maxAttemptsPerJob: maxRetries,
        maxRepairPasses: 3,
        stageKind: 'layers',
        hooks,
        signal,
      },
      attemptsRef,
    );
    return replaceLayers(
      plan,
      result.results.map((r) => ({ id: r.id, value: r.value })),
    );
  }

  private async dispatchDomainGroups(
    plan: Plan,
    input: GeneratePromptInput | null,
    groups: ReadonlyArray<Extract<SectionGroup, { kind: 'domain' }>>,
    llmInvoker: LlmInvoker,
    maxRetries: number,
    hooks: SectionRepairHooks | undefined,
    attemptsRef: { value: number },
    signal?: AbortSignal,
    refinementInstruction?: RefinementInstructionBlock,
  ): Promise<Plan | null> {
    if (!input) return null;
    const skill = resolveSkillForStage(this.agents, 'domains');
    const ids = groups.map((g) => g.id);
    const scaffold = makeRegenScaffold(plan, [], ids);
    const jobs: ParallelJob<Domain[]>[] = ids.map((id) =>
      this.buildRegenDomainJob(input, scaffold, id, skill),
    );
    const result = await this.parallel.run<Domain[]>(
      jobs,
      llmInvoker,
      parseFirstJsonObjectResult,
      {
        maxAttemptsPerJob: maxRetries,
        maxRepairPasses: 3,
        stageKind: 'domains',
        hooks,
        signal,
      },
      attemptsRef,
    );
    return replaceDomains(
      plan,
      result.results.map((r) => ({ id: r.id, value: r.value })),
    );
  }

  private async dispatchPlanFieldGroup(
    plan: Plan,
    group: Extract<SectionGroup, { kind: 'planField' }>,
    llmInvoker: LlmInvoker,
    attemptsRef: { value: number },
    signal?: AbortSignal,
    refinementInstruction?: RefinementInstructionBlock,
  ): Promise<Plan | null> {
    if (group.findings.length === 0) return null;
    const sectionKind = this.classifySectionKind(plan, group.path);
    if (!sectionKind) return null;
    const currentSection = extractCurrentSection(plan, group.path);
    if (currentSection === undefined) return null;
    const planSummary = summariseForRepairPrompt(plan);
    const skill = resolveSkillForStage(this.agents, sectionKind);
    const stage: 'scaffold' | 'tail' = sectionKind === 'scaffold' || sectionKind === 'tail'
      ? sectionKind
      : 'scaffold';
    try {
      const prompt = await this.promptBuilder.buildSectionRepairPrompt({
        stage,
        sectionId: extractSectionId(group.path),
        currentSection,
        findings: group.findings,
         planSummary,
         skillOverride: skill,
         refinementInstruction,
       });
      const rendered = (await prompt.format({})) as { toString(): string } | string;
      const promptText =
        typeof rendered === 'string' ? rendered : (rendered as { toString(): string }).toString();
      if (signal?.aborted) return null;
      const response = await llmInvoker(promptText);
      attemptsRef.value += 1;
      const parsed = parseFirstJsonObjectResult(response.text) as ParseResult;
      if (!parsed.ok) return null;



      const write = new PlanSchemaService().replacePlanField(plan, group.path, parsed.value);
      return write.ok ? write.plan : null;
    } catch (err) {
      if (isPlannerAbortError(err)) throw err;
      return null;
    }
  }

  private classifySectionKind(plan: Plan, path: string): 'scaffold' | 'tail' | null {
    if (path === 'meta' || path.startsWith('meta.') || path === 'systemOverview' ||
        path.startsWith('systemOverview.')) {
      return 'scaffold';
    }
    if (path === 'boundedContexts' || path.startsWith('boundedContexts[')) {
      return 'tail';
    }
    if (path === 'workflows' || path.startsWith('workflows[')) {
      return 'tail';
    }
    if (path === 'adrs' || path.startsWith('adrs[')) {
      return 'tail';
    }
    if (path === 'agentTasks' || path.startsWith('agentTasks[')) {
      return 'tail';
    }
    return null;
  }


  private buildRegenLayerJob(
    input: GeneratePromptInput,
    scaffold: ReturnType<typeof makeRegenScaffold>,
    id: string,
    skill: ReturnType<typeof resolveSkillForStage>,
  ): ParallelJob<ArchitectureLayer[]> {
    const idPinState: { fired: boolean; driftedIds: string[] } = { fired: false, driftedIds: [] };
    const scoped = { ...scaffold, architectureLayerIds: [id] };
    return {
      id,
      buildPrompt: (retry: string) => {
        const augmented = this.composeIdPinRetry(retry, id, idPinState, 'layer');
        return this.promptBuilder.buildLayerChunkPrompt(input, scoped, augmented, skill);
      },
      validate: (value: unknown): StageValidationResult<'layers', ArchitectureLayer[]> => {
        const result = this.schemaService.validateLayerChunkForIds(value, [id]);
        if (
          !result.success &&
          idPinState.fired === false &&
          /was not requested/i.test(result.message)
        ) {
          idPinState.fired = true;
          idPinState.driftedIds = extractDriftedIds(result.message);
        }
        return result;
      },
    };
  }

  private buildRegenDomainJob(
    input: GeneratePromptInput,
    scaffold: ReturnType<typeof makeRegenScaffold>,
    id: string,
    skill: ReturnType<typeof resolveSkillForStage>,
  ): ParallelJob<Domain[]> {
    const idPinState: { fired: boolean; driftedIds: string[] } = { fired: false, driftedIds: [] };
    const scoped = { ...scaffold, domainIds: [id] };
    return {
      id,
      buildPrompt: (retry: string) => {
        const augmented = this.composeIdPinRetry(retry, id, idPinState, 'domain');
        return this.promptBuilder.buildDomainChunkPrompt(input, scoped, augmented, skill);
      },
      validate: (value: unknown): StageValidationResult<'domains', Domain[]> => {
        const result = this.schemaService.validateDomainChunkForIds(value, [id]);
        if (
          !result.success &&
          idPinState.fired === false &&
          /was not requested/i.test(result.message)
        ) {
          idPinState.fired = true;
          idPinState.driftedIds = extractDriftedIds(result.message);
        }
        return result;
      },
    };
  }

  private composeIdPinRetry(
    retry: string,
    expectedId: string,
    state: { fired: boolean; driftedIds: string[] },
    kind: 'layer' | 'domain',
  ): string {
    if (!state.fired) return retry;
    state.fired = false;
    const actual = state.driftedIds.length > 0 ? state.driftedIds.join(', ') : '(unknown)';
    const hint =
      `The previous attempt returned ${kind}(s) with id(s) [${actual}], ` +
      `but the requested id is exactly "${expectedId}". ` +
      `Return a ${kind} whose \`id\` field equals "${expectedId}" verbatim. Do not invent a new id.`;
    return retry ? `${retry}\n\n${hint}` : hint;
  }

  private composeHooks(options: SectionRepairOptions): SectionRepairHooks | undefined {
    if (!options.onError) return options.hooks;
    const onError = options.onError;
    const derived: SectionRepairHooks = {
      ...(options.hooks ?? {}),
      onJobError: (event) => {
        const stage = event.stageKind ?? 'layers';
        onError({
          stage,
          jobId: event.jobId,
          kind: (event.kind as SectionRepairErrorEvent['kind']) ?? 'invalid_json',
          attempt: event.attempt,
          repairPass: event.repairPass,
          message: event.message,
        });
      },
      onJobRetry: (event) => {
        const stage = event.stageKind ?? 'layers';
        onError({ stage, jobId: event.jobId, kind: 'retry', attempt: event.attempt });
      },
      onJobRepair: (event) => {
        const stage = event.stageKind ?? 'layers';
        onError({ stage, jobId: event.jobId, kind: 'repair', repairPass: event.repairPass });
      },
    };
    return derived;
  }
}

function classifyFindingPath(
  plan: Plan,
  path: string,
):
  | { kind: 'layer'; id: string }
  | { kind: 'domain'; id: string }
  | { kind: 'planField'; path: string } {
  const layerMatch = /^architectureLayers\[([^\]]+)\]\./.exec(path);
  if (layerMatch) {
    return { kind: 'layer', id: layerMatch[1] };
  }
  const domainMatch = /^domains\[([^\]]+)\](\.|$)/.exec(path);
  if (domainMatch) {
    return { kind: 'domain', id: domainMatch[1] };
  }



  return { kind: 'planField', path };
}

function makeRegenScaffold(plan: Plan, architectureLayerIds: string[], domainIds: string[]) {
  return {
    meta: plan.meta,
    systemOverview: plan.systemOverview,
    boundedContexts: plan.boundedContexts,
    architectureLayerIds,
    domainIds,
    includeTail: false,
  };
}

function replaceLayers(
  plan: Plan,
  regenerated: ReadonlyArray<{ id: string; value: ArchitectureLayer[] | null }>,
): Plan {
  const regenById = new Map<string, ArchitectureLayer>();
  for (const entry of regenerated) {
    if (!entry.value) continue;
    for (const layer of entry.value) {
      regenById.set(layer.id, layer);
    }
  }
  const layers = Array.isArray(plan.architectureLayers) ? plan.architectureLayers : [];
  return {
    ...plan,
    architectureLayers: layers.map((layer) => {
      const replacement = regenById.get(layer.id);
      return replacement ?? layer;
    }),
  };
}

function replaceDomains(
  plan: Plan,
  regenerated: ReadonlyArray<{ id: string; value: Domain[] | null }>,
): Plan {
  const regenById = new Map<string, Domain>();
  for (const entry of regenerated) {
    if (!entry.value) continue;
    for (const domain of entry.value) {
      regenById.set(domain.id, domain);
    }
  }
  const domains = Array.isArray(plan.domains) ? plan.domains : [];
  return {
    ...plan,
    domains: domains.map((domain) => {
      const replacement = regenById.get(domain.id);
      return replacement ?? domain;
    }),
  };
}

function extractDriftedIds(message: string): string[] {
  const matches = message.match(/"[^"]+"/g);
  return matches ? matches.map((m) => m.slice(1, -1)) : [];
}

function summariseForRepairPrompt(plan: Plan): {
  meta: { title: string };
  boundedContextIds: string[];
  architectureLayerIds: string[];
  domainIds: string[];
} {
  return {
    meta: { title: plan.meta.title },
    boundedContextIds: plan.boundedContexts.map((bc) => bc.id),
    architectureLayerIds: plan.architectureLayers.map((l) => l.id),
    domainIds: plan.domains.map((d) => d.id),
  };
}

function extractCurrentSection(plan: Plan, path: string): unknown {
  if (path === 'meta') return plan.meta;
  if (path === 'systemOverview') return plan.systemOverview;
  if (path.startsWith('systemOverview.')) return plan.systemOverview;
  const arrayMatch = /^(\w+)\[([^\]]+)\](?:\.(.+))?$/.exec(path);
  if (arrayMatch) {
    const [, arrayName, id, field] = arrayMatch;
    const list = (plan as unknown as Record<string, unknown[]>)[arrayName];
    if (!Array.isArray(list)) return undefined;
    const entry = list.find((e) => e && typeof e === 'object' && (e as { id?: string }).id === id);
    if (!entry) return undefined;
    return field ? (entry as Record<string, unknown>)[field] : entry;
  }
  if (path === 'boundedContexts') return plan.boundedContexts;
  if (path === 'workflows') return plan.workflows;
  if (path === 'adrs') return plan.adrs;
  if (path === 'agentTasks') return plan.agentTasks;
  return undefined;
}

function extractSectionId(path: string): string | undefined {
  const match = /^\w+\[([^\]]+)\]/.exec(path);
  return match ? match[1] : undefined;
}
