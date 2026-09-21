import { Injectable } from '@angular/core';
import { ContextAttachment, ContextAttachmentKind } from './context-attachment.model';

const MAX_FILES = 10;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS_PER_FILE = 20_000;
const MAX_TOTAL_TEXT_CHARS = 60_000;

@Injectable({ providedIn: 'root' })
export class ContextFileReaderService {
  async readFiles(files: File[]): Promise<ContextAttachment[]> {
    const selected = files.slice(0, MAX_FILES);
    const attachments: ContextAttachment[] = [];
    let remainingTextBudget = MAX_TOTAL_TEXT_CHARS;

    for (const file of selected) {
      const attachment = await this.readFile(file, remainingTextBudget);
      attachments.push(attachment);
      remainingTextBudget = Math.max(0, remainingTextBudget - attachment.extractedText.length);
    }

    if (files.length > MAX_FILES) {
      attachments.push({
        id: crypto.randomUUID(),
        name: 'File limit reached',
        mimeType: 'application/x-limit-warning',
        size: 0,
        kind: 'unsupported',
        extractedText: '',
        warning: `Only the first ${MAX_FILES} files were added to context.`,
      });
    }

    return attachments;
  }

  private async readFile(file: File, remainingTextBudget: number): Promise<ContextAttachment> {
    const kind = this.detectKind(file);
    const base = this.baseAttachment(file, kind);

    if (file.size > MAX_FILE_BYTES) {
      return {
        ...base,
        warning: `Skipped: file is larger than ${this.formatBytes(MAX_FILE_BYTES)}.`,
      };
    }

    if (remainingTextBudget <= 0 && kind !== 'image') {
      return {
        ...base,
        warning: 'Skipped: total context text limit was reached.',
      };
    }

    try {
      if (kind === 'text' || kind === 'markdown') {
        return this.withExtractedText(base, await file.text(), remainingTextBudget);
      }

      if (kind === 'pdf') {
        return this.withExtractedText(base, await this.extractPdfText(file), remainingTextBudget);
      }

      if (kind === 'image') {
        const dimensions = await this.readImageDimensions(file);
        return {
          ...base,
          extractedText: [
            `Image context file: ${file.name}`,
            `MIME type: ${file.type || 'unknown'}`,
            `Size: ${this.formatBytes(file.size)}`,
            dimensions ? `Dimensions: ${dimensions.width}x${dimensions.height}px` : 'Dimensions: unavailable',
            'Note: image bytes are not sent to the text-only planning prompt; add any important visual details to the application idea or constraints.',
          ].join('\n'),
          summary: dimensions
            ? `${dimensions.width}x${dimensions.height}px · ${this.formatBytes(file.size)}`
            : this.formatBytes(file.size),
        };
      }

      return {
        ...base,
        warning: 'Unsupported file type. Supported: .md, .txt, .pdf, and images.',
      };
    } catch (error) {
      return {
        ...base,
        warning: error instanceof Error ? error.message : 'Could not read this file.',
      };
    }
  }

  private baseAttachment(file: File, kind: ContextAttachmentKind): ContextAttachment {
    return {
      id: crypto.randomUUID(),
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      kind,
      extractedText: '',
    };
  }

  private detectKind(file: File): ContextAttachmentKind {
    const name = file.name.toLowerCase();
    const type = file.type.toLowerCase();

    if (name.endsWith('.md') || name.endsWith('.markdown') || type === 'text/markdown') return 'markdown';
    if (name.endsWith('.txt') || type.startsWith('text/plain')) return 'text';
    if (name.endsWith('.pdf') || type === 'application/pdf') return 'pdf';
    if (type.startsWith('image/')) return 'image';
    return 'unsupported';
  }

  private withExtractedText(
    attachment: ContextAttachment,
    text: string,
    remainingTextBudget: number,
  ): ContextAttachment {
    const normalized = text.replace(/\r\n/g, '\n').trim();
    const maxChars = Math.min(MAX_TEXT_CHARS_PER_FILE, remainingTextBudget);
    const extractedText = normalized.slice(0, maxChars);
    const wasTruncated = normalized.length > extractedText.length;

    return {
      ...attachment,
      extractedText,
      summary: `${extractedText.length.toLocaleString()} chars extracted`,
      warning: wasTruncated
        ? `Truncated from ${normalized.length.toLocaleString()} to ${extractedText.length.toLocaleString()} characters.`
        : attachment.warning,
    };
  }

  private async extractPdfText(file: File): Promise<string> {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.mjs',
      import.meta.url,
    ).toString();

    const bytes = await file.arrayBuffer();
    const document = await pdfjs.getDocument({ data: bytes }).promise;
    const pages: string[] = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) => ('str' in item ? item.str : ''))
          .filter(Boolean)
          .join(' '),
      );
    }

    return pages.join('\n\n');
  }

  private readImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / 1024 ** exponent;
    return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
  }
}
