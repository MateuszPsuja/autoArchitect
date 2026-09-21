import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { ProjectStore } from '../../core/project.store';
import { isDemoPlan } from '../../core/demo-plan/microblog.plan';

@Component({
  selector: 'app-saved-plans',
  standalone: true,
  imports: [CommonModule, TableModule, ButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card">
      <div class="header-container mb-4">
        <h2>Saved Plans</h2>
        <span class="text-muted">Manage and reload your architectural plans.</span>
      </div>

      <p-table 
        [value]="store.savedPlans()" 
        [paginator]="true" 
        [rows]="10" 
        responsiveLayout="scroll" 
        dataKey="id"
        styleClass="p-datatable-striped">
        
        <ng-template pTemplate="header">
          <tr>
            <th pSortableColumn="title" style="min-width:200px">Title <p-sortIcon field="title"></p-sortIcon></th>
            <th pSortableColumn="model">Model <p-sortIcon field="model"></p-sortIcon></th>
            <th pSortableColumn="savedAt">Date <p-sortIcon field="savedAt"></p-sortIcon></th>
            <th style="width: 180px; min-width: 180px; text-align:right">Actions</th>
          </tr>
        </ng-template>

        <ng-template pTemplate="body" let-plan>
          <tr>
            <td style="font-weight: 600;">{{ plan.title || 'Untitled Plan' }}</td>
            <td>
              <span class="text-muted text-sm border-badge">{{ plan.model || 'Unknown' }}</span>
            </td>
            <td class="text-muted text-sm">{{ plan.savedAt | date:'medium' }}</td>
            <td class="actions-cell">
              <p-button icon="pi pi-folder-open" title="Load Plan" severity="secondary" [outlined]="true" size="small" (onClick)="store.loadSavedPlan(plan.id)"></p-button>
              @if (!isDemoPlan(plan.plan)) {
                <p-button icon="pi pi-trash" title="Delete Plan" severity="danger" [outlined]="true" size="small" (onClick)="store.deleteSavedPlan(plan.id)"></p-button>
              } @else {
                <p-button icon="pi pi-folder-open" label="Demo" severity="secondary" [outlined]="true" [disabled]="true" title="Demo plan — cannot be deleted"></p-button>
              }
            </td>
          </tr>
        </ng-template>

        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="4" class="text-center p-4">No saved plans found.</td>
          </tr>
        </ng-template>
      </p-table>
    </div>
  `,
  styles: [`
    .mb-4 { margin-bottom: 1.5rem; }
    h2 { margin: 0 0 0.25rem 0; font-size: 1.25rem; }
    .text-center { text-align: center; }
    .p-4 { padding: 1.5rem; }
    .text-sm { font-size: 0.875rem; }
    .border-badge {
      display: inline-block;
      padding: 0.15rem 0.5rem;
      border: 1px solid var(--surface-border);
      border-radius: var(--radius-sm);
    }
    .actions-cell {
      display: inline-flex;
      gap: 0.5rem;
      align-items: center;
      justify-content: flex-end;
      width: 100%;
    }
  `]
})
export class SavedPlansComponent {
  protected readonly store = inject(ProjectStore);
  protected readonly isDemoPlan = isDemoPlan;
}
