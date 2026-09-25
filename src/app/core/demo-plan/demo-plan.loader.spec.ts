import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { PlanSchema } from '../plan.schema';
import {
  _resetDemoPlanCacheForTests,
  _setDemoPlanCacheForTests,
  getDemoPlan,
  getDemoTokenStats,
  isDemoPlan,
  provideDemoPlanInitializer,
} from './demo-plan.loader';
import { Plan } from '../plan.schema';

async function flushInit() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

const SAMPLE_PLAN_INPUT = {
  meta: {
    title: 'Demo Fixture',
    summary: 'fixture',
    generatedAt: '2026-09-15T00:00:00.000Z',
    model: 'demo-seed',
    featureNumber: 1,
    featureSlug: 'demo-fixture',
    branchName: '001-demo-fixture',
    libraries: [],
  },
  systemOverview: {
    purpose: 'p',
    context: 'c',
    keyActors: ['x'],
    constraints: [],
    nfrs: [],
    boundedContextMap: 'graph LR\nA-->B',
    c4: { contextDiagram: 'graph TD', containerDiagram: 'graph TD' },
  },
  boundedContexts: [
    {
      id: 'sample',
      name: 'Sample',
      description: 'sample',
      layer: 'backend',
      ubiquitousLanguage: { Sample: 'sample' },
    },
  ],
  userStories: [],
  functionalRequirements: [],
  successCriteria: [],
  constitution: {
    projectName: 'x',
    version: '1.0.0',
    ratifiedAt: 't',
    lastAmendedAt: 't',
    articles: [
      { articleNumber: 1, title: 'a', content: 'a' },
      { articleNumber: 2, title: 'a', content: 'a' },
      { articleNumber: 3, title: 'a', content: 'a' },
      { articleNumber: 4, title: 'a', content: 'a' },
      { articleNumber: 5, title: 'a', content: 'a' },
      { articleNumber: 6, title: 'a', content: 'a' },
      { articleNumber: 7, title: 'a', content: 'a' },
      { articleNumber: 8, title: 'a', content: 'a' },
      { articleNumber: 9, title: 'a', content: 'a' },
    ],
  },
  architectureLayers: [
    {
      id: 'sample',
      name: 'Sample',
      description: 'sample',
      techStack: ['sample'],
      patterns: ['sample'],
      mermaidDiagram: 'graph TD',
      summary: 'sample',
      directoryStructure: [
        { path: 'sample', description: 'sample', agentInstructions: ['a', 'b', 'c'] },
      ],
    },
  ],
  domains: [
    {
      id: 'sample',
      name: 'Sample',
      description: 'sample',
      layer: 'backend',
      responsibilities: ['sample'],
      aggregates: [],
      domainEvents: [],
      directoryPath: 'backend/sample',
      components: [
        {
          id: 'sample-comp',
          name: 'SampleComp',
          description: 'sample',
          type: 'domain-service',
          layer: 'domain',
          responsibilities: ['sample'],
          inputs: ['sample'],
          outputs: ['sample'],
          dependencies: [],
          publicApi: ['sample()'],
          errorHandling: 'sample',
          acceptanceCriteria: ['sample'],
          outOfScope: ['sample'],
          tddSpec: {
            unitTests: [
              { description: 'a', given: ['a'], when: 'a', then: ['a'] },
              { description: 'b', given: ['a'], when: 'a', then: ['a'] },
            ],
            integrationTests: [
              { description: 'a', given: ['a'], when: 'a', then: ['a'] },
            ],
          },
          targetFile: 'sample.ts',
        },
      ],
    },
  ],
  workflows: [],
  adrs: [],
  agentTasks: [],
  refinementChats: [],
  specKit: { offlineContract: null, keyEntities: [], patches: [] },
} as unknown as Plan;

const samplePlan = PlanSchema.parse(SAMPLE_PLAN_INPUT) as Plan;

const VALID_URL = 'data/microblog-demo.plan.json';

function setupTestBed() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideDemoPlanInitializer(),
    ],
  });
}

describe('demo-plan.loader', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    _resetDemoPlanCacheForTests();
    setupTestBed();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    TestBed.resetTestingModule();
    _resetDemoPlanCacheForTests();
  });

  it('populates the cache when the JSON fetch and schema validation succeed', async () => {
    const req = httpMock.expectOne(VALID_URL);
    req.flush(samplePlan);
    await flushInit();

    expect(getDemoPlan()?.meta.title).toBe('Demo Fixture');
    expect(getDemoTokenStats()?.model).toBe('anthropic/claude-3.5-sonnet');
  });

  it('leaves the cache null when the HTTP request fails', async () => {
    const req = httpMock.expectOne(VALID_URL);
    req.error(new ProgressEvent('error'), { status: 500, statusText: 'Server Error' });
    await flushInit();

    expect(getDemoPlan()).toBeNull();
    expect(getDemoTokenStats()).toBeNull();
  });

  it('leaves the cache null when the JSON fails Zod validation', async () => {
    const req = httpMock.expectOne(VALID_URL);
    req.flush({ meta: null });
    await flushInit();

    expect(getDemoPlan()).toBeNull();
    expect(getDemoTokenStats()).toBeNull();
  });

  it('isDemoPlan returns true only for the cached plan fingerprint', async () => {
    httpMock.expectOne(VALID_URL).flush(samplePlan);
    await flushInit();
    _setDemoPlanCacheForTests(samplePlan);
    expect(isDemoPlan(samplePlan)).toBe(true);
    expect(isDemoPlan({ ...samplePlan, meta: { ...samplePlan.meta, title: 'Other' } })).toBe(false);
    expect(isDemoPlan(null)).toBe(false);
    expect(isDemoPlan(undefined)).toBe(false);
  });

  it('isDemoPlan returns false when the cache has not been populated', async () => {
    httpMock.expectOne(VALID_URL).error(new ProgressEvent('error'), { status: 500, statusText: 'Server Error' });
    await flushInit();
    expect(isDemoPlan(samplePlan)).toBe(false);
  });
});
