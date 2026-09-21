import { Injectable, inject } from '@angular/core';
import { Plan } from './plan.schema';
import { ProjectStore } from './project.store';
import { AuditFinding } from './audit-runner.service';
import { LocalAuditFixer } from './local-audit-fixer.service';
import { SectionRepairRunner } from './section-repair-runner.service';
import { GeneratePromptInput, RefinementInstructionBlock } from './prompt-builder.service';

export interface AuditRepairResult {
  plan: Plan;
  residualFindings: AuditFinding[];
  attempts: number;
}

@Injectable({ providedIn: 'root' })
export class AuditRepairRunner {
  private readonly sectionRepair = inject(SectionRepairRunner);
  private readonly projectStore = inject(ProjectStore);
  private readonly localFixer = inject(LocalAuditFixer);

  async invoke(
    plan: Plan,
    findings: AuditFinding[],
    llmInvoker: (promptText: string) => Promise<{ text: string }>,
    input: GeneratePromptInput | null = null,
    refinementInstruction?: RefinementInstructionBlock,
  ): Promise<AuditRepairResult> {
    const maxAttempts = Math.max(0, this.projectStore.config().auditRepairMaxAttempts ?? 1);

    const localResult = this.localFixer.tryFixInPlace(plan, findings);
    const residual = localResult.fixedPaths.length > 0
      ? findings.filter((f) => !localResult.fixedPaths.includes(f.path))
      : findings;

    if (maxAttempts === 0 || residual.length === 0) {
      return {
        plan: localResult.plan,
        residualFindings: residual,
        attempts: 0,
      };
    }

    const result = await this.sectionRepair.invokeSectionScoped(
      localResult.plan,
      residual,
      input,
       llmInvoker,
       { auditRepairMaxAttempts: maxAttempts, refinementInstruction },
    );

    return {
      plan: result.plan,
      residualFindings: result.residualFindings,
      attempts: result.attempts,
    };
  }

  shouldBailAuditRepair(
    previous: ReadonlySet<string>,
    next: ReadonlySet<string>,
  ): boolean {
    return SectionRepairRunner.shouldBailAuditRepair(previous, next);
  }
}
