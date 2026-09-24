import { inject, Injectable } from '@angular/core';
import JSZip from 'jszip';
import { Plan } from './plan.schema';
import { MarkdownRendererService } from './markdown-renderer.service';
import { branchName, featureFolder } from './feature-slug';
import { ProjectStore } from './project.store';

const CONSTITUTION_PATH = '.specify/memory/constitution.md';

@Injectable({ providedIn: 'root' })
export class ExportService {
  private readonly markdownRenderer = inject(MarkdownRendererService);
  private readonly store = inject(ProjectStore);

  async buildZip(plan: Plan, overrides: Record<string, string>): Promise<Blob> {
    const zip = new JSZip();
    const files = this.markdownRenderer.toMarkdownFiles(plan, { includeDirectoryAgents: false });

    for (const file of files) {
      zip.file(file.path, overrides[file.path] ?? file.content);
    }

    const stamped = {
      ...plan,
      meta: { ...plan.meta, tokenStats: this.store.tokenStats() },
    };

    zip.file('plan.json', JSON.stringify(stamped, null, 2));
    zip.file(
      'features.json',
      JSON.stringify(buildFeaturesIndex(plan, this.markdownRenderer), null, 2),
    );

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
