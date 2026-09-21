import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ProjectStore } from '../../core/project.store';
import { Plan } from '../../core/plan.schema';
import { ImportWorkspaceComponent } from './import-workspace.component';

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

describe('ImportWorkspaceComponent', () => {
  function setup(plan: Plan | null = null) {
    const planSig = signal(plan);

    const store = {
      plan: planSig,
    };

    TestBed.configureTestingModule({
      imports: [ImportWorkspaceComponent],
      providers: [{ provide: ProjectStore, useValue: store }],
    });

    const fixture = TestBed.createComponent(ImportWorkspaceComponent);
    fixture.detectChanges();

    return { fixture, store };
  }

  it('renders the import heading and child panel', () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;

    const heading = root.querySelector('h2');
    expect(heading?.textContent).toContain('Import');

    const child = root.querySelector('app-import-json');
    expect(child).not.toBeNull();
  });

  it('renders the card even when there is no active plan', () => {
    const { fixture } = setup(null);
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('app-import-json')).not.toBeNull();
    expect(root.querySelector('p-message')).toBeNull();
  });
});