import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { MarkdownRendererService } from '../../core/markdown-renderer.service';

@Component({
  selector: 'app-markdown-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (markdown()) {
      <div class="md" [innerHTML]="safeHtml()"></div>
    } @else {
      <p class="empty">No content yet.</p>
    }
  `,
  styles: `
    :host {
      display: block;
    }

    .md {
      color: var(--text-color);
      font-size: 0.82rem;
      line-height: 1.5;
      max-width: 72ch;
    }

    .md > :first-child {
      margin-top: 0;
    }

    .md h1,
    .md h2,
    .md h3,
    .md h4,
    .md h5,
    .md h6 {
      color: var(--text-color);
      font-weight: 700;
      line-height: 1.25;
      margin-bottom: 0.5em;
      margin-top: 1.1em;
    }

    .md h1 { font-size: 1.35rem; }
    .md h2 {
      border-bottom: 1px solid var(--surface-border);
      font-size: 1.15rem;
      padding-bottom: 0.25em;
    }
    .md h3 {
      border-bottom: 1px solid var(--surface-border);
      font-size: 1rem;
      padding-bottom: 0.2em;
    }
    .md h4 { font-size: 0.9rem; }
    .md h5 { font-size: 0.82rem; }
    .md h6 { font-size: 0.78rem; }

    .md p {
      margin: 0.45em 0;
    }

    .md a {
      color: var(--primary-color);
      text-decoration: none;
    }
    .md a:hover {
      text-decoration: underline;
    }

    .md ul,
    .md ol {
      margin: 0.6em 0;
      padding-left: 1.2em;
    }

    .md ul li::marker,
    .md ol li::marker {
      color: var(--text-color-secondary);
    }

    .md blockquote {
      border-left: 3px solid var(--primary-color);
      color: var(--text-color-secondary);
      margin: 1em 0;
      padding-left: 0.7em;
    }

    .md code {
      background: var(--surface-100);
      border-radius: 4px;
      font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.85em;
      padding: 1px 6px;
    }

    .md pre {
      margin: 1em 0;
    }

    .md pre code {
      background: var(--surface-900);
      border-radius: var(--radius-md);
      color: var(--surface-0);
      display: block;
      font-size: 0.75rem;
      overflow-x: auto;
      padding: 0.7em 0.85em;
      width: 100%;
    }

    .md hr {
      border: 0;
      border-top: 1px solid var(--surface-border);
      margin: 1.4em 0;
    }

    .md table {
      border: 1px solid var(--surface-border);
      border-collapse: separate;
      border-radius: var(--radius-md);
      border-spacing: 0;
      margin: 1em 0;
      overflow: hidden;
      table-layout: fixed;
      width: 100%;
    }

    .md table th,
    .md table td {
      border-bottom: 1px solid var(--surface-border);
      border-right: 1px solid var(--surface-border);
      overflow-wrap: anywhere;
      padding: 0.4em 0.6em;
      text-align: left;
      vertical-align: top;
      word-break: break-word;
    }

    .md table th {
      background: var(--surface-100);
      color: var(--text-color);
      font-weight: 600;
    }

    .md table tbody tr:nth-child(even) td {
      background: color-mix(in srgb, var(--surface-100) 60%, transparent);
    }

    .md table tbody tr:last-child td {
      border-bottom: 0;
    }

    .md table th:last-child,
    .md table td:last-child {
      border-right: 0;
    }

    .empty {
      color: var(--text-color-secondary);
      font-style: italic;
      margin: 0;
    }
  `,
})
export class MarkdownPreviewComponent {
  readonly markdown = input.required<string>();

  private readonly renderer = inject(MarkdownRendererService);

  protected readonly safeHtml = computed(() => this.renderer.toSafeHtml(this.markdown()));
}
