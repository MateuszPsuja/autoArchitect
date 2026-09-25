import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import JSZip from 'jszip';
import { ExportService } from './export.service';
import { minimalPlanFixture } from '../testing/fixtures';
import { featureFolder } from './feature-slug';
import { ProjectStore } from './project.store';
import { Plan } from './plan.schema';

function setup() {
  const store = { tokenStats: signal(null) };
  TestBed.configureTestingModule({
    providers: [{ provide: ProjectStore, useValue: store }],
  });
  return { service: TestBed.inject(ExportService), store };
}

describe('ExportService', () => {
  it('creates a zip with .specify/memory/constitution.md and the spec-kit specs/<NNN>-<slug>/ subtree (no plan.json or features.json)', async () => {
    const { service } = setup();
    const blob = await service.buildZip(minimalPlanFixture, {});
    const zip = await JSZip.loadAsync(blob);
    const prefix = featureFolder(minimalPlanFixture);

    expect(zip.file('.specify/memory/constitution.md')).toBeTruthy();
    expect(zip.file(`${prefix}/ARCHITECTURE.md`)).toBeTruthy();
    expect(zip.file(`${prefix}/docs/00-system/overview.md`)).toBeTruthy();
    expect(zip.file(`${prefix}/spec.md`)).toBeTruthy();
    expect(zip.file(`${prefix}/plan.md`)).toBeTruthy();
    expect(zip.file(`${prefix}/data-model.md`)).toBeTruthy();
    expect(zip.file(`${prefix}/quickstart.md`)).toBeTruthy();
    expect(zip.file(`${prefix}/tasks.md`)).toBeTruthy();
    expect(zip.file(`${prefix}/contracts/backend.md`)).toBeTruthy();
    expect(zip.file(`${prefix}/contracts/frontend.md`)).toBeTruthy();
    expect(zip.file(`${prefix}/checklist.md`)).toBeTruthy();

    expect(zip.file('plan.json')).toBeFalsy();
    expect(zip.file('features.json')).toBeFalsy();
  });

  it('contains only the .specify/ root and the specs/<NNN>-<slug>/ folder at zip root', async () => {
    const { service } = setup();
    const blob = await service.buildZip(minimalPlanFixture, {});
    const zip = await JSZip.loadAsync(blob);

    const rootFiles = Object.keys(zip.files)
      .filter((p) => !p.includes('/'))
      .sort();
    expect(rootFiles).toEqual([]);

    expect(zip.file('.specify/memory/constitution.md')).toBeTruthy();
    const featureEntries = Object.keys(zip.files).filter((p) => p.startsWith('specs/'));
    expect(featureEntries.length).toBeGreaterThan(0);
  });

  it('emits spec-kit **Status** + **Input** frontmatter in zipped spec.md when userIdea is set', async () => {
    const { service } = setup();
    const idea = 'A planning tool that generates architecture docs from an idea.';
    const plan: Plan = {
      ...minimalPlanFixture,
      meta: { ...minimalPlanFixture.meta, userIdea: idea },
    };
    const blob = await service.buildZip(plan, {});
    const zip = await JSZip.loadAsync(blob);
    const prefix = featureFolder(plan);
    const specMd = await zip.file(`${prefix}/spec.md`)!.async('string');
    expect(specMd).toContain('**Status**: Draft');
    expect(specMd).toContain(`**Input**: User description: "${idea}"`);
  });

  it('emits the __SPECKIT_COMMAND_PLAN__ Note line and Structure Decision in zipped plan.md', async () => {
    const { service } = setup();
    const blob = await service.buildZip(minimalPlanFixture, {});
    const zip = await JSZip.loadAsync(blob);
    const prefix = featureFolder(minimalPlanFixture);
    const planMd = await zip.file(`${prefix}/plan.md`)!.async('string');
    expect(planMd).toContain('**Note**: This template is filled in by the `__SPECKIT_COMMAND_PLAN__` command');
    expect(planMd).toContain('**Structure Decision**:');
  });

  it('emits [US###] tags and CHK### ids in zipped tasks.md and checklist.md', async () => {
    const { service } = setup();
    const blob = await service.buildZip(minimalPlanFixture, {});
    const zip = await JSZip.loadAsync(blob);
    const prefix = featureFolder(minimalPlanFixture);
    const tasksMd = await zip.file(`${prefix}/tasks.md`)!.async('string');
    const checklistMd = await zip.file(`${prefix}/checklist.md`)!.async('string');
    expect(tasksMd).toMatch(/T\d{3} \[P?\] \[US\d{3}\]/);
    expect(checklistMd).toMatch(/CHK\d{3}/);
  });
});
