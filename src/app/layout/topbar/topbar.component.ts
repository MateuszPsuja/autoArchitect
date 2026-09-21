import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { LAYOUT_MENU_SECTIONS } from '../layout-menu.model';

@Component({
  selector: 'app-topbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <div class="layout-topbar">
      <div class="layout-topbar-start">
        <a class="layout-topbar-brand" routerLink="/planner" aria-label="Go to Planner">
          <i class="pi pi-compass brand-icon"></i>
          <span class="brand-name"> <span class="brand-accent">Auto</span> Architect </span>
        </a>
      </div>

      <nav class="layout-topbar-nav" aria-label="Primary navigation">
        <ul class="topbar-nav-items">
          @for (section of menuSections; track section.label) {
            @for (item of section.items; track item.route) {
              <li>
                <a
                  class="topbar-nav-item"
                  [routerLink]="item.route"
                  routerLinkActive="active-route"
                >
                  <i [class]="'pi ' + item.icon" aria-hidden="true"></i>
                  <span>{{ item.label }}</span>
                </a>
              </li>
            }
          }
        </ul>
      </nav>
    </div>
  `,
  styleUrl: './topbar.component.scss',
})
export class TopbarComponent {
  protected readonly menuSections = LAYOUT_MENU_SECTIONS;
}
