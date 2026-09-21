import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { Confirmation, ConfirmationService } from 'primeng/api';
import { ProjectStore } from '../../../core/project.store';
import { PlanSchemaService } from '../../../core/plan-schema.service';
import { minimalPlanFixture } from '../../../testing/fixtures';
import { ImportJsonComponent } from './import-json.component';

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

function setup(options: {
  hasUserChanges?: boolean;
  confirmShouldFire?: boolean;
} = {}) {
  const currentPlan = minimalPlanFixture;
  const baselinePlan = options.hasUserChanges
    ? { ...minimalPlanFixture, meta: { ...minimalPlanFixture.meta, title: 'Baseline' } }
    : null;
  const planSig = signal<typeof minimalPlanFixture | null>(
    options.hasUserChanges ? currentPlan : null,
  );
  const lastGeneratedSig = signal<typeof minimalPlanFixture | null>(
    options.hasUserChanges ? baselinePlan : null,
  );
  const overridesSig = signal<Record<string, string>>({});

  const setPlan = vi.fn();
  const snapshotGeneration = vi.fn();
  const navigate = vi.fn();

  const store = {
    plan: planSig,
    lastGeneratedPlanRef: lastGeneratedSig,
    markdownOverrides: overridesSig,
    hasUserChanges: () => {
      const plan = planSig();
      const baseline = lastGeneratedSig();
      if (!plan || !baseline) return false;
      if (plan !== baseline) return true;
      return Object.keys(overridesSig()).length > 0;
    },
    setPlan,
    snapshotGeneration,
  };

  const confirmCalls: Confirmation[] = [];
  let nextAcceptShouldFire = options.confirmShouldFire ?? true;
  const confirmation = new ConfirmationService();
  vi.spyOn(confirmation, 'confirm').mockImplementation((call: Confirmation) => {
    confirmCalls.push(call);
    if (nextAcceptShouldFire) {
      call.accept?.();
    }
    return confirmation;
  });

  TestBed.configureTestingModule({
    imports: [ImportJsonComponent],
    providers: [
      { provide: ProjectStore, useValue: store },
      { provide: ConfirmationService, useValue: confirmation },
      provideRouter([]),
    ],
  })
    .overrideComponent(ImportJsonComponent, {
      remove: { providers: [ConfirmationService] },
    });

  const fixture = TestBed.createComponent(ImportJsonComponent);
  fixture.detectChanges();

  const router = TestBed.inject(Router);
  vi.spyOn(router, 'navigate').mockImplementation(navigate);

  return {
    fixture,
    component: fixture.componentInstance as unknown as ImportJsonComponent,
    store,
    confirmation,
    confirmCalls,
    setAcceptFires: (value: boolean) => {
      nextAcceptShouldFire = value;
    },
    navigate,
  };
}

describe('ImportJsonComponent', () => {
  it('renders the file picker and heading only — no paste textarea or action buttons', () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('p-fileupload')).not.toBeNull();
    expect(root.querySelector('#import-json-heading')?.textContent).toContain('JSON');
    expect(root.querySelector('textarea')).toBeNull();
    expect(root.querySelector('.or')).toBeNull();
    expect(root.textContent).not.toContain('Import plan');
    expect(root.textContent).not.toContain('Clear');
  });

  it('rejects files over the size limit via onFileSelected and surfaces an error', () => {
    const { fixture, component } = setup();
    const oversized = { size: 2_000_001, name: 'plan.json' } as unknown as File;

    component['onFileSelected']({ files: [oversized], currentFiles: [oversized] });
    fixture.detectChanges();

    expect(component['errorMessage']()).toContain('byte limit');
  });

  it('surfaces a parse error and does not call setPlan when JSON is invalid', () => {
    const { component, store } = setup();

    component['importFromText']('{not json');

    expect(component['errorMessage']()).toContain('not valid JSON');
    expect(store.setPlan).not.toHaveBeenCalled();
    expect(store.snapshotGeneration).not.toHaveBeenCalled();
  });

  it('surfaces a schema-validation error when JSON is valid but not a Plan', () => {
    const { component, store } = setup();

    component['importFromText'](JSON.stringify({ hello: 'world' }));

    expect(component['errorMessage']()).toBe('File is not a valid Plan artefact.');
    expect(store.setPlan).not.toHaveBeenCalled();
    expect(store.snapshotGeneration).not.toHaveBeenCalled();
  });

  it('imports a valid plan and navigates to /planner when there are no unsaved changes', () => {
    const { component, store, navigate, confirmation } = setup();

    component['importFromText'](JSON.stringify(minimalPlanFixture));

    expect(confirmation.confirm).not.toHaveBeenCalled();
    expect(store.setPlan).toHaveBeenCalledTimes(1);
    expect(store.snapshotGeneration).toHaveBeenCalledTimes(1);
    expect(component['errorMessage']()).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/planner']);
  });

  it('opens a confirm dialog before importing when hasUserChanges is true', () => {
    const { component, confirmation, confirmCalls } = setup({ hasUserChanges: true });

    component['importFromText'](JSON.stringify(minimalPlanFixture));

    expect(confirmation.confirm).toHaveBeenCalledTimes(1);
    expect(confirmCalls[0].header).toBe('Replace the active plan?');
  });

  it('does not import when the user rejects the confirm dialog', () => {
    const { component, store, confirmation, setAcceptFires } = setup({
      hasUserChanges: true,
      confirmShouldFire: false,
    });

    setAcceptFires(false);
    component['importFromText'](JSON.stringify(minimalPlanFixture));

    expect(confirmation.confirm).toHaveBeenCalledTimes(1);
    expect(store.setPlan).not.toHaveBeenCalled();
    expect(store.snapshotGeneration).not.toHaveBeenCalled();
  });

  it('accept button calls setPlan, snapshotGeneration and navigates', () => {
    const { component, store, navigate } = setup({ hasUserChanges: true });

    component['importFromText'](JSON.stringify(minimalPlanFixture));

    expect(store.setPlan).toHaveBeenCalledTimes(1);
    expect(store.snapshotGeneration).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/planner']);
  });

  it('reuses PlanSchemaService.isPlan for validation', () => {
    expect(PlanSchemaService.isPlan(minimalPlanFixture)).toBe(true);
    expect(PlanSchemaService.isPlan({ meta: {} })).toBe(false);
  });

  it('forwards embedded meta.tokenStats as the second arg to setPlan', () => {
    const { component, store } = setup();
    const embedded = {
      promptTokens: 5,
      completionTokens: 7,
      totalTokens: 12,
      model: 'openai/gpt-4o-mini',
      generatedAt: '2026-01-01T00:00:00.000Z',
    };
    const withStats = {
      ...minimalPlanFixture,
      meta: { ...minimalPlanFixture.meta, tokenStats: embedded },
    };

    component['importFromText'](JSON.stringify(withStats));

    expect(store.setPlan).toHaveBeenCalledTimes(1);
    const args = (store.setPlan as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(args[1]).toEqual(embedded);
  });

  it('passes null to setPlan when the imported plan has no tokenStats', () => {
    const { component, store } = setup();

    component['importFromText'](JSON.stringify(minimalPlanFixture));

    expect(store.setPlan).toHaveBeenCalledTimes(1);
    const args = (store.setPlan as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(args[1]).toBeNull();
  });
});