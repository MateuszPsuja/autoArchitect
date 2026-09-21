import { Component, computed, inject } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs/operators';
import { toSignal } from '@angular/core/rxjs-interop';
import { ProjectStore } from '../core/project.store';
import { PlanInfoBarComponent } from './plan-info-bar/plan-info-bar.component';
import { TopbarComponent } from './topbar/topbar.component';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [RouterOutlet, TopbarComponent, PlanInfoBarComponent],
  template: `
    <a class="skip-link" href="#main-content">Skip to Content</a>

    <div class="layout-wrapper">
      <app-topbar />

      <div class="layout-main-container">
        <main class="layout-main" id="main-content">
          <section class="workspace-stack">
            @if (showPlanBar()) {
              <app-plan-info-bar />
            }
            <router-outlet />
          </section>
        </main>
      </div>
    </div>
  `,
  styleUrl: './layout.component.scss',
})
export class LayoutComponent {
  private readonly router = inject(Router);
  private readonly store = inject(ProjectStore);

  private readonly routeAllowsPlanBar = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(() => this.readShowPlanBarFlag()),
    ),
    { initialValue: this.readShowPlanBarFlag() },
  );

  protected readonly showPlanBar = computed(
    () => this.routeAllowsPlanBar() && this.store.hasPlan(),
  );

  private readShowPlanBarFlag(): boolean {
    let route = this.router.routerState.snapshot.root;
    while (route.firstChild) {
      route = route.firstChild;
    }
    return route.data['showPlanBar'] === true;
  }
}
