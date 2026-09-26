import { inject, Injectable } from '@angular/core';
import JSZip from 'jszip';
import { Plan } from './plan.schema';
import { MarkdownFile, MarkdownRendererService } from './markdown-renderer.service';
import { buildOpenSpecFileList } from './openspec/openspec-renderer';

@Injectable({ providedIn: 'root' })
export class OpenSpecExportService {
  private readonly markdown = inject(MarkdownRendererService);

  listFiles(plan: Plan): MarkdownFile[] {
    return buildOpenSpecFileList(plan).map((f) => ({
      ...f,
      content: this.markdown.applyTerminologyPipeline(f.content),
    }));
  }

  async buildZip(plan: Plan, overrides: Record<string, string>): Promise<Blob> {
    const zip = new JSZip();
    for (const file of this.listFiles(plan)) {
      zip.file(file.path, overrides[file.path] ?? file.content);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    return zip.generateAsync({ type: 'blob' });
  }
}