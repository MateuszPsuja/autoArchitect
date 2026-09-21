import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { GeneratePlanStatsComponent } from './generate-plan-stats.component';
import { ProjectStore } from '../../core/project.store';
import { RunStreamHost } from '../../core/streaming/run-stream-host.service';

function buildTokenStats(overrides: Record<string, unknown> = {}): unknown {
  return {
    promptTokens: 100,
    completionTokens: 200,
    totalTokens: 300,
    model: 'openrouter/test',
    generatedAt: '2026-01-01T00:00:00.000Z',
    startedAt: new Date(Date.now() - 5000).toISOString(),
    llmCalls: 4,
    errors: 0,
    retries: 0,
    repairs: 0,
    ...overrides,
  };
}

describe('GeneratePlanStatsComponent', () => {
  function setup(statsOverrides: Record<string, unknown> = {}, diagramAudit: unknown = null) {
    const tokenStatsSig = signal<unknown>(buildTokenStats(statsOverrides));
    const diagramAuditSig = signal<unknown>(diagramAudit);
    const tickSig = signal(0);
    const chunkTsSig = signal<readonly number[]>([]);
    const store = {
      tokenStats: tokenStatsSig,
      diagramAudit: diagramAuditSig,
    };
    const streamHost = {
      tick: tickSig,
      chunkTimestamps: chunkTsSig,
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ProjectStore, useValue: store },
        { provide: RunStreamHost, useValue: streamHost },
      ],
    });
    const fixture = TestBed.createComponent(GeneratePlanStatsComponent);
    return { fixture, store, streamHost, tokenStatsSig, diagramAuditSig };
  }

  it('renders nothing when tokenStats is null', () => {
    const { fixture } = setup();
    TestBed.inject(ProjectStore as never);
    (TestBed.inject(ProjectStore as never) as { tokenStats: { set: (v: unknown) => void } }).tokenStats.set(null);
    fixture.detectChanges();
    const stats = fixture.nativeElement.querySelector('.stats-section');
    expect(stats).toBeNull();
  });

  it('renders the model + duration + tokens rows when tokenStats is present', () => {
    const { fixture } = setup();
    fixture.detectChanges();
    const html = fixture.nativeElement.textContent ?? '';
    expect(html).toContain('openrouter/test');
    expect(html).toContain('LLM calls');
    expect(html).toContain('Prompt tokens');
    expect(html).toContain('Completion tokens');
    expect(html).toContain('Total tokens');
  });

  it('folds diagramAudit failures into the errors total', () => {
    const { fixture } = setup({ errors: 1 }, { failed: 2, repaired: 0 });
    fixture.detectChanges();
    const html = fixture.nativeElement.textContent ?? '';

    expect(html).toContain('3');
  });

  it('applies the warning class when errors > 0', () => {
    const { fixture } = setup({ errors: 1 });
    fixture.detectChanges();
    const warningRow = fixture.nativeElement.querySelector('.stats-row-warning');
    expect(warningRow).not.toBeNull();
  });

  it('does not apply the warning class when errors === 0', () => {
    const { fixture } = setup({ errors: 0 });
    fixture.detectChanges();
    const warningRow = fixture.nativeElement.querySelector('.stats-row-warning');
    expect(warningRow).toBeNull();
  });

  it('renders generatedAt via the date pipe when present', () => {
    const { fixture } = setup({ generatedAt: '2026-08-31T12:00:00.000Z' });
    fixture.detectChanges();
    const html = fixture.nativeElement.textContent ?? '';
    expect(html).toContain('GeneratedAt');
  });

  it('omits generatedAt row when generatedAt is missing', () => {
    const { fixture } = setup({ generatedAt: undefined });
    fixture.detectChanges();
    const html = fixture.nativeElement.textContent ?? '';
    expect(html).not.toContain('GeneratedAt');
  });
});

describe('GeneratePlanStatsComponent — formatters', () => {
  function setup() {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ProjectStore,
          useValue: { tokenStats: signal(null), diagramAudit: signal(null) },
        },
        {
          provide: RunStreamHost,
          useValue: { tick: signal(0), chunkTimestamps: signal<readonly number[]>([]) },
        },
      ],
    });
    return TestBed.createComponent(GeneratePlanStatsComponent);
  }

  it('formatDuration handles ms under a second', () => {
    const c = setup();
    expect((c.componentInstance as any).formatDuration(500)).toBe('0s');
    expect((c.componentInstance as any).formatDuration(0)).toBe('0s');
    expect((c.componentInstance as any).formatDuration(-1)).toBe('0s');
    expect((c.componentInstance as any).formatDuration(NaN)).toBe('0s');
    expect((c.componentInstance as any).formatDuration(65_000)).toBe('1m 5s');
  });

  it('formatRate returns 0.0 for non-positive or non-finite', () => {
    const c = setup();
    expect((c.componentInstance as any).formatRate(0)).toBe('0.0 tok/s');
    expect((c.componentInstance as any).formatRate(-1)).toBe('0.0 tok/s');
    expect((c.componentInstance as any).formatRate(NaN)).toBe('0.0 tok/s');
    expect((c.componentInstance as any).formatRate(2.5)).toBe('2.5 tok/s');
  });

  it('formatEta returns "—" for null/invalid inputs', () => {
    const c = setup();
    expect((c.componentInstance as any).formatEta(null)).toBe('—');
    expect((c.componentInstance as any).formatEta(-5)).toBe('—');
    expect((c.componentInstance as any).formatEta(NaN)).toBe('—');
    expect((c.componentInstance as any).formatEta(0)).toBe('0s');
  });
});