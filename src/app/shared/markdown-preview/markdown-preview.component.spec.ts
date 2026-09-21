import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { MarkdownRendererService } from '../../core/markdown-renderer.service';
import { MarkdownPreviewComponent } from './markdown-preview.component';

describe('MarkdownPreviewComponent', () => {
  function setup(markdown: string) {
    TestBed.configureTestingModule({
      imports: [MarkdownPreviewComponent],
      providers: [MarkdownRendererService],
    });

    const fixture = TestBed.createComponent(MarkdownPreviewComponent);
    fixture.componentRef.setInput('markdown', markdown);
    fixture.detectChanges();
    return { fixture };
  }

  it('renders sanitised HTML when markdown is provided', () => {
    const { fixture } = setup('# Hello');
    const root = fixture.nativeElement as HTMLElement;
    const h1 = root.querySelector('h1');

    expect(h1).not.toBeNull();
    expect(h1?.textContent?.trim()).toBe('Hello');
  });

  it('updates the rendered HTML when the markdown input changes', () => {
    const { fixture } = setup('# First');
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('h1')?.textContent?.trim()).toBe('First');

    fixture.componentRef.setInput('markdown', '# Second');
    fixture.detectChanges();

    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Second');
  });

  it('shows an empty-state message when markdown is blank', () => {
    const { fixture } = setup('');
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('.md')).toBeNull();
    expect(root.querySelector('.empty')).not.toBeNull();
  });

  it('strips <script> tags from raw HTML via DOMPurify', () => {
    const { fixture } = setup('# Hello\n<script>window.__pwned = true;</script>');
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('script')).toBeNull();
    expect((root as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Hello');
  });

  it('strips onerror= handlers and other XSS vectors', () => {
    const { fixture } = setup(
      '<img src=x onerror="window.__xss = true">\n<span onmouseover="window.__xss=true">hover</span>',
    );
    const root = fixture.nativeElement as HTMLElement;

    const img = root.querySelector('img');
    expect(img?.getAttribute('onerror')).toBeNull();
    const span = root.querySelector('span');
    expect(span?.getAttribute('onmouseover')).toBeNull();
    expect((root as unknown as { __xss?: boolean }).__xss).toBeUndefined();
  });

  it('passes mermaid code fences through unchanged (renderer decides separately)', () => {
    const { fixture } = setup('```mermaid\nflowchart TD\nA --> B\n```');
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('code.language-mermaid')).not.toBeNull();
    expect(root.querySelector('svg')).toBeNull();
  });
});
