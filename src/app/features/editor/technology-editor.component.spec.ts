import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { ProjectStore } from '../../core/project.store';
import { Plan } from '../../core/plan.schema';
import { minimalPlanFixture } from '../../testing/fixtures';
import { TechnologyEditorComponent } from './technology-editor.component';

describe('TechnologyEditorComponent', () => {
  function setup(
    plan: Plan = minimalPlanFixture,
    lastGeneratedPlanRef: Plan | null = plan,
  ) {
    const planSig = signal<Plan | null>(plan);
    const lastGeneratedPlanRefSig = signal<Plan | null>(lastGeneratedPlanRef);
    const hasUserChangesSig = signal(false);

    const mergeTechnologyOverride = vi.fn(
      (layers: Array<{ id: string; techStack: string[] }>, hints: string) => {
        if (!planSig()) return;
        const next: Plan = {
          ...planSig()!,
          architectureLayers: planSig()!.architectureLayers.map((layer) => {
            const override = layers.find((l) => l.id === layer.id);
            return override ? { ...layer, techStack: override.techStack } : layer;
          }),
          meta: { ...planSig()!.meta, technologyHints: hints },
        };
        planSig.set(next);
        hasUserChangesSig.set(true);
      },
    );

    const store = {
      plan: planSig,
      lastGeneratedPlanRef: lastGeneratedPlanRefSig,
      hasUserChanges: hasUserChangesSig,
      mergeTechnologyOverride,
    };

    TestBed.configureTestingModule({
      imports: [TechnologyEditorComponent],
      providers: [{ provide: ProjectStore, useValue: store }],
    });

    const fixture = TestBed.createComponent(TechnologyEditorComponent);
    fixture.detectChanges();
    return { fixture, store, planSig, mergeTechnologyOverride };
  }

  it('renders one textarea per architecture layer', () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;
    const ids = minimalPlanFixture.architectureLayers.map((l) => l.id);
    for (const id of ids) {
      expect(root.querySelector(`[data-testid="tech-stack-${id}"]`)).not.toBeNull();
    }
  });

  it('writes through to mergeTechnologyOverride on stack change', () => {
    const { fixture, store, mergeTechnologyOverride } = setup();
    const root = fixture.nativeElement as HTMLElement;
    const textarea = root.querySelector(
      '[data-testid="tech-stack-backend"]',
    ) as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();

    textarea.value = 'NestJS 11\nPostgres 16';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(mergeTechnologyOverride).toHaveBeenCalled();
    const lastCall =
      mergeTechnologyOverride.mock.calls[mergeTechnologyOverride.mock.calls.length - 1];
    const layersArg = lastCall[0] as Array<{ id: string; techStack: string[] }>;
    const backend = layersArg.find((l) => l.id === 'backend');
    expect(backend?.techStack).toEqual(['NestJS 11', 'Postgres 16']);
    expect(store.plan()!.architectureLayers.find((l) => l.id === 'backend')!.techStack).toEqual([
      'NestJS 11',
      'Postgres 16',
    ]);
  });

  it('flips hasUserChanges when a tech stack is edited', () => {
    const { fixture, store } = setup();
    expect(store.hasUserChanges()).toBe(false);
    const root = fixture.nativeElement as HTMLElement;
    const textarea = root.querySelector(
      '[data-testid="tech-stack-backend"]',
    ) as HTMLTextAreaElement;
    textarea.value = 'Fastify\nPostgreSQL 15';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(store.hasUserChanges()).toBe(true);
  });

  it('hides the Regenerate hint when no technology content has changed', () => {
    const { fixture } = setup();
    expect(fixture.componentInstance['regenerateHint']()).toBe('');
  });

  it('shows the Regenerate hint when a tech stack differs from the baseline', () => {
    const baseline: Plan = {
      ...minimalPlanFixture,
      architectureLayers: minimalPlanFixture.architectureLayers.map((layer) =>
        layer.id === 'backend'
          ? { ...layer, techStack: ['NestJS 10', 'PostgreSQL 15'] }
          : layer,
      ),
    };
    const plan: Plan = {
      ...minimalPlanFixture,
      architectureLayers: minimalPlanFixture.architectureLayers.map((layer) =>
        layer.id === 'backend' ? { ...layer, techStack: ['Fastify', 'PostgreSQL 15'] } : layer,
      ),
    };
    const { fixture } = setup(plan, baseline);
    expect(fixture.componentInstance['regenerateHint']()).toContain('Click Regenerate');
  });

  it('shows the Regenerate hint when technologyHints differs from the baseline', () => {
    const baseline: Plan = {
      ...minimalPlanFixture,
      meta: { ...minimalPlanFixture.meta, technologyHints: '' },
    };
    const plan: Plan = {
      ...minimalPlanFixture,
      meta: { ...minimalPlanFixture.meta, technologyHints: 'team prefers Postgres' },
    };
    const { fixture } = setup(plan, baseline);
    expect(fixture.componentInstance['regenerateHint']()).toContain('Click Regenerate');
  });

  it('hides the Regenerate hint when only an unrelated change flipped hasUserChanges', () => {
    const { fixture, store } = setup();
    expect(fixture.componentInstance['regenerateHint']()).toBe('');
    store.hasUserChanges.set(true);
    fixture.detectChanges();
    expect(fixture.componentInstance['regenerateHint']()).toBe('');
  });

  it('hides the Regenerate hint when no baseline plan exists', () => {
    const plan: Plan = {
      ...minimalPlanFixture,
      meta: { ...minimalPlanFixture.meta, technologyHints: 'changed' },
    };
    const { fixture } = setup(plan, null);
    expect(fixture.componentInstance['regenerateHint']()).toBe('');
  });

  it('writes the free-form hints textarea to mergeTechnologyOverride', () => {
    const { fixture, mergeTechnologyOverride } = setup();
    const root = fixture.nativeElement as HTMLElement;
    const textarea = root.querySelector(
      '[data-testid="technology-hints-textarea"]',
    ) as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();

    textarea.value = 'team prefers TypeORM';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const lastCall =
      mergeTechnologyOverride.mock.calls[mergeTechnologyOverride.mock.calls.length - 1];
    expect(lastCall[1]).toBe('team prefers TypeORM');
  });

  it('seeds hintsText from plan.meta.technologyHints on first paint', async () => {
    const plan: Plan = {
      ...minimalPlanFixture,
      meta: { ...minimalPlanFixture.meta, technologyHints: 'persisted hint' },
    };
    const { fixture } = setup(plan);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const textarea = root.querySelector(
      '[data-testid="technology-hints-textarea"]',
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe('persisted hint');
  });

  it('shows an empty-state message when the plan has no layers', () => {
    const emptyPlan: Plan = {
      ...minimalPlanFixture,
      architectureLayers: [],
    };
    const { fixture } = setup(emptyPlan as unknown as Plan);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('no architecture layers yet');
  });
});