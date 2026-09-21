import { Injectable } from '@angular/core';
import { PdfDocument, PdfSection } from './pdf-document.schema';
import { PdfSectionKind } from './pdf-section-planner';

export interface PdfDocumentHeader {
  title: string;
  subtitle: string | null | undefined;
  generatedAt: string;
  executiveSummary: string;
  sections: readonly PdfSection[];
}

export interface SectionBatchResult {
  targetKinds: readonly PdfSectionKind[];
  sections: readonly PdfSection[];
  usedFallback: boolean;
}

export interface StitchResult {
  document: PdfDocument;
  placeholders: number;
}

@Injectable({ providedIn: 'root' })
export class PdfStitcherService {
  stitchSections(
    headerCall: PdfDocumentHeader,
    sectionCalls: ReadonlyArray<SectionBatchResult>,
  ): StitchResult {
    const merged: PdfSection[] = [...headerCall.sections];
    let placeholderCount = 0;

    for (const batch of sectionCalls) {
      if (batch.usedFallback || batch.sections.length === 0) {
        placeholderCount += batch.targetKinds.length;
        continue;
      }
      for (const section of batch.sections) {
        merged.push(section);
      }
    }

    const document: PdfDocument = {
      title: headerCall.title,
      subtitle: headerCall.subtitle ?? undefined,
      generatedAt: headerCall.generatedAt,
      executiveSummary: headerCall.executiveSummary,
      sections: merged,
    };

    return {
      document,
      placeholders: placeholderCount,
    };
  }
}
