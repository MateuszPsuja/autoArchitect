import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ProjectStore, defaultProviderConfigs } from '../../core/project.store';
import { Plan } from '../../core/plan.schema';
import { minimalPlanFixture } from '../../testing/fixtures';
import { ExportWorkspaceComponent } from './export-workspace.component';

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

describe('ExportWorkspaceComponent', () => {
  function setup(plan: Plan | null = minimalPlanFixture) {
    const planSig = signal(plan);
    const overridesSig = signal<Record<string, string>>({});
    const providerConfigs = {
      ...defaultProviderConfigs(),
      openrouter: {
        ...defaultProviderConfigs().openrouter,
        selectedModel: 'openai/gpt-4o-mini',
      },
    };
    const configSig = signal({
      provider: 'openrouter' as const,
      providerConfigs,
    });
    const apiKeySig = signal('sk-test');
    const isGeneratingSig = signal(false);
    const pdfTokenStatsSig = signal<unknown>(null);

    const store = {
      plan: planSig,
      markdownOverrides: overridesSig,
      config: configSig,
      apiKey: apiKeySig,
      isGenerating: isGeneratingSig,
      pdfTokenStats: pdfTokenStatsSig,



      derivedFiles: () => [],
    };

    TestBed.configureTestingModule({
      imports: [ExportWorkspaceComponent],
      providers: [{ provide: ProjectStore, useValue: store }],
    });

    const fixture = TestBed.createComponent(ExportWorkspaceComponent);
    fixture.detectChanges();

    return { fixture, store };
  }

  it('renders the empty state when there is no plan', () => {
    const { fixture } = setup(null);
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('app-export-zip')).toBeNull();
    expect(root.querySelector('app-export-json')).toBeNull();
    expect(root.querySelector('app-export-pdf')).toBeNull();
    expect(root.querySelector('p-message')).not.toBeNull();
  });

  it('renders the three export sections in order when a plan is present', () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;

    const zip = root.querySelector('app-export-zip');
    const json = root.querySelector('app-export-json');
    const pdf = root.querySelector('app-export-pdf');

    expect(zip).not.toBeNull();
    expect(json).not.toBeNull();
    expect(pdf).not.toBeNull();

    const order = Array.from(
      root.querySelectorAll('app-export-zip, app-export-json, app-export-pdf'),
    );
    expect(order.map((el) => el.tagName.toLowerCase())).toEqual([
      'app-export-zip',
      'app-export-json',
      'app-export-pdf',
    ]);
  });

  it('switches the active tab to PDF when PDF generation is running so the user stays on the PDF tab', () => {
    const { fixture, store } = setup();
    const component = fixture.componentInstance as ExportWorkspaceComponent & {
      active: { (): string; set: (v: 'zip' | 'json' | 'pdf') => void };
    };

    // Default lands on the .zip tab.
    expect(component.active()).toBe('zip');

    // PDF generation starts: isGenerating=true and pdfTokenStats becomes non-null.
    (store as unknown as { isGenerating: ReturnType<typeof signal<boolean>> }).isGenerating.set(true);
    (store as unknown as { pdfTokenStats: ReturnType<typeof signal<unknown>> }).pdfTokenStats.set({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      model: 'openai/gpt-4o-mini',
      generatedAt: '2026-09-20T07:00:00Z',
      startedAt: '2026-09-20T07:00:00Z',
      llmCalls: 0,
    });
    fixture.detectChanges();

    expect(component.active()).toBe('pdf');
  });
});
