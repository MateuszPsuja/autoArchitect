import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TopbarComponent } from './topbar.component';
import { LAYOUT_MENU_SECTIONS } from '../layout-menu.model';

describe('TopbarComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TopbarComponent],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('removes legacy action icons from header', () => {
    const fixture = TestBed.createComponent(TopbarComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.pi-calendar')).toBeNull();
    expect(element.querySelector('.pi-inbox')).toBeNull();
    expect(element.querySelector('.pi-user')).toBeNull();
    expect(element.querySelector('.layout-menu-button')).toBeNull();
    expect(element.querySelector('.pi-bars')).toBeNull();
    expect(element.querySelector('.pi-key')).toBeNull();
    expect(element.querySelector('.layout-topbar-end')).toBeNull();
  });

  it('renders the full menu navigation in the header', () => {
    const fixture = TestBed.createComponent(TopbarComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const navItems = element.querySelectorAll('.topbar-nav-item');

    expect(navItems.length).toBe(7);
    expect(element.textContent).toContain('Planner');
    expect(element.textContent).toContain('Editor');
    expect(element.textContent).toContain('Export');
    expect(element.textContent).toContain('Import');
    expect(element.textContent).toContain('Plans');
    expect(element.textContent).toContain('Agents');
    expect(element.textContent).toContain('Config');
  });

  it('renders one anchor per menu entry in LAYOUT_MENU_SECTIONS', () => {
    const fixture = TestBed.createComponent(TopbarComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    const expectedCount = LAYOUT_MENU_SECTIONS.flatMap((s) => s.items).length;
    const navItems = element.querySelectorAll('.topbar-nav-item');
    expect(navItems.length).toBe(expectedCount);

    const expectedRoutes = LAYOUT_MENU_SECTIONS.flatMap((s) =>
      s.items.map((i) => i.route),
    );
    const renderedRoutes = Array.from(navItems).map(
      (a) => (a as HTMLAnchorElement).getAttribute('ng-reflect-router-link') ??
        (a as HTMLAnchorElement).getAttribute('href') ??
        '',
    );
    for (const route of expectedRoutes) {
      expect(renderedRoutes.some((r) => r.includes(route))).toBe(true);
    }
  });

  it('does not render provider selection, forget-keys, or logout UI elements', () => {
    const fixture = TestBed.createComponent(TopbarComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.provider-menu')).toBeNull();
    expect(element.querySelector('.forget-keys')).toBeNull();
    expect(element.querySelector('.logout')).toBeNull();
    expect(element.querySelector('button')).toBeNull();
  });
});
