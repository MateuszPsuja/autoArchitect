import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { ExportService } from '../../../core/export.service';
import { MarkdownRendererService } from '../../../core/markdown-renderer.service';
import { ProjectStore } from '../../../core/project.store';
import { Plan } from '../../../core/plan.schema';
import { minimalPlanFixture } from '../../../testing/fixtures';
import { featureFolder } from '../../../core/feature-slug';
import { ExportZipComponent } from './export-zip.component';

const PREFIX = featureFolder(minimalPlanFixture);

describe('ExportZipComponent', () => {
  function setup(plan: Plan | null = minimalPlanFixture, overrides: Record<string, string> = {}) {
    const planSig = signal(plan);
    const overridesSig = signal(overrides);

    const buildZip = vi.fn(async () => new Blob(['zip']));

    let renderer: MarkdownRendererService;
    const store = {
      plan: planSig,
      markdownOverrides: overridesSig,





      derivedFiles: () => {
        const plan = planSig();
        return plan && renderer ? renderer.toMarkdownFiles(plan) : [];
      },
    };

    TestBed.configureTestingModule({
      imports: [ExportZipComponent],
      providers: [
        { provide: ProjectStore, useValue: store },
        { provide: ExportService, useValue: { buildZip } },
        MarkdownRendererService,
      ],
    });

    renderer = TestBed.inject(MarkdownRendererService);

    const fixture = TestBed.createComponent(ExportZipComponent);
    fixture.detectChanges();

    return { fixture, store, buildZip };
  }

  it('renders no file list when there is no plan', () => {
    const { fixture } = setup(null);
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelectorAll('.file-list li:not(.file-list-empty)').length).toBe(0);
  });

  it('renders the file list when a plan is present', () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;

    const items = root.querySelectorAll('.file-list li');
    expect(items.length).toBeGreaterThan(0);
    expect(root.textContent).toContain(`${PREFIX}/ARCHITECTURE.md`);
  });

  it('marks overridden files with the modified marker', () => {
    const { fixture } = setup(minimalPlanFixture, { [`${PREFIX}/ARCHITECTURE.md`]: 'custom' });
    const root = fixture.nativeElement as HTMLElement;

    const modified = root.querySelectorAll('.modified-marker');
    expect(modified.length).toBe(1);
  });

  it('calls buildZip with the active overrides when Download .zip is clicked', async () => {
    const overrides = { [`${PREFIX}/ARCHITECTURE.md`]: 'custom' };
    const { fixture, buildZip } = setup(minimalPlanFixture, overrides);
    const root = fixture.nativeElement as HTMLElement;
    const button = root.querySelector('p-button button') as HTMLButtonElement;

    button.click();
    await fixture.whenStable();

    expect(buildZip).toHaveBeenCalledTimes(1);
    expect(buildZip).toHaveBeenCalledWith(minimalPlanFixture, overrides);
  });
});
