import { Injectable, inject } from '@angular/core';
import { Plan } from './plan.schema';
import { PlanSchemaService, PdfDocumentRepair } from './plan-schema.service';
import { PlannerError } from './planner-error.model';
import { PdfCreatorGraphService, PdfCreatorInvokerResult, RunOneCallOptions } from './pdf-creator-graph.service';
import { PdfDocument, PdfSection } from './pdf-document.schema';
import { PromptBuilderService, resolveSkillsForStage } from './prompt-builder.service';
import { AgentsStore } from './agents.store';
import { computeActiveSectionList, PdfSectionKind } from './pdf-section-planner';
import { PdfStitcherService, SectionBatchResult } from './pdf-stitcher.service';

export interface PdfSectionOrchestratorOptions {
  llmInvoker: (promptText: string) => Promise<PdfCreatorInvokerResult>;
  onAttemptStart?: () => void;
  onAttemptFinish?: () => void;
  maxRetries?: number;
}

export interface PdfSectionOrchestratorResult {
  document: PdfDocument | null;
  error: PlannerError | null;
  repair: PdfDocumentRepair | null;
  placeholders: number;
  attempts: number;
  callCount: number;
  perCallPrompts: readonly string[];
}

@Injectable({ providedIn: 'root' })
export class PdfSectionOrchestrator {
  private readonly agents = inject(AgentsStore);
  private readonly promptBuilder = inject(PromptBuilderService);
  private readonly schemaService = inject(PlanSchemaService);
  private readonly graph = inject(PdfCreatorGraphService);
  private readonly stitcher = inject(PdfStitcherService);

  async run(
    plan: Plan,
    options: PdfSectionOrchestratorOptions,
  ): Promise<PdfSectionOrchestratorResult> {
    const perCallPrompts: string[] = [];
    const activeSections = computeActiveSectionList(plan);
    if (activeSections.length === 0) {
      return {
        document: null,
        error: {
          type: 'schema_validation',
          message: 'No active PDF sections after skip rules — the plan is empty or has no usable fields.',
          fields: ['sections'],
        },
        repair: null,
        placeholders: 0,
        attempts: 0,
        callCount: 0,
        perCallPrompts,
      };
    }

    const schema = this.schemaService.toPdfDocumentJsonSchema();
    const skills = resolveSkillsForStage(this.agents, 'pdf');
    const partialSchema = { type: 'object', properties: { sections: { type: 'array' } } };

    const headerKinds: PdfSectionKind[] = ['Executive Summary' as PdfSectionKind];
    if (activeSections[0] === 'System Overview') {
      headerKinds.push('System Overview');
    }
    const headerTargetKinds = this.buildHeaderTargetKinds(plan, activeSections);
    const sectionChunks = this.chunkSections(activeSections.slice(headerTargetKinds.length));

    const headerCall = await this.runHeaderCall(plan, schema, skills, headerTargetKinds, options, perCallPrompts);
    if (headerCall.error || !headerCall.document) {
      return {
        document: null,
        error: headerCall.error,
        repair: headerCall.repair,
        placeholders: 0,
        attempts: headerCall.attempts,
        callCount: 1,
        perCallPrompts,
      };
    }

    const collectedSections: SectionBatchResult[] = [];
    let priorSections: unknown[] = [...headerCall.document.sections];
    let totalAttempts = headerCall.attempts;
    for (const chunk of sectionChunks) {
      const partialResult = await this.runSectionCall(
        plan,
        partialSchema,
        skills,
        chunk,
        priorSections,
        options,
        perCallPrompts,
      );
      totalAttempts += partialResult.attempts;
      if (partialResult.error && !partialResult.usedFallback) {
        collectedSections.push({
          targetKinds: chunk,
          sections: [],
          usedFallback: true,
        });
      } else {
        collectedSections.push({
          targetKinds: chunk,
          sections: partialResult.sections ?? [],
          usedFallback: partialResult.error !== null && (partialResult.sections?.length ?? 0) === 0,
        });
        if (partialResult.sections) {
          priorSections = [...priorSections, ...partialResult.sections];
        }
      }
    }

    const stitched = this.stitcher.stitchSections(
      {
        title: headerCall.document.title,
        subtitle: headerCall.document.subtitle,
        generatedAt: headerCall.document.generatedAt,
        executiveSummary: headerCall.document.executiveSummary,
        sections: headerCall.document.sections,
      },
      collectedSections,
    );

    const finalValidated = this.schemaService.validatePdfDocumentWithUnwrap(stitched.document, {
      title: plan.meta?.title,
      summary: plan.meta?.summary,
    });

    if (!finalValidated.success) {
      return {
        document: null,
        error: {
          type: 'schema_validation',
          message: finalValidated.message,
          fields: finalValidated.fields,
        },
        repair: finalValidated.repair ?? headerCall.repair,
        placeholders: stitched.placeholders,
        attempts: totalAttempts,
        callCount: perCallPrompts.length,
        perCallPrompts,
      };
    }

    return {
      document: finalValidated.document,
      error: null,
      repair: finalValidated.repair ?? headerCall.repair,
      placeholders: stitched.placeholders,
      attempts: totalAttempts,
      callCount: perCallPrompts.length,
      perCallPrompts,
    };
  }

