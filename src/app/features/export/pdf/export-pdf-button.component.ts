import { ChangeDetectionStrategy, Component, EventEmitter, Output, input } from '@angular/core';
import { ButtonModule } from 'primeng/button';

@Component({
  selector: 'app-export-pdf-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonModule],
  template: `
    <p-button
      label="Export PDF"
      icon="pi pi-file-pdf"
      severity="secondary"
      [loading]="loading()"
      [disabled]="disabled()"
      (onClick)="click.emit()"
    />
  `,
})
export class ExportPdfButtonComponent {
  readonly loading = input(false);
  readonly disabled = input(false);
  @Output() readonly click = new EventEmitter<void>();
}
