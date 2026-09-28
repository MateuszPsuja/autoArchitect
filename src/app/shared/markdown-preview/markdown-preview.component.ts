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
  styleUrl: './markdown-preview.component.scss',
})
export class MarkdownPreviewComponent {
  readonly markdown = input.required<string>();

  private readonly renderer = inject(MarkdownRendererService);

  protected readonly safeHtml = computed(() => this.renderer.toSafeHtml(this.markdown()));
}
