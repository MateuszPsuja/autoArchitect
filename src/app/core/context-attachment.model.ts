export type ContextAttachmentKind = 'text' | 'markdown' | 'pdf' | 'image' | 'unsupported';

export interface ContextAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: ContextAttachmentKind;
  extractedText: string;
  summary?: string;
  warning?: string;
}
