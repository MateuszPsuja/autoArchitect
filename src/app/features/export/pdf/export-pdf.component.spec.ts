import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { PdfCreatorService } from '../../../core/pdf-creator.service';
import { ProjectStore, defaultProviderConfigs } from '../../../core/project.store';
import { Plan } from '../../../core/plan.schema';
import { minimalPlanFixture } from '../../../testing/fixtures';
import { ExportPdfComponent } from './export-pdf.component';

describe('ExportPdfComponent', () => {
  function setup(
    plan: Plan | null = minimalPlanFixture,
    overrides: { apiKey?: string; selectedModel?: string; provider?: 'openrouter' | 'lmstudio' } = {},
  ) {
    const planSig = signal(plan);
    const provider = overrides.provider ?? ('openrouter' as const);
    const providerConfigs = {
      ...defaultProviderConfigs(),
      [provider]: {
        ...defaultProviderConfigs()[provider],
        selectedModel: overrides.selectedModel ?? 'openai/gpt-4o-mini',
      },
    };
    const configSig = signal({
      provider,
      providerConfigs,
    });
    const apiKeySig = signal(overrides.apiKey ?? 'sk-test');
    const isGeneratingSig = signal(false);
    const pdfTokenStatsSig = signal<unknown>(null);

    const generate = vi.fn(async () => ({
      ok: true as const,
      blob: new Blob(['pdf']),
      repair: null,
      preflightWarning: null,
    }));

    const store = {
      plan: planSig,
      config: configSig,
      apiKey: apiKeySig,
      isGenerating: isGeneratingSig,
      pdfTokenStats: pdfTokenStatsSig,
    };

    TestBed.configureTestingModule({
      imports: [ExportPdfComponent],
      providers: [
        { provide: ProjectStore, useValue: store },
        { provide: PdfCreatorService, useValue: { generate } },
      ],
    });

    const fixture = TestBed.createComponent(ExportPdfComponent);
    fixture.detectChanges();

    return { fixture, store, generate };
  }

  it('disables the button when the API key is missing and the provider requires one', () => {
    const { fixture } = setup(minimalPlanFixture, { apiKey: '', provider: 'openrouter' });
    const root = fixture.nativeElement as HTMLElement;

    const button = root.querySelector('app-export-pdf-button p-button button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('disables the button when there is no plan', () => {
    const { fixture } = setup(null);
    const root = fixture.nativeElement as HTMLElement;

    const button = root.querySelector('app-export-pdf-button p-button button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('calls PdfCreatorService.generate when the button is clicked', async () => {
    const { fixture, generate } = setup();
    const root = fixture.nativeElement as HTMLElement;
    const button = root.querySelector('app-export-pdf-button p-button button') as HTMLButtonElement;

    button.click();
    await fixture.whenStable();

    expect(generate).toHaveBeenCalledWith(minimalPlanFixture);
  });

  it('does not render the stats panel when pdfTokenStats is null and not generating', () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;

    const stats = root.querySelector('app-export-pdf-stats .pdf-stats');
    expect(stats).toBeNull();
  });

  it('shows the missing-API-key reason when the provider requires one and none is set', () => {
    const { fixture } = setup(minimalPlanFixture, {
      apiKey: '',
      selectedModel: '',
      provider: 'openrouter',
    });
    const root = fixture.nativeElement as HTMLElement;

    const reason = root.querySelector('[data-testid="export-pdf-disabled-reason"]');
    expect(reason?.textContent).toContain('OpenRouter API Key');
    expect(reason?.textContent).toContain('a model');
  });

  it('shows the missing-model reason when the key is set but no model is selected', () => {
    const { fixture } = setup(minimalPlanFixture, {
      apiKey: 'sk-test',
      selectedModel: '',
      provider: 'openrouter',
    });
    const root = fixture.nativeElement as HTMLElement;

    const reason = root.querySelector('[data-testid="export-pdf-disabled-reason"]');
    expect(reason?.textContent).toContain('a model');
    expect(reason?.textContent).not.toContain('API Key');
  });

  it('shows the no-plan reason when there is no active plan', () => {
    const { fixture } = setup(null);
    const root = fixture.nativeElement as HTMLElement;

    const reason = root.querySelector('[data-testid="export-pdf-disabled-reason"]');
    expect(reason?.textContent).toContain('No active plan');
  });

  it('omits the reason text when the button is enabled (plan + key + model set)', () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;

    const reason = root.querySelector('[data-testid="export-pdf-disabled-reason"]');
    expect(reason).toBeNull();
  });

  it('renders the error message returned by PdfCreatorService.generate', async () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;

    const errorStore = (TestBed.inject(PdfCreatorService) as unknown as {
      generate: () => Promise<{ ok: false; error: { message: string } }>;
    });
    errorStore.generate = vi.fn(async () => ({
      ok: false as const,
      error: {
        type: 'schema_validation',
        message: 'PdfDocument schema validation failed (2 issues):\n  • sections: ...\n  • executiveSummary: ...',
      },
      repair: null,
      preflightWarning: null,
    }));

    const button = root.querySelector('app-export-pdf-button p-button button') as HTMLButtonElement;
    button.click();
    await fixture.whenStable();
    fixture.detectChanges();

    const err = root.querySelector('[data-testid="export-pdf-error"]') as HTMLElement;
    expect(err?.textContent).toContain('PdfDocument schema validation failed (2 issues):');



    expect(err?.textContent).toContain('• sections');
    expect(err?.textContent).toContain('• executiveSummary');
    expect(getComputedStyle(err).whiteSpace).toMatch(/pre/);
  });

  it('renders the repair warning when PdfCreatorService.generate returns a repair', async () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;

    (TestBed.inject(PdfCreatorService) as unknown as {
      generate: () => Promise<{ ok: true; blob: Blob; repair: { reason: string; placeholderCount: number } }>;
    }).generate = vi.fn(async () => ({
      ok: true as const,
      blob: new Blob(['pdf']),
      repair: { reason: 'single_section_root', placeholderCount: 2 },
      preflightWarning: null,
    }));

    const button = root.querySelector('app-export-pdf-button p-button button') as HTMLButtonElement;
    button.click();
    await fixture.whenStable();
    fixture.detectChanges();

    const warning = root.querySelector('[data-testid="export-pdf-repair-warning"]') as HTMLElement;
    expect(warning).toBeTruthy();
    expect(warning.textContent).toContain('2 placeholder sections');
    expect(warning.textContent).toMatch(/emitted a single section instead of a full document/);
  });

  it('renders the repair warning for the array-of-headings reason', async () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;

    (TestBed.inject(PdfCreatorService) as unknown as {
      generate: () => Promise<{ ok: true; blob: Blob; repair: { reason: string; placeholderCount: number } }>;
    }).generate = vi.fn(async () => ({
      ok: true as const,
      blob: new Blob(['pdf']),
      repair: { reason: 'array_section_headings', placeholderCount: 5 },
      preflightWarning: null,
    }));

    const button = root.querySelector('app-export-pdf-button p-button button') as HTMLButtonElement;
    button.click();
    await fixture.whenStable();
    fixture.detectChanges();

    const warning = root.querySelector('[data-testid="export-pdf-repair-warning"]') as HTMLElement;
    expect(warning).toBeTruthy();
    expect(warning.textContent).toContain('5 placeholder sections');
    expect(warning.textContent).toMatch(/only the section headings, without body content/);
  });

  it('renders the diagnostic detail (rawBytes, finishReason, attemptCount) when present on the repair', async () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;

    (TestBed.inject(PdfCreatorService) as unknown as {
      generate: () => Promise<{ ok: true; blob: Blob; repair: { reason: string; placeholderCount: number; rawBytes: number; finishReason: string; attemptCount: number } }>;
    }).generate = vi.fn(async () => ({
      ok: true as const,
      blob: new Blob(['pdf']),
      repair: {
        reason: 'array_section_headings',
        placeholderCount: 4,
        rawBytes: 12_345,
        finishReason: 'stop',
        attemptCount: 3,
      },
      preflightWarning: null,
    }));

    const button = root.querySelector('app-export-pdf-button p-button button') as HTMLButtonElement;
    button.click();
    await fixture.whenStable();
    fixture.detectChanges();

    const warning = root.querySelector('[data-testid="export-pdf-repair-warning"]') as HTMLElement;
    expect(warning).toBeTruthy();
    expect(warning.textContent).toContain('12,345 chars');
    expect(warning.textContent).toContain('finish_reason="stop"');
    expect(warning.textContent).toContain('3 attempt(s)');
  });

  it('omits the repair warning when PdfCreatorService.generate returns no repair', async () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;

    (TestBed.inject(PdfCreatorService) as unknown as {
      generate: () => Promise<{ ok: true; blob: Blob; repair: null }>;
    }).generate = vi.fn(async () => ({
      ok: true as const,
      blob: new Blob(['pdf']),
      repair: null,
      preflightWarning: null,
    }));

    const button = root.querySelector('app-export-pdf-button p-button button') as HTMLButtonElement;
    button.click();
    await fixture.whenStable();
    fixture.detectChanges();

    const warning = root.querySelector('[data-testid="export-pdf-repair-warning"]');
    expect(warning).toBeNull();
  });

  it('clears the repair warning when a fresh export starts', async () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;
    const generator = TestBed.inject(PdfCreatorService) as unknown as {
      generate: () => Promise<unknown>;
    };

    generator.generate = vi.fn(async () => ({
      ok: true as const,
      blob: new Blob(['pdf']),
      repair: { reason: 'single_section_root', placeholderCount: 2 },
      preflightWarning: null,
    }));

    const button = root.querySelector('app-export-pdf-button p-button button') as HTMLButtonElement;
    button.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('[data-testid="export-pdf-repair-warning"]')).toBeTruthy();

    let resolveSecond!: () => void;
    generator.generate = vi.fn(
      () => new Promise<unknown>((r) => {
        resolveSecond = r as () => void;
      }),
    );
    button.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('[data-testid="export-pdf-repair-warning"]')).toBeNull();

    resolveSecond();
  });

  it('clears the live-ticker interval when the component is destroyed mid-generation', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    const { fixture, store } = setup();

    let resolveGenerate!: () => void;
    (TestBed.inject(PdfCreatorService) as unknown as { generate: () => Promise<unknown> }).generate =
      vi.fn(() => new Promise<void>((r) => (resolveGenerate = r)));

    const root = fixture.nativeElement as HTMLElement;
    const button = root.querySelector('app-export-pdf-button p-button button') as HTMLButtonElement;
    button.click();

    (store as unknown as { isGenerating: ReturnType<typeof signal> }).isGenerating.set(true);

    TestBed.flushEffects();
    fixture.detectChanges();

    expect(setIntervalSpy).toHaveBeenCalled();
    const handle = setIntervalSpy.mock.results.at(-1)?.value as ReturnType<typeof setInterval>;

    fixture.destroy();

    expect(clearIntervalSpy).toHaveBeenCalledWith(handle);

    resolveGenerate();
  });
});
