import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { ProjectStore, defaultProviderConfigs } from '../../core/project.store';
import { LLM_FACTORY } from '../../core/llm-provider';
import { ArchitectureTreeComponent } from './architecture-tree.component';
import { minimalPlanFixture } from '../../testing/fixtures';

if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as any).ResizeObserver = ResizeObserverStub;
}

describe('ArchitectureTreeComponent', () => {
  function setup() {
    const planSig = signal<any>(structuredClone(minimalPlanFixture));
    const configSig = signal({
      provider: 'openrouter',
      providerConfigs: {
        ...defaultProviderConfigs(),
        openrouter: {
          ...defaultProviderConfigs().openrouter,
          selectedModel: 'openai/gpt-4o-mini',
        },
      },
    });
    const apiKeySig = signal('sk-test');
    const markdownOverridesSig = signal<Record<string, string>>({});

    const store = {
      plan: planSig,
      config: configSig,
      apiKey: apiKeySig,
      markdownOverrides: markdownOverridesSig,
      tokenStats: signal<any>(null),
      synthesisedDiagramPatches: signal<Record<string, string>>({}),
      setError: vi.fn(),
      setPlan: vi.fn((p: any) => planSig.set(p)),
      clearMarkdownOverrides: vi.fn(),
      savePlan: vi.fn(),
    };

    const llmFactory = vi.fn(() => ({ invoke: vi.fn() }));

    TestBed.configureTestingModule({
      imports: [ArchitectureTreeComponent],
      providers: [
        { provide: ProjectStore, useValue: store },
        { provide: LLM_FACTORY, useValue: llmFactory },
      ],
    });

    const fixture = TestBed.createComponent(ArchitectureTreeComponent);
    fixture.detectChanges();

    return { fixture, component: fixture.componentInstance as any, store };
  }

  it('renders three sub-tabs labelled Blueprint, Tech Stack, Layers', () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;



    const labels = Array.from(root.querySelectorAll('[role="tab"]')).map(
      (el) => (el.textContent ?? '').trim(),
    );
    expect(labels).toEqual(['Blueprint', 'Tech Stack', 'Layers']);
  });

  it('defaults to the Blueprint sub-tab', () => {
    const { component } = setup();
    expect(component.activeSubTab()).toBe(0);
  });

  it('switches active sub-tab when onSubTabChange is called and clamps invalid values', () => {
    const { component, fixture } = setup();
    component.onSubTabChange(2);
    fixture.detectChanges();
    expect(component.activeSubTab()).toBe(2);

    component.onSubTabChange('not-a-number');
    fixture.detectChanges();
    expect(component.activeSubTab()).toBe(2);

    component.onSubTabChange(99);
    fixture.detectChanges();
    expect(component.activeSubTab()).toBe(2);

    component.onSubTabChange(3);
    fixture.detectChanges();
    expect(component.activeSubTab()).toBe(2);
  });

  it('renders the architecture blueprint diagram in the Blueprint panel', () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelectorAll('app-mermaid-preview').length).toBeGreaterThan(0);
    expect(root.querySelector('.arch-panel-header h3')?.textContent).toContain('Blueprint');
  });

  it('mounts a zoom-control overlay on every mermaid preview (zoom in/out/reset/fit)', () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;
    const previews = root.querySelectorAll('app-mermaid-preview');
    expect(previews.length).toBeGreaterThan(0);
    for (const host of Array.from(previews)) {
      const labels = Array.from(host.querySelectorAll('.zoom-controls button')).map(
        (b) => (b as HTMLButtonElement).getAttribute('aria-label'),
      );
      expect(labels).toEqual(
        expect.arrayContaining(['Zoom out', 'Reset zoom', 'Zoom in', 'Fit to frame']),
      );
    }
  });

  it('hides all diagram content when no plan is loaded', () => {
    const planSig = signal<any>(null);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ArchitectureTreeComponent],
      providers: [
        {
          provide: ProjectStore,
          useValue: {
            plan: planSig,
            config: signal({}),
            apiKey: signal(''),
            markdownOverrides: signal({}),
            tokenStats: signal(null),
            setError: vi.fn(),
            setPlan: vi.fn(),
            clearMarkdownOverrides: vi.fn(),
            savePlan: vi.fn(),
          },
        },
        { provide: LLM_FACTORY, useValue: vi.fn(() => ({ invoke: vi.fn() })) },
      ],
    });
    const fixture = TestBed.createComponent(ArchitectureTreeComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.empty')).toBeTruthy();
  });

  it('renders every console panel with title + caption (no eyebrow)', () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;



    const headers = Array.from(root.querySelectorAll('.arch-panel-header'));
    expect(headers.length).toBe(3);
    for (const header of headers) {
      expect(header.querySelector('h3')).toBeTruthy();
      expect(header.querySelector('.caption')).toBeTruthy();
      expect(header.querySelector('.eyebrow')).toBeNull();
    }
  });

  it('renders per-layer details cards (no named-diagram cards) with Inter typography', () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;



    const cards = root.querySelectorAll('.layer-details-card');
    expect(cards.length).toBeGreaterThan(0);
    expect(root.querySelector('.layer-diagram-card')).toBeNull();
    expect(root.querySelector('.layer-diagram-header')).toBeNull();



    const family = getComputedStyle(cards[0] as HTMLElement).fontFamily;
    expect(family.toLowerCase()).not.toContain('jetbrains');
  });
});
