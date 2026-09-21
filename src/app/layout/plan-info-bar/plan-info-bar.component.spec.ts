import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { ProjectStore } from '../../core/project.store';
import { PlanInfoBarComponent } from './plan-info-bar.component';

function setup(plan: any) {
  const planSig = signal(plan);
  const modifiedSig = signal(0);
  const closePlan = vi.fn();

  const store = {
    plan: planSig,
    hasPlan: signal(plan !== null),
    modifiedFilesCount: modifiedSig,
    closePlan,
  };

  TestBed.configureTestingModule({
    imports: [PlanInfoBarComponent],
    providers: [{ provide: ProjectStore, useValue: store }],
  });

  const fixture = TestBed.createComponent(PlanInfoBarComponent);
  fixture.detectChanges();

  return { fixture, store, closePlan };
}

describe('PlanInfoBarComponent', () => {
  it('renders nothing when no plan is opened', () => {
    const { fixture } = setup(null);
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('.plan-info-header')).toBeNull();
    expect(root.textContent).not.toContain('Currently opened plan');
    expect(root.textContent).not.toContain('No plan opened');
  });

  it('shows the active plan details when a plan is opened', () => {
    const { fixture, store } = setup({
      meta: {
        title: 'Planner App',
        summary: '',
        model: 'openai/gpt-4o',
        generatedAt: '2026-07-20T12:00:00Z',
        featureNumber: 1,
        featureSlug: 'planner-app',
      },
    });
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('.plan-info-header')).not.toBeNull();
    expect(root.textContent).toContain('Currently opened plan');
    expect(root.textContent).toContain('Planner App');
    expect(root.textContent).toContain('openai/gpt-4o');

    const closeButton = root.querySelector(
      'p-button button, .p-button',
    ) as HTMLButtonElement | null;
    expect(closeButton).not.toBeNull();
    closeButton?.click();
    expect(store.closePlan).toHaveBeenCalled();
  });
});