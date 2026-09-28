import { Component, input } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { TextareaModule } from 'primeng/textarea';

@Component({
  selector: 'app-constraints-form',
  imports: [ReactiveFormsModule, TextareaModule],
  template: `
    <div class="field">
      <label [for]="inputId()" class="field-label">{{ label() }}</label>
      <textarea
        pTextarea
        [id]="inputId()"
        [rows]="rows()"
        [formControl]="control()"
        [placeholder]="placeholder()"
        [attr.aria-describedby]="hint() ? inputId() + '-hint' : null"
        [autoResize]="true"
        autocomplete="off"
        class="w-full"
      ></textarea>
      @if (hint()) {
        <small [id]="inputId() + '-hint'" class="field-hint">{{ hint() }}</small>
      }
    </div>
  `,
  styleUrl: './constraints-form.component.scss',
})
export class ConstraintsFormComponent {
  readonly inputId = input.required<string>();
  readonly label = input.required<string>();
  readonly placeholder = input('');
  readonly hint = input('');
  readonly rows = input(4);
  readonly control = input.required<FormControl<string>>();
}
