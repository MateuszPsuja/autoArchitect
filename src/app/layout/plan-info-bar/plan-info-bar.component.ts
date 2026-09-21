import { Component, computed, inject } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { ProjectStore } from '../../core/project.store';

@Component({
  selector: 'app-plan-info-bar',
  standalone: true,
  imports: [ButtonModule],
  template: `
    @if (hasPlan()) {
      <section class="card plan-info-header">
        <span class="plan-info-eyebrow">Currently opened plan</span>
        <span class="plan-info-title">{{ title() }}</span>
        <span class="plan-info-sep">·</span>
        <span class="plan-info-meta"><i class="pi pi-microchip-ai" aria-hidden="true"></i> {{ model() }}</span>
        <span class="plan-info-sep">·</span>
        <span class="plan-info-meta"><i class="pi pi-calendar" aria-hidden="true"></i> {{ generatedAt() }}</span>
        @if (modifiedFilesCount() > 0) {
          <span class="plan-info-sep">·</span>
          <span class="plan-info-badge">
            <i class="pi pi-circle-fill" aria-hidden="true"></i>
            {{ modifiedFilesCount() }} unsaved
          </span>
        }
        <p-button class="ml-auto" label="Close plan" icon="pi pi-times" severity="secondary" [outlined]="true" (onClick)="closePlan()"></p-button>
      </section>
    }
  `,
  styleUrl: './plan-info-bar.component.scss',
})
export class PlanInfoBarComponent {
  private readonly store = inject(ProjectStore);

  protected readonly hasPlan = this.store.hasPlan;
  protected readonly modifiedFilesCount = this.store.modifiedFilesCount;

  protected readonly title = computed(() => this.store.plan()?.meta.title ?? '');
  protected readonly summary = computed(() => this.store.plan()?.meta.summary ?? '');
  protected readonly model = computed(() => this.store.plan()?.meta.model ?? '');
  protected readonly generatedAt = computed(() => {
    const raw = this.store.plan()?.meta.generatedAt;
    if (!raw) {
      return '';
    }
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? raw : date.toLocaleString();
  });

  protected closePlan(): void {
    this.store.closePlan();
  }
}
