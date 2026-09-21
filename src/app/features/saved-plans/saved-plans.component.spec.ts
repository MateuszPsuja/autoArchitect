import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { ProjectStore } from '../../core/project.store';
import { SavedPlanEntry } from '../../core/saved-plan-entry.model';
import { MICROBLOG_DEMO_PLAN } from '../../core/demo-plan/microblog.plan';
import { minimalPlanFixture } from '../../testing/fixtures';
import { SavedPlansComponent } from './saved-plans.component';

describe('SavedPlansComponent', () => {
  function setup(entries: SavedPlanEntry[]) {
    const savedPlans = signal(entries);
    const loadSavedPlan = vi.fn();
    const deleteSavedPlan = vi.fn();

    const store = {
      savedPlans,
      loadSavedPlan,
      deleteSavedPlan,
    };

    TestBed.configureTestingModule({
      imports: [SavedPlansComponent],
      providers: [{ provide: ProjectStore, useValue: store }],
    });

    const fixture = TestBed.createComponent(SavedPlansComponent);
    fixture.detectChanges();

    return { fixture, store };
  }

  function demoEntry(): SavedPlanEntry {
    return {
      id: 'demo:microblog',
      title: MICROBLOG_DEMO_PLAN.meta.title,
      savedAt: MICROBLOG_DEMO_PLAN.meta.generatedAt,
      model: 'demo-seed',
      tokenStats: null,
      plan: MICROBLOG_DEMO_PLAN,
    };
  }

  function normalEntry(): SavedPlanEntry {
    return {
      id: 'user:custom',
      title: 'My Custom Plan',
      savedAt: '2026-01-01T00:00:00.000Z',
      model: 'openai/gpt-4o-mini',
      tokenStats: null,
      plan: minimalPlanFixture,
    };
  }

  function findRow(root: HTMLElement, title: string): HTMLTableRowElement | null {
    const rows = Array.from(root.querySelectorAll<HTMLTableRowElement>('tbody tr'));
    return rows.find((row) => row.textContent?.includes(title) ?? false) ?? null;
  }

  function actionsCell(row: HTMLTableRowElement): HTMLElement | null {
    const cells = Array.from(row.querySelectorAll('td'));
    return cells[cells.length - 1] ?? null;
  }

  function demoButton(cell: HTMLElement): HTMLButtonElement | null {
    return cell.querySelector<HTMLButtonElement>('button[disabled]');
  }

  function loadButton(cell: HTMLElement): HTMLButtonElement | null {
    return cell.querySelector<HTMLButtonElement>('button:not([disabled])');
  }

  it('renders the Demo badge and hides the trash button on the demo row', () => {
    const { fixture } = setup([demoEntry()]);
    const root = fixture.nativeElement as HTMLElement;

    const row = findRow(root, MICROBLOG_DEMO_PLAN.meta.title);
    expect(row).not.toBeNull();

    const cell = actionsCell(row!);
    expect(cell).not.toBeNull();
    const demo = demoButton(cell!);
    expect(demo).not.toBeNull();
    expect(demo!.textContent?.trim()).toContain('Demo');
    expect(demo!.querySelector('.pi-folder-open')).not.toBeNull();
    expect(cell!.querySelector('.pi-trash')).toBeNull();
  });

  it('renders the trash button and no Demo badge on a normal row', () => {
    const { fixture } = setup([normalEntry()]);
    const root = fixture.nativeElement as HTMLElement;

    const row = findRow(root, 'My Custom Plan');
    expect(row).not.toBeNull();

    const cell = actionsCell(row!);
    expect(cell).not.toBeNull();
    expect(demoButton(cell!)).toBeNull();
    expect(cell!.querySelector('.pi-trash')).not.toBeNull();
  });

  it('treats a plan whose meta.generatedAt has drifted away from the demo fingerprint as a normal row', () => {
    const drifted: SavedPlanEntry = {
      ...demoEntry(),
      plan: {
        ...MICROBLOG_DEMO_PLAN,
        meta: {
          ...MICROBLOG_DEMO_PLAN.meta,
          generatedAt: '2026-09-01T00:00:00.000Z',
        },
      },
    };
    const { fixture } = setup([drifted]);
    const root = fixture.nativeElement as HTMLElement;

    const row = findRow(root, MICROBLOG_DEMO_PLAN.meta.title);
    const cell = actionsCell(row!);
    expect(demoButton(cell!)).toBeNull();
    expect(cell!.querySelector('.pi-trash')).not.toBeNull();
  });

  it('invokes loadSavedPlan when the load button on the demo row is clicked', () => {
    const { fixture, store } = setup([demoEntry(), normalEntry()]);
    const root = fixture.nativeElement as HTMLElement;

    const row = findRow(root, MICROBLOG_DEMO_PLAN.meta.title);
    const cell = actionsCell(row!);
    const button = loadButton(cell!);
    expect(button).not.toBeNull();
    expect(button!.querySelector('.pi-folder-open')).not.toBeNull();
    button!.dispatchEvent(new Event('click', { bubbles: true }));
    fixture.detectChanges();

    expect(store.loadSavedPlan).toHaveBeenCalledWith('demo:microblog');
  });
});
