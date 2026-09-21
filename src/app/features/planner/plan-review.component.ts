import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TabsModule } from 'primeng/tabs';
import { ArchitectureTreeComponent } from '../diagrams/architecture-tree.component';
import { PlanEditorComponent } from '../editor/plan-editor.component';
import { TechnologyEditorComponent } from '../editor/technology-editor.component';
import { RefineWithAiComponent } from '../editor/refine-with-ai/refine-with-ai.component';
import { PlanFieldsEditorComponent } from './plan-fields-editor.component';

@Component({
  selector: 'app-plan-review',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TabsModule,
    ArchitectureTreeComponent,
    PlanEditorComponent,
    PlanFieldsEditorComponent,
    TechnologyEditorComponent,
    RefineWithAiComponent,
  ],
  template: `
    <p-tabs [value]="0">
      <p-tablist>
        <p-tab [value]="0">Plan Fields</p-tab>
        <p-tab [value]="1">Technology</p-tab>
        <p-tab [value]="2">Docs</p-tab>
        <p-tab [value]="3">Architecture</p-tab>
        <p-tab [value]="4">Refine with AI</p-tab>
      </p-tablist>
      <p-tabpanels>
        <p-tabpanel [value]="0">
          <div class="review-pane">
            <app-plan-fields-editor />
          </div>
        </p-tabpanel>
        <p-tabpanel [value]="1">
          <div class="review-pane">
            <app-technology-editor />
          </div>
        </p-tabpanel>
        <p-tabpanel [value]="2">
          <div class="review-pane">
            <app-plan-editor />
          </div>
        </p-tabpanel>
        <p-tabpanel [value]="3">
          <div class="review-pane">
            <app-architecture-tree />
          </div>
        </p-tabpanel>
        <p-tabpanel [value]="4">
          <div class="review-pane">
            <app-refine-with-ai />
          </div>
        </p-tabpanel>
      </p-tabpanels>
    </p-tabs>
  `,
  styles: `
    /* Tab chrome (background, border, padding, hover/active state,
       flush tab items) is declared globally in styles.scss and shared
       with the nested sub-tabs in ArchitectureTreeComponent.  This
       styles block only carries layout choices that are unique to the
       outer 5-tab strip. */

    .review-pane {
      display: grid;
      gap: 1.5rem;
      padding-top: 1rem;
      min-height: 0;
    }
  `,
})
export class PlanReviewComponent {}