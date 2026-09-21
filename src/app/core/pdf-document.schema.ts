import { z } from 'zod';

const SYSTEM_DIAGRAM_FIELDS = [
  'c4.contextDiagram',
  'c4.containerDiagram',
  'boundedContextMap',
] as const;

const LAYER_DIAGRAM_FIELDS = [
  'mermaidDiagram',
  'componentTreeDiagram',
  'dataFlowDiagram',
  'moduleDependenciesDiagram',
  'stateManagementDiagram',
  'apiContractDiagram',
] as const;

const LAYER_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const MermaidRefSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('system'),
    field: z.enum(SYSTEM_DIAGRAM_FIELDS),
  }),
  z.object({
    kind: z.literal('layer'),
    layerId: z.string().min(1).regex(LAYER_ID_PATTERN),
    field: z.enum(LAYER_DIAGRAM_FIELDS),
  }),
  z.object({
    kind: z.literal('blueprint'),
  }),
  z.object({
    kind: z.literal('tech-stack'),
    layerId: z.string().min(1).regex(LAYER_ID_PATTERN),
  }),
]);
export type MermaidRef = z.infer<typeof MermaidRefSchema>;

export const PdfBlockSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('paragraph'),
    text: z.string().min(1),
  }),
  z.object({
    kind: z.literal('bullets'),
    items: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    kind: z.literal('numbered'),
    items: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    kind: z.literal('keyValueTable'),
    rows: z.array(z.tuple([z.string().min(1), z.string().min(1)])).min(1),
  }),
  z.object({
    kind: z.literal('mermaidRef'),
    ref: MermaidRefSchema,
    caption: z.string().min(1),
  }),
  z.object({
    kind: z.literal('callout'),
    tone: z.enum(['info', 'success', 'warning', 'risk']).optional(),
    title: z.string().min(1).optional(),
    text: z.string().min(1),
  }),
  z.object({
    kind: z.literal('glossary'),
    entries: z.array(z.tuple([z.string().min(1), z.string().min(1)])).min(1),
  }),
  z.object({
    kind: z.literal('matrix'),
    columns: z.array(z.string().min(1)).min(1),
    rows: z
      .array(
        z.object({
          label: z.string().min(1),
          cells: z.array(z.string()),
        }),
      )
      .min(1),
    caption: z.string().optional(),
  }),
]);
export type PdfBlock = z.infer<typeof PdfBlockSchema>;

export const PdfSectionSchema = z.object({
  heading: z.string().min(1),
  blocks: z.array(PdfBlockSchema).min(1),
});
export type PdfSection = z.infer<typeof PdfSectionSchema>;

export const PdfDocumentSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().min(1).nullish(),
  generatedAt: z.string().min(1),
  executiveSummary: z.string().min(20).max(600),
  sections: z.array(PdfSectionSchema).min(1).max(12),
});
export type PdfDocument = z.infer<typeof PdfDocumentSchema>;

export const PdfPartialDocumentSchema = z.object({
  sections: z.array(PdfSectionSchema).min(1).max(12),
});
export type PdfPartialDocument = z.infer<typeof PdfPartialDocumentSchema>;
