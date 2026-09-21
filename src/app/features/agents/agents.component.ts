import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { AgentsStore } from '../../core/agents.store';

@Component({
  selector: 'app-agents',
  standalone: true,
  imports: [CommonModule, TableModule, TagModule, ButtonModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card">
      <div class="header-container mb-4">
        <h2>Agents</h2>
        <span class="text-muted">Available system agents and their capabilities.</span>
      </div>
      <p-table [value]="store.agents()" responsiveLayout="scroll" dataKey="id" styleClass="p-datatable-striped">
        <ng-template pTemplate="header" let-columns>
          <tr>
            <th pSortableColumn="name">Name <p-sortIcon field="name"></p-sortIcon></th>
            <th>Description</th>
            <th>Skills</th>
            <th style="min-width:140px; text-align:right">Actions</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-agent>
          <tr>
            <td style="font-weight: 600;">{{ agent.name }}</td>
            <td style="color: var(--text-color-secondary);">{{ agent.description }}</td>
            <td>
              <p-tag *ngFor="let skill of agent.skills" [value]="skill.name" severity="secondary" styleClass="mr-2 mb-2"></p-tag>
            </td>
            <td style="text-align:right;">
              <p-button
                icon="pi pi-arrow-right"
                label="Open"
                [outlined]="true"
                severity="secondary"
                [routerLink]="['/agents', agent.id]"
              />
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="4" class="text-center p-4">No agents found.</td>
          </tr>
        </ng-template>
      </p-table>
    </div>
  `,
  styles: [`
    .mb-4 {
      margin-bottom: 1.5rem;
    }
    .mb-2 {
      margin-bottom: 0.5rem;
    }
    .mr-2 {
      margin-right: 0.5rem;
    }
    .text-center {
      text-align: center;
    }
    .p-4 {
      padding: 1.5rem;
    }
    
    /* Ensure tags space out nicely */
    ::ng-deep .p-tag {
      margin-right: 0.5rem;
      margin-bottom: 0.25rem;
    }

    h2 {
      margin: 0 0 0.25rem 0;
      font-size: 1.25rem;
    }
  `]
})
export class AgentsComponent {
  protected readonly store = inject(AgentsStore);
}
