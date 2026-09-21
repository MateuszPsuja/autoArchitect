import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LayoutService {
  readonly sidebarCollapsed = signal<boolean>(false);
  readonly mobileMenuActive = signal<boolean>(false);

  isDesktop(): boolean {
    return window.innerWidth > 991;
  }

  onMenuToggle(): void {
    if (this.isDesktop()) {
      this.sidebarCollapsed.update((v) => !v);
    } else {
      this.mobileMenuActive.update((v) => !v);
    }
  }

  closeMobileMenu(): void {
    this.mobileMenuActive.set(false);
  }
}
