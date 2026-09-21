import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import JSZip from 'jszip';
import { ExportService } from './export.service';
import { minimalPlanFixture } from '../testing/fixtures';
import { branchName, featureFolder } from './feature-slug';
import { ProjectStore } from './project.store';
import { Plan } from './plan.schema';

const stats = {
  promptTokens: 12,
  completionTokens: 34,
  totalTokens: 46,
  model: 'openai/gpt-4o-mini',
  generatedAt: '2026-01-01T00:00:00.000Z',
};

function setup(options: { tokenStats?: ReturnType<typeof signal<typeof stats | null>> } = {}) {
  const tokenStatsSig = options.tokenStats ?? signal<typeof stats | null>(null);
  const store = { tokenStats: tokenStatsSig };
  TestBed.configureTestingModule({
    providers: [{ provide: ProjectStore, useValue: store }],
  });
  return { service: TestBed.inject(ExportService), store };
}

describe('ExportService', () => {
  it('creates a zip with plan.json, constitution.md and spec-kit markdown docs', async () => {
    const { service } = setup();
    const blob = await service.buildZip(minimalPlanFixture, {});
    const zip = await JSZip.loadAsync(blob);
    const prefix = featureFolder(minimalPlanFixture);
    const expectedBranch = branchName(minimalPlanFixture);

    expect(zip.file('plan.json')).toBeTruthy();
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

    const featuresJson = await zip.file('features.json')!.async('string');
    const parsed = JSON.parse(featuresJson) as {
      version: number;
      features: Array<{
        checklistPath: string;
        constitutionPath: string;
        branchName: string;
        artefacts: string[];
      }>;
    };
    expect(parsed.version).toBe(3);
    expect(parsed.features[0].checklistPath).toBe(`${prefix}/checklist.md`);
    expect(parsed.features[0].constitutionPath).toBe('.specify/memory/constitution.md');
    expect(parsed.features[0].branchName).toBe(expectedBranch);
    expect(parsed.features[0].artefacts).toContain(`${prefix}/checklist.md`);
    expect(parsed.features[0].artefacts).toContain('.specify/memory/constitution.md');
  });

  it('stamps meta.tokenStats onto plan.json when the store has stats', async () => {
    const { service } = setup({ tokenStats: signal<typeof stats | null>(stats) });

    const planBefore: Plan = minimalPlanFixture;
    expect(planBefore.meta.tokenStats).toBeUndefined();

    const blob = await service.buildZip(planBefore, {});
    const zip = await JSZip.loadAsync(blob);
    const planJson = await zip.file('plan.json')!.async('string');
    const parsed = JSON.parse(planJson) as Plan;

    expect(parsed.meta.tokenStats).toEqual(stats);
  });

  it('does not mutate the supplied plan object', async () => {
    const { service } = setup({ tokenStats: signal<typeof stats | null>(stats) });

    const planBefore: Plan = JSON.parse(JSON.stringify(minimalPlanFixture));
    await service.buildZip(planBefore, {});
    expect(planBefore.meta.tokenStats).toBeUndefined();
  });

  it('stamps null when the store has no stats', async () => {
    const { service } = setup({ tokenStats: signal<typeof stats | null>(null) });
    const blob = await service.buildZip(minimalPlanFixture, {});
    const zip = await JSZip.loadAsync(blob);
    const planJson = await zip.file('plan.json')!.async('string');
    const parsed = JSON.parse(planJson) as Plan;
    expect(parsed.meta.tokenStats).toBeNull();
  });
});