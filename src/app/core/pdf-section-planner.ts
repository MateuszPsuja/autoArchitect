import { Plan } from './plan.schema';

export type PdfSectionKind =
  | 'System Overview'
  | 'Bounded Contexts'
  | 'Architecture Layers'
  | 'Per-Layer Spec Kit Highlights'
  | 'Domain Deep Dive'
  | 'Key Workflows'
  | 'Architecture Decisions (ADRs)'
  | 'Glossary & Appendix';

export const PDF_SECTION_KINDS: readonly PdfSectionKind[] = [
  'System Overview',
  'Bounded Contexts',
  'Architecture Layers',
  'Per-Layer Spec Kit Highlights',
  'Domain Deep Dive',
  'Key Workflows',
  'Architecture Decisions (ADRs)',
  'Glossary & Appendix',
] as const;

export function computeActiveSectionList(plan: Plan): readonly PdfSectionKind[] {
  const result: PdfSectionKind[] = [];

  for (const kind of PDF_SECTION_KINDS) {
    if (kind === 'Per-Layer Spec Kit Highlights') {
      const anyTechContext = plan.architectureLayers.some((l) => {
        const tc = l.technicalContext;
        if (!tc) return false;
        return (
          (typeof tc.storage === 'string' && tc.storage.length > 0) ||
          (typeof tc.targetPlatform === 'string' && tc.targetPlatform.length > 0) ||
          (typeof tc.performanceGoals === 'string' && tc.performanceGoals.length > 0) ||
          (typeof tc.constraints === 'string' && tc.constraints.length > 0) ||
          (typeof tc.scaleScope === 'string' && tc.scaleScope.length > 0)
        );
      });
      const anyComplexity = plan.architectureLayers.some(
        (l) => Array.isArray(l.complexityTracking) && l.complexityTracking.length > 0,
      );
      if (!anyTechContext && !anyComplexity) {
        continue;
      }
      result.push(kind);
      continue;
    }

    if (kind === 'Key Workflows') {
      if (!plan.workflows || plan.workflows.length === 0) continue;
      result.push(kind);
      continue;
    }

    if (kind === 'Architecture Decisions (ADRs)') {
      if (!plan.adrs || plan.adrs.length === 0) continue;
      result.push(kind);
      continue;
    }

    result.push(kind);
  }

  return result;
}
