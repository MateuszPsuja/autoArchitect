import { inject, Injectable } from '@angular/core';
import JSZip from 'jszip';
import { Plan } from './plan.schema';
import { MarkdownRendererService } from './markdown-renderer.service';
import { branchName, featureFolder } from './feature-slug';
import { ProjectStore } from './project.store';
import { RemediatorService } from './speckit/remediator/remediator.service';

const CONSTITUTION_PATH = '.specify/memory/constitution.md';
const REMEDIATION_REPORT_PATH = '.specify/memory/remediation-report.json';

@Injectable({ providedIn: 'root' })
export class ExportService {
  private readonly markdownRenderer = inject(MarkdownRendererService);
  private readonly store = inject(ProjectStore);
  private readonly remediator = inject(RemediatorService);

  async buildZip(plan: Plan, overrides: Record<string, string>): Promise<Blob> {
    const zip = new JSZip();
    const draftFiles = this.markdownRenderer.toMarkdownFiles(plan, { includeDirectoryAgents: false });
    const pass = this.remediator.runExportPass(plan, draftFiles);
    const files = pass.files;

    for (const file of files) {
      zip.file(file.path, overrides[file.path] ?? file.content);
    }

    zip.file(REMEDIATION_REPORT_PATH, JSON.stringify(pass.report, null, 2));

    return zip.generateAsync({ type: 'blob' });
  }

  buildFeaturesIndex(plan: Plan): object {
    return buildFeaturesIndex(plan, this.markdownRenderer);
  }
}

function buildFeaturesIndex(
  plan: Plan,
  renderer: MarkdownRendererService,
): {
  version: number;
  generatedAt: string;
  features: Array<{
    featureNumber: number;
    featureSlug: string;
    title: string;
    summary: string;
    branchName: string;
    artefacts: string[];
    checklistPath: string;
    constitutionPath: string;
  }>;
} {
  const files = renderer.toMarkdownFiles(plan);
  const artefacts = files
    .map((f) => f.path)
    .filter((p) => !p.endsWith('/AGENTS.md') || p.includes('docs/'))
    .sort();
  return {
    version: 3,
    generatedAt: new Date().toISOString(),
    features: [
      {
        featureNumber: plan.meta.featureNumber,
        featureSlug: plan.meta.featureSlug,
        title: plan.meta.title,
        summary: plan.meta.summary,
        branchName: plan.meta.branchName ?? branchName(plan),
        artefacts,
        checklistPath: `${featureFolder(plan)}/checklist.md`,
        constitutionPath: CONSTITUTION_PATH,
      },
    ],
  };
}
