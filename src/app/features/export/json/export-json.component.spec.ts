import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { ProjectStore } from '../../../core/project.store';
import { Plan } from '../../../core/plan.schema';
import { minimalPlanFixture } from '../../../testing/fixtures';
import { ExportJsonComponent } from './export-json.component';

const stats = {
  promptTokens: 10,
  completionTokens: 20,
  totalTokens: 30,
  model: 'openai/gpt-4o-mini',
  generatedAt: '2026-01-01T00:00:00.000Z',
};

function setup(options: { plan?: Plan | null; tokenStats?: ReturnType<typeof signal<typeof stats | null>> } = {}) {
  const planSig = signal<Plan | null>(options.plan !== undefined ? options.plan : minimalPlanFixture);
  const tokenStatsSig = options.tokenStats ?? signal<typeof stats | null>(stats);

  const store = {
    plan: planSig,
    tokenStats: tokenStatsSig,
  };

  TestBed.configureTestingModule({
    imports: [ExportJsonComponent],
    providers: [{ provide: ProjectStore, useValue: store }],
  });

  const fixture = TestBed.createComponent(ExportJsonComponent);
  fixture.detectChanges();

  return { fixture, store };
}

describe('ExportJsonComponent', () => {
  it('disables the button when there is no plan', () => {
    const { fixture } = setup({ plan: null });
    const root = fixture.nativeElement as HTMLElement;

    const button = root.querySelector('p-button button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('creates an application/json blob when Download plan.json is clicked', async () => {
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:mock');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;
    const button = root.querySelector('p-button button') as HTMLButtonElement;

    button.click();
    await fixture.whenStable();

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blobArg = createObjectURL.mock.calls[0][0] as Blob;
    expect(blobArg.type).toBe('application/json');
    expect(clickSpy).toHaveBeenCalledTimes(1);

    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
    clickSpy.mockRestore();
  });

  it('stamps the current store tokenStats onto meta.tokenStats without mutating the store plan', async () => {
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:mock');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const planBefore = minimalPlanFixture;
    const { fixture, store } = setup({ plan: planBefore });
    const root = fixture.nativeElement as HTMLElement;
    const button = root.querySelector('p-button button') as HTMLButtonElement;

    button.click();
    await fixture.whenStable();

    const blobArg = createObjectURL.mock.calls[0][0] as Blob;
    const text = await blobArg.text();
    const parsed = JSON.parse(text) as Plan;

    expect(parsed.meta.tokenStats).toEqual(stats);
    expect((store.plan() as Plan).meta.tokenStats).toBeUndefined();
    expect(parsed.meta.title).toBe(planBefore.meta.title);

    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });

  it('stamps null when the store has no tokenStats', async () => {
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:mock');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const { fixture } = setup({ tokenStats: signal<typeof stats | null>(null) });
    const root = fixture.nativeElement as HTMLElement;
    const button = root.querySelector('p-button button') as HTMLButtonElement;

    button.click();
    await fixture.whenStable();

    const blobArg = createObjectURL.mock.calls[0][0] as Blob;
    const text = await blobArg.text();
    const parsed = JSON.parse(text) as Plan;
    expect(parsed.meta.tokenStats).toBeNull();

    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });
});