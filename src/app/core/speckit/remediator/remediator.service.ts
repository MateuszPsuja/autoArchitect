import { Injectable } from '@angular/core';
import { Plan } from '../../plan.schema';
import {
  ExportStageFn,
  ExportPassResult,
  Finding,
  MarkdownFile,
  RemediationReport,
} from './remediator.types';
import { runConstitutionStage } from './stage-constitution';
import { runCoverageStage } from './stage-coverage';
import { runTaskQualityStage } from './stage-task-quality';
import { runTraceabilityStage } from './stage-traceability';
import { runAmbiguityStage } from './stage-ambiguity';
import { runProviderIdentityStage } from './stage-provider-identity';
import { runExportChecks } from './stage-export-checks';
import { rewriteProviders } from './providers';

const GENERATION_STAGES: ReadonlyArray<(plan: Plan) => Finding[]> = [
  runConstitutionStage,
  runCoverageStage,
  runTaskQualityStage,
  runTraceabilityStage,
  runAmbiguityStage,
];

const EXPORT_STAGES: ReadonlyArray<ExportStageFn> = [
  runProviderIdentityStage,
  runExportChecks,
];

@Injectable({ providedIn: 'root' })
export class RemediatorService {
  runGenerationPass(plan: Plan, drafts: ReadonlyArray<MarkdownFile> = []): RemediationReport {
    const findings: Finding[] = [];
    for (const stage of GENERATION_STAGES) {
      findings.push(...stage(plan));
    }
    for (const draft of drafts) {
      for (const stage of EXPORT_STAGES) {
        findings.push(...stage(plan, [draft]));
      }
    }
    return { findings, applied: findings, skipped: [] };
  }

  runExportPass(plan: Plan, files: MarkdownFile[]): ExportPassResult {
    const findings: Finding[] = [];
    for (const stage of EXPORT_STAGES) {
      findings.push(...stage(plan, files));
    }
    const rewrittenFiles = files.map((f) => ({
      ...f,
      content: this.applyExportFixes(f.content, findings),
    }));
    return { files: rewrittenFiles, report: { findings, applied: findings, skipped: [] } };
  }

  applyGenerationPatches(plan: Plan, report: RemediationReport): Plan {
    let next: Plan = plan;
    for (const finding of report.applied) {
      if (!finding.fix) continue;
      if (finding.fix.kind === 'plan-patch') {
        const payload = finding.fix.payload as { functionalRequirements?: unknown[]; specKit?: unknown };
        next = {
          ...next,
          ...(payload.functionalRequirements
            ? {
                functionalRequirements: [
                  ...(next.functionalRequirements ?? []),
                  ...(payload.functionalRequirements as Plan['functionalRequirements']),
                ],
              }
            : {}),
          ...(payload.specKit
            ? {
                specKit: {
                  ...(next.specKit ?? { offlineContract: null, keyEntities: [], patches: [] }),
                  ...(payload.specKit as Partial<Plan['specKit']>),
                },
              }
            : {}),
        } as Plan;
      }
    }
    return next;
  }

  private applyExportFixes(content: string, findings: Finding[]): string {
    let out = content;
    out = rewriteProviders(out);
    for (const finding of findings) {
      if (finding.fix?.kind !== 'markdown-replace') continue;
      const replacements = (finding.fix.payload as { replacements?: { from: string; to: string }[] }).replacements;
      if (!replacements) continue;
      for (const repl of replacements) {
        const escaped = repl.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        out = out.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), repl.to);
      }
    }
    return out;
  }
}
