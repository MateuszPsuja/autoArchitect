import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { PdfCreatorService } from '../../../core/pdf-creator.service';
import { ProjectStore, defaultProviderConfigs } from '../../../core/project.store';
import { Plan } from '../../../core/plan.schema';
import { TokenUsage } from '../../../core/token-usage.model';
import { minimalPlanFixture, pdfTokenStatsFixture } from '../../../testing/fixtures';
import { ExportPdfComponent } from './export-pdf.component';
import { ExportPdfStatsComponent } from './export-pdf-stats.component';

describe('ExportPdfStatsComponent', () => {
  function setup(
    overrides: {
      stats?: typeof pdfTokenStatsFixture | null;
      active?: boolean;
      done?: boolean;
      durationLabel?: string;
      rateLabel?: string;
      etaLabel?: string | null;
    } = {},
  ) {
    TestBed.configureTestingModule({
      imports: [ExportPdfStatsComponent],
    });

    const fixture = TestBed.createComponent(ExportPdfStatsComponent);
    fixture.componentRef.setInput('stats', overrides.stats ?? null);
    fixture.componentRef.setInput('active', overrides.active ?? false);
    fixture.componentRef.setInput('done', overrides.done ?? false);
    fixture.componentRef.setInput('durationLabel', overrides.durationLabel ?? '0s');
    fixture.componentRef.setInput('rateLabel', overrides.rateLabel ?? '0.0 tok/s');
    fixture.componentRef.setInput('etaLabel', overrides.etaLabel ?? null);
    fixture.detectChanges();

    return { fixture };
  }

  it('renders nothing when stats is null and not active', () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('.pdf-stats')).toBeNull();
  });

  it('renders the active view with the spinner when active', () => {
    const { fixture } = setup({
      stats: { ...pdfTokenStatsFixture, completionTokens: 50 },
      active: true,
      durationLabel: '12s',
      rateLabel: '4.2 tok/s',
      etaLabel: '1m 5s',
    });
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('.pdf-stats')).not.toBeNull();
    expect(root.querySelector('.pdf-stats-label')?.textContent).toContain('Generating PDF');
    expect(root.querySelector('.pdf-stats-spinner')).not.toBeNull();
    expect(root.textContent).toContain('ETA');
    expect(root.textContent).toContain('12s');
    expect(root.textContent).toContain('4.2 tok/s');
  });

  it('renders the done summary without ETA when done', () => {
    const { fixture } = setup({
      stats: pdfTokenStatsFixture,
      done: true,
      durationLabel: '5m 30s',
      rateLabel: '1.0 tok/s',
      etaLabel: null,
    });
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('.pdf-stats-label')?.textContent).toContain('PDF ready');
    expect(root.textContent).not.toContain('ETA');
    expect(root.textContent).toContain('Generated at');
    expect(root.textContent).toContain('5m 30s');
  });

  it('hides ETA when active but etaLabel is null', () => {
    const { fixture } = setup({
      stats: pdfTokenStatsFixture,
      active: true,
      durationLabel: '12s',
      rateLabel: '4.2 tok/s',
      etaLabel: null,
    });
    const root = fixture.nativeElement as HTMLElement;

    expect(root.textContent).not.toContain('ETA');
  });
});

describe('ExportPdfComponent → ExportPdfStatsComponent live propagation', () => {
  function setupParent() {
    const plan: Plan = minimalPlanFixture;
    const planSig = signal<Plan | null>(plan);
    const providerConfigs = {
      ...defaultProviderConfigs(),
      openrouter: {
        ...defaultProviderConfigs().openrouter,
        selectedModel: 'openai/gpt-4o-mini',
      },
    };
    const configSig = signal({ provider: 'openrouter' as const, providerConfigs });
    const apiKeySig = signal('sk-test');
    const isGeneratingSig = signal(false);
    const pdfTokenStatsSig = signal<TokenUsage | null>(null);

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
        { provide: PdfCreatorService, useValue: { generate: vi.fn(async () => ({ ok: true as const, blob: new Blob(['pdf']) })), chunkTimestamps: () => [] as readonly number[] } },
      ],
    });

    const fixture = TestBed.createComponent(ExportPdfComponent);
    fixture.detectChanges();

    return { fixture, pdfTokenStatsSig };
  }

  it('forwards updated pdfTokenStats values into the child stats panel', () => {
    const { fixture, pdfTokenStatsSig } = setupParent();

    pdfTokenStatsSig.set({ ...pdfTokenStatsFixture, llmCalls: 1 });
    fixture.detectChanges();

    pdfTokenStatsSig.set({ ...pdfTokenStatsFixture, llmCalls: 2, completionTokens: 500 });
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('app-export-pdf-stats .pdf-stats')).not.toBeNull();
    expect(root.textContent).toContain('500');
  });

  it('exposes a tick-driven liveStats computed that reads the current pdfTokenStats', () => {
    const { fixture, pdfTokenStatsSig } = setupParent();

    pdfTokenStatsSig.set({ ...pdfTokenStatsFixture, llmCalls: 7 });
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      liveStats: () => TokenUsage | null;
      tick: { (): number; set(v: number): void };
    };

    expect(component.liveStats()?.llmCalls).toBe(7);

    component.tick.set(component.tick() + 1);
    expect(component.liveStats()?.llmCalls).toBe(7);

    pdfTokenStatsSig.set({ ...pdfTokenStatsFixture, llmCalls: 8 });
    expect(component.liveStats()?.llmCalls).toBe(8);
  });

  it('surfaces the empty-response error message in the error banner verbatim', async () => {
    const plan: Plan = minimalPlanFixture;
    const planSig = signal<Plan | null>(plan);
    const providerConfigs = {
      ...defaultProviderConfigs(),
      openrouter: {
        ...defaultProviderConfigs().openrouter,
        selectedModel: 'openai/gpt-4o-mini',
      },
    };
    const configSig = signal({ provider: 'openrouter' as const, providerConfigs });
    const apiKeySig = signal('sk-test');
    const isGeneratingSig = signal(false);
    const pdfTokenStatsSig = signal<TokenUsage | null>(null);

    const generateMock = vi.fn(async () => ({
      ok: false as const,
      error: {
        type: 'provider_error' as const,
        message:
          'PDF generation failed: the provider returned no content after 2 attempts. Check that the model and API key in Config are correct and that the provider supports the requested output size.',
      },
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
        { provide: PdfCreatorService, useValue: { generate: generateMock, chunkTimestamps: () => [] as readonly number[] } },
      ],
    });

    const fixture = TestBed.createComponent(ExportPdfComponent);
    fixture.detectChanges();

    const button: HTMLButtonElement = fixture.nativeElement.querySelector('app-export-pdf-button button');
    expect(button).toBeTruthy();
    button.click();
    await fixture.whenStable();
    fixture.detectChanges();

    const errorBanner = fixture.nativeElement.querySelector(
      '[data-testid="export-pdf-error"]',
    ) as HTMLElement | null;
    expect(errorBanner).not.toBeNull();
    expect(errorBanner?.textContent).toContain('PDF generation failed: the provider returned no content after 2 attempts');
  });
});
