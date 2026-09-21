import { Routes } from '@angular/router';
import { LayoutComponent } from './layout/layout.component';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'planner',
  },
  {
    path: '',
    component: LayoutComponent,
    children: [
      {
        path: 'planner',
        data: { showPlanBar: true },
        loadComponent: () =>
          import('./features/planner/planner-workspace.component').then(
            (m: any) => m.PlannerWorkspaceComponent,
          ),
      },
      {
        path: 'editor',
        data: { showPlanBar: true },
        loadComponent: () =>
          import('./features/editor/editor-workspace.component').then(
            (m: any) => m.EditorWorkspaceComponent,
          ),
      },
      {
        path: 'viewer',
        redirectTo: '/editor',
      },
      {
        path: 'export',
        data: { showPlanBar: true },
        loadComponent: () =>
          import('./features/export/export-workspace.component').then(
            (m: any) => m.ExportWorkspaceComponent,
          ),
      },
      {
        path: 'import',
        data: { showPlanBar: true },
        loadComponent: () =>
          import('./features/import/import-workspace.component').then(
            (m: any) => m.ImportWorkspaceComponent,
          ),
      },
      {
        path: 'config',
        data: { showPlanBar: false },
        loadComponent: () =>
          import('./features/config-page/config-page.component').then(
            (m: any) => m.ConfigPageComponent,
          ),
      },
      {
        path: 'plans',
        data: { showPlanBar: true },
        loadComponent: () =>
          import('./features/saved-plans/saved-plans.component').then(
            (m: any) => m.SavedPlansComponent,
          ),
      },
      {
        path: 'agents',
        data: { showPlanBar: false },
        loadComponent: () =>
          import('./features/agents/agents.component').then(
            (m: any) => m.AgentsComponent,
          ),
      },
      {
        path: 'agents/:id',
        data: { showPlanBar: false },
        loadComponent: () =>
          import('./features/agents/agent-detail.component').then(
            (m: any) => m.AgentDetailComponent,
          ),
      },
    ],
  },
  {
    path: '**',
    redirectTo: 'planner',
  },
];
