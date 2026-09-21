import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { LAYOUT_MENU_SECTIONS } from '../layout-menu.model';
import { LayoutService } from '../layout.service';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <div class="layout-sidebar">
      <nav class="layout-menu" aria-label="Main navigation">
        <ul>
          @for (section of menuSections; track section.label) {
            <li>
              <span class="menu-section-label">{{ section.label }}</span>
              <ul>
                @for (item of section.items; track item.route) {
                  <li>
                    <a
                      class="menu-item"
                      [routerLink]="item.route"
                      routerLinkActive="active-route"
                      (click)="onItemClick()"
                    >
                      <i [class]="'pi ' + item.icon"></i>
                      <span class="menu-label">{{ item.label }}</span>
                    </a>
                  </li>
                }
              </ul>
            </li>
          }
        </ul>
      </nav>
    </div>
  `,
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent {
  protected readonly layoutService = inject(LayoutService);

  protected readonly menuSections = LAYOUT_MENU_SECTIONS;

  protected onItemClick(): void {
    if (!this.layoutService.isDesktop()) {
      this.layoutService.closeMobileMenu();
    }
  }
}
