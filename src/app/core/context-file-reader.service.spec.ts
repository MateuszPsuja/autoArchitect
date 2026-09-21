import { TestBed } from '@angular/core/testing';
import { ContextFileReaderService } from './context-file-reader.service';

describe('ContextFileReaderService', () => {
  let service: ContextFileReaderService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ContextFileReaderService);
  });

  it('extracts text files as prompt context', async () => {
    const file = new File(['Important project details'], 'details.txt', { type: 'text/plain' });

    const [attachment] = await service.readFiles([file]);

    expect(attachment.name).toBe('details.txt');
    expect(attachment.kind).toBe('text');
    expect(attachment.extractedText).toBe('Important project details');
    expect(attachment.warning).toBeUndefined();
  });

  it('extracts markdown files as markdown context', async () => {
    const file = new File(['# Planning\n\nUse DDD.'], 'notes.md', { type: 'text/markdown' });

    const [attachment] = await service.readFiles([file]);

    expect(attachment.kind).toBe('markdown');
    expect(attachment.extractedText).toContain('Use DDD.');
  });

  it('returns a warning for unsupported files', async () => {
    const file = new File(['{}'], 'data.json', { type: 'application/json' });

    const [attachment] = await service.readFiles([file]);

    expect(attachment.kind).toBe('unsupported');
    expect(attachment.extractedText).toBe('');
    expect(attachment.warning).toContain('Unsupported file type');
  });

  it('truncates very large text files', async () => {
    const file = new File(['a'.repeat(25_000)], 'large.txt', { type: 'text/plain' });

    const [attachment] = await service.readFiles([file]);

    expect(attachment.extractedText.length).toBe(20_000);
    expect(attachment.warning).toContain('Truncated');
  });
});