  private buildHeaderTargetKinds(plan: Plan, activeSections: readonly PdfSectionKind[]): PdfSectionKind[] {
    void plan;
    const result: PdfSectionKind[] = [];
    result.push(activeSections[0]);
    const sysOverviewIdx = activeSections.indexOf('System Overview');
    if (sysOverviewIdx >= 0 && sysOverviewIdx !== 0) {
      result.push('System Overview');
    } else if (activeSections.length >= 2) {
      result.push(activeSections[1]);
    }
    return result;
  }

  private chunkSections(remaining: readonly PdfSectionKind[]): PdfSectionKind[][] {
    const chunks: PdfSectionKind[][] = [];
    for (let i = 0; i < remaining.length; i += 1) {
      const slice = remaining.slice(i, i + 1);
      if (slice.length > 0) chunks.push([...slice]);
    }
    return chunks;
  }

  private async runHeaderCall(
    plan: Plan,
    schema: object,
    skills: ReturnType<typeof resolveSkillsForStage>,
    targetKinds: readonly PdfSectionKind[],
    options: PdfSectionOrchestratorOptions,
    perCallPrompts: string[],
  ): Promise<{
    document: PdfDocument | null;
    error: PlannerError | null;
    repair: PdfDocumentRepair | null;
    attempts: number;
  }> {
    const prompt = await this.promptBuilder.buildPdfHeaderPrompt(plan, schema, skills);
    const renderPrompt = async (retrySection: string): Promise<string> => {
      if (!retrySection) {
        const rendered = await prompt.format({});
        return rendered;
      }
      const systemMessage = await prompt.format({});
      return `${systemMessage}\n\n${retrySection}`;
    };

    const renderable = await renderPrompt('');
    perCallPrompts.push(renderable);

    const callOptions: RunOneCallOptions = {
      maxRetries: options.maxRetries ?? 2,
      llmInvoker: options.llmInvoker,
      renderPrompt,
      planContext: { title: plan.meta?.title, summary: plan.meta?.summary },
      onAttemptStart: options.onAttemptStart,
      onAttemptFinish: options.onAttemptFinish,
    };

    const result = await this.graph.runOneCall(callOptions);
    void targetKinds;
    return {
      document: result.document,
      error: result.error,
      repair: result.repair,
      attempts: result.attempts,
    };
  }

  private async runSectionCall(
    plan: Plan,
    schema: object,
    skills: ReturnType<typeof resolveSkillsForStage>,
    targetKinds: readonly PdfSectionKind[],
    priorSections: readonly unknown[],
    options: PdfSectionOrchestratorOptions,
    perCallPrompts: string[],
  ): Promise<{
    sections: PdfSection[] | null;
    error: PlannerError | null;
    repair: PdfDocumentRepair | null;
    attempts: number;
    usedFallback: boolean;
  }> {
    const prompt = await this.promptBuilder.buildPdfSectionPrompt({
      plan,
      priorSections,
      targetSectionKinds: targetKinds,
      schema,
      skillOverrides: skills,
    });
    const renderPrompt = async (retrySection: string): Promise<string> => {
      if (!retrySection) {
        return prompt.format({});
      }
      const systemMessage = await prompt.format({});
      return `${systemMessage}\n\n${retrySection}`;
    };

    const renderable = await renderPrompt('');
    perCallPrompts.push(renderable);

    const callOptions: RunOneCallOptions = {
      maxRetries: options.maxRetries ?? 2,
      llmInvoker: options.llmInvoker,
      renderPrompt,
      planContext: { title: plan.meta?.title, summary: plan.meta?.summary },
      onAttemptStart: options.onAttemptStart,
      onAttemptFinish: options.onAttemptFinish,
      acceptPartialDocument: true,
    };

    const result = await this.graph.runOneCall(callOptions);

    if (result.error || !result.document) {
      return {
        sections: null,
        error: result.error ?? {
          type: 'provider_error' as const,
          message: 'Section call failed with no error payload.',
        },
        repair: result.repair,
        attempts: result.attempts,
        usedFallback: true,
      };
    }

    return {
      sections: result.document.sections,
      error: null,
      repair: result.repair,
      attempts: result.attempts,
      usedFallback: false,
    };
  }
}
