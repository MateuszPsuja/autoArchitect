import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { PlanReviewComponent } from './plan-review.component';

if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === 'undefined') {
  (globalThis as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

describe('PlanReviewComponent', () => {
  function setup() {
    TestBed.configureTestingModule({
      imports: [PlanReviewComponent],
    });
    const fixture = TestBed.createComponent(PlanReviewComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    return { fixture, root };
  }

  it('instantiates without errors and mounts all five tab children', () => {
    const { fixture } = setup();
    expect(fixture.componentInstance).toBeInstanceOf(PlanReviewComponent);
  });

  it('renders the five expected tab labels in order', () => {
    const { root } = setup();
    const tabs = Array.from(root.querySelectorAll('[role="tab"], p-tab'));
    const labels = tabs
      .map((t) => (t.textContent ?? '').trim())
      .filter((s) => s.length > 0);
    expect(labels).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Plan Fields'),
        expect.stringContaining('Technology'),
        expect.stringContaining('Docs'),
        expect.stringContaining('Architecture'),
        expect.stringContaining('Refine with AI'),
      ]),
    );
  });

  it('mounts one child component per tab panel', () => {
    const { root } = setup();
    expect(root.querySelector('app-plan-fields-editor')).not.toBeNull();
    expect(root.querySelector('app-technology-editor')).not.toBeNull();
    expect(root.querySelector('app-plan-editor')).not.toBeNull();
    expect(root.querySelector('app-architecture-tree')).not.toBeNull();
    expect(root.querySelector('app-refine-with-ai')).not.toBeNull();
  });
});