import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import JSZip from 'jszip';
import { OpenSpecExportService } from '../../../core/openspec-export.service';
import { MarkdownRendererService } from '../../../core/markdown-renderer.service';
import { ProjectStore } from '../../../core/project.store';
import { Plan } from '../../../core/plan.schema';
import { minimalPlanFixture } from '../../../testing/fixtures';
import { ExportOpenspecComponent } from './export-openspec.component';

describe('ExportOpenspecComponent', () => {
  function setup(plan: Plan | null = minimalPlanFixture) {
    const planSig = signal(plan);
    const overridesSig = signal<Record<string, string>>({});
    const buildZip = vi.fn(async () => new Blob(['openspec-zip']));
    const listFiles = vi.fn().mockReturnValue([
      { path: 'openspec/changes/planner-fixture/proposal.md', content: '' },
      { path: 'openspec/changes/planner-fixture/specs/planner-fixture/spec.md', content: '' },
      {
        path: 'openspec/changes/planner-fixture/specs/planner-fixture-architecture/spec.md',
        content: '',
      },
      { path: 'openspec/changes/planner-fixture/design.md', content: '' },
      { path: 'openspec/changes/planner-fixture/tasks.md', content: '' },
    ]);

    const store = {
      plan: planSig,
      markdownOverrides: overridesSig,
    };
    const service = { listFiles, buildZip };

    TestBed.configureTestingModule({
      imports: [ExportOpenspecComponent],
      providers: [
        { provide: ProjectStore, useValue: store },
        { provide: OpenSpecExportService, useValue: service },
      ],
    });

    const fixture = TestBed.createComponent(ExportOpenspecComponent);
    fixture.detectChanges();

    return { fixture, store, buildZip, service };
  }

  it('renders no file list when there is no plan', () => {
    const { fixture } = setup(null);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('.file-list li:not(.file-list-empty)').length).toBe(0);
  });

  it('renders 5 file paths via the service when a plan is present', () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('.file-list li').length).toBe(5);
    expect(root.textContent).toContain('openspec/changes/planner-fixture/proposal.md');
    expect(root.textContent).toContain('openspec/changes/planner-fixture/tasks.md');
  });

  it('calls buildZip with the active overrides when Download .zip is clicked', async () => {
    const { fixture, buildZip } = setup();
    const root = fixture.nativeElement as HTMLElement;
    const button = root.querySelector('p-button button') as HTMLButtonElement;
    button.click();
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    await fixture.whenStable();
    expect(buildZip).toHaveBeenCalledTimes(1);
    expect(buildZip).toHaveBeenCalledWith(minimalPlanFixture, {});
  });
});

describe('OpenSpecExportService', () => {
  function setup() {
    TestBed.configureTestingModule({
      providers: [OpenSpecExportService, MarkdownRendererService],
    });
    return { service: TestBed.inject(OpenSpecExportService) };
  }

  it('buildZip produces a non-empty blob with all 5 OpenSpec paths', async () => {
    const { service } = setup();
    const blob = await service.buildZip(minimalPlanFixture, {});
    expect(blob.size).toBeGreaterThan(0);
    const zip = await JSZip.loadAsync(blob);
    const paths = Object.keys(zip.files)
      .filter((p) => !zip.files[p].dir)
      .sort();
    expect(paths).toEqual([
      'openspec/changes/planner-fixture/design.md',
      'openspec/changes/planner-fixture/proposal.md',
      'openspec/changes/planner-fixture/specs/planner-fixture-architecture/spec.md',
      'openspec/changes/planner-fixture/specs/planner-fixture/spec.md',
      'openspec/changes/planner-fixture/tasks.md',
    ]);
  });

  it('substitutes an override when its key matches an OpenSpec path', async () => {
    const { service } = setup();
    const overridePath = 'openspec/changes/planner-fixture/proposal.md';
    const blob = await service.buildZip(minimalPlanFixture, {
      [overridePath]: 'OVERRIDDEN PROPOSAL',
    });
    const zip = await JSZip.loadAsync(blob);
    const text = await zip.file(overridePath)!.async('string');
    expect(text).toBe('OVERRIDDEN PROPOSAL');
  });
});