import { Injectable, inject } from '@angular/core';
import { AuditFinding } from './audit-runner.service';
import {
  DiagramAuditEntry,
  DiagramAuditReport,
  DiagramAuditService,
  DiagramLocation,
} from './diagram-audit.service';
import { DiagramRepairService } from './diagram-repair.service';
import { LocalAuditFixer } from './local-audit-fixer.service';
import { Plan } from './plan.schema';

type SynthesisedDiagramLocation = Extract<
  DiagramLocation,
  { scope: 'synthesised' }
>;

export type LlmInvoker = (promptText: string) => Promise<{ text: string }>;

export interface VerifyAndFixResult {

  plan: Plan;

  residual: DiagramAuditEntry[];

  synthesisedPatches: Record<string, string>;

  repairedCount: number;
}

interface VerifyAndFixOptions {

  maxIterations?: number;
}

const DEFAULT_MAX_ITERATIONS = 5;

@Injectable({ providedIn: 'root' })
export class MermaidVerifyService {
  private readonly diagramAudit = inject(DiagramAuditService);
  private readonly diagramRepair = inject(DiagramRepairService);
  private readonly localAuditFixer = inject(LocalAuditFixer);

  async verifyAndFix(
    plan: Plan,
    llmInvoker: LlmInvoker,
    signal: AbortSignal | undefined,
    options: VerifyAndFixOptions = {},
  ): Promise<VerifyAndFixResult> {
    const maxIterations = Math.max(1, options.maxIterations ?? DEFAULT_MAX_ITERATIONS);

    let working = plan;
    let synthesisedPatches: Record<string, string> = {};
    let totalRepaired = 0;

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      if (signal?.aborted) {
        return this.makeResult(working, synthesisedPatches, totalRepaired);
      }





      let audit: DiagramAuditReport;
      try {
        audit = await this.diagramAudit.auditPlanWithSynthesised(working);
      } catch {
        return this.makeResult(working, synthesisedPatches, totalRepaired);
      }

      const failures = audit.entries.filter((e) => e.status === 'failed');
      if (failures.length === 0) {
        return this.makeResult(working, synthesisedPatches, totalRepaired);
      }

      const { stored, synthesised } = this.splitFailures(failures);





      if (stored.length > 0) {
        const findings = this.entriesToFindings(stored);
        const inPlace = this.localAuditFixer.tryFixInPlace(working, findings);
        if (inPlace.plan !== working) {
          working = inPlace.plan;
        }
      }

      let repairedThisIteration = 0;



      if (synthesised.length > 0) {
        const synthFix = await this.localAuditFixer.tryFixSynthesised(working, audit);
        for (const patch of synthFix.patches) {
          synthesisedPatches = { ...synthesisedPatches, [this.patchKey(patch.location)]: patch.source };
          repairedThisIteration += 1;
        }
      }





      let auditAfterDet: DiagramAuditReport;
      try {
        auditAfterDet = await this.diagramAudit.auditPlanWithSynthesised(working);
      } catch {
        return this.makeResult(working, synthesisedPatches, totalRepaired);
      }
      if (signal?.aborted) {
        return this.makeResult(working, synthesisedPatches, totalRepaired);
      }
      const residualAfterDet = auditAfterDet.entries.filter((e) => e.status === 'failed');
      const { stored: storedAfter, synthesised: synthAfter } = this.splitFailures(residualAfterDet);





      if (storedAfter.length > 0) {
        try {
          const repair = await this.diagramRepair.repairPlan(working, auditAfterDet, llmInvoker);
          if (repair.plan !== working) {
            working = repair.plan;
          }
          repairedThisIteration += repair.repaired.length;
        } catch {



        }
      }





      if (synthAfter.length > 0) {
        let auditForSynth: DiagramAuditReport;
        try {
          auditForSynth = await this.diagramAudit.auditPlanWithSynthesised(working);
        } catch {
          return this.makeResult(working, synthesisedPatches, totalRepaired);
        }
        const synthFix = await this.localAuditFixer.tryFixSynthesised(working, auditForSynth);
        for (const patch of synthFix.patches) {
          if (!(this.patchKey(patch.location) in synthesisedPatches)) {
            synthesisedPatches = {
              ...synthesisedPatches,
              [this.patchKey(patch.location)]: patch.source,
            };
            repairedThisIteration += 1;
          }
        }
      }

      totalRepaired += repairedThisIteration;

      if (repairedThisIteration === 0) {



        return this.makeResult(working, synthesisedPatches, totalRepaired);
      }

      // eslint-disable-next-line no-console
      console.info(
        `[mermaid-verify] iteration ${iteration + 1}/${maxIterations} complete, ` +
          `repaired this iteration: ${repairedThisIteration}, ` +
          `total repaired so far: ${totalRepaired}`,
      );
    }

    return this.makeResult(working, synthesisedPatches, totalRepaired);
  }

  residualToFindings(residual: readonly DiagramAuditEntry[]): AuditFinding[] {
    return residual.map((entry) => ({
      severity: 'error' as const,
      path: this.entryToPath(entry),
      message: entry.error ?? `Mermaid parse failed for ${this.entryToPath(entry)}`,
      fix:
        entry.location.scope === 'synthesised'
          ? 'Re-render the synthesised diagram with normalised source.'
          : 'Repair the Mermaid source so it parses cleanly.',
    }));
  }

  private makeResult(
    plan: Plan,
    synthesisedPatches: Record<string, string>,
    totalRepaired: number,
  ): Promise<VerifyAndFixResult> {
    return Promise.resolve({
      plan,
      residual: [],
      synthesisedPatches,
      repairedCount: totalRepaired,
    }).then(async (partial) => {



      let finalAudit: DiagramAuditReport;
      try {
        finalAudit = await this.diagramAudit.auditPlanWithSynthesised(plan);
      } catch {
        return partial;
      }
      const residual = finalAudit.entries.filter((e) => e.status === 'failed');
      return { ...partial, residual };
    });
  }

  private splitFailures(failures: readonly DiagramAuditEntry[]): {
    stored: DiagramAuditEntry[];
    synthesised: DiagramAuditEntry[];
  } {
    const stored: DiagramAuditEntry[] = [];
    const synthesised: DiagramAuditEntry[] = [];
    for (const f of failures) {
      if (f.location.scope === 'synthesised') synthesised.push(f);
      else stored.push(f);
    }
    return { stored, synthesised };
  }

  private entriesToFindings(entries: readonly DiagramAuditEntry[]): AuditFinding[] {
    return entries.map((entry) => ({
      severity: 'error' as const,
      path: this.entryToPath(entry),
      message: entry.error ?? `Mermaid parse failed for ${this.entryToPath(entry)}`,
      fix: 'Repair the Mermaid source so it parses cleanly.',
    }));
  }

  private entryToPath(entry: DiagramAuditEntry): string {
    return this.locationToPath(entry.location);
  }

  private locationToPath(location: DiagramLocation): string {
    if (location.scope === 'system') {
      return `systemOverview.${location.field}`;
    }
    if (location.scope === 'layer') {
      return `architectureLayers[${location.layerId}].${location.field}`;
    }
    return `synthesised.${location.id}`;
  }

  private patchKey(location: DiagramLocation): string {
    if (location.scope === 'synthesised') return location.id;
    return this.locationToPath(location);
  }
}
