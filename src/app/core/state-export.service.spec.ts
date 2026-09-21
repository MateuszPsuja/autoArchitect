import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { StateExportService } from './state-export.service';
import { ProjectStore, PlannerConfigState, defaultProviderConfigs } from './project.store';
import { STATE_SNAPSHOT_ROW_IDS } from './state-snapshot.model';
import { minimalPlanFixture } from '../testing/fixtures';

class FakeStore {
  replaceState = vi.fn();

  config = vi.fn(() => ({
    provider: 'openrouter' as const,
    providerConfigs: {
      ...defaultProviderConfigs(),
      openrouter: {
        selectedModel: 'openrouter/test-model',
        customBaseUrl: 'http://localhost:1234/v1',
        defaultTemperature: 0.2,
        defaultMaxTokens: 32768,
      },
    },
    auditRepairMaxAttempts: 1,
    parallelSectionConcurrency: 6,
    plannerMaxAttempts: 75,
    requestTimeoutMs: 90_000,
  }));
  providerApiKeys = vi.fn(() => ({
    openrouter: 'sk-test-openrouter',
    lmstudio: '',
    claude: 'sk-test-claude',
    chatgpt: '',
    grok: '',
    minimax: 'sk-test-minimax',
  }));
  plan = vi.fn(() => minimalPlanFixture);
  tokenStats = vi.fn(() => null);
  markdownOverrides = vi.fn(() => ({ 'docs/00-system/overview.md': 'edited content' }));
  savedPlans = vi.fn(() => []);
}

function csvCell(value: unknown): string {
  const json = JSON.stringify(value);
  return `"${json.replace(/"/g, '""')}"`;
}

describe('StateExportService — CsvCodec round-trip', () => {
  it('encode → decode preserves every row', async () => {
    const { CsvCodec } = await import('./state-export.service');
    const rows = [
      { section: 'meta', key: 'version', value: 1 },
      { section: 'meta', key: 'exportedAt', value: '2026-08-21T10:00:00.000Z' },
      { section: 'config', key: 'provider', value: 'openrouter' },
      { section: 'config', key: 'selectedModel', value: 'openai/gpt-4o-mini' },
      { section: 'config', key: 'providerApiKeys', value: { openrouter: 'sk-test' } },
      {
        section: 'plan',
        key: 'plan',
        value: {
          meta: { title: 'X', summary: 'y', generatedAt: 'z', model: 'm', featureNumber: 1, featureSlug: 'x' },
          systemOverview: {
            purpose: 'p',
            context: 'c',
            c4: { contextDiagram: 'd', containerDiagram: 'e' },
          },
          boundedContexts: [],
          architectureLayers: [],
          domains: [],
        },
      },
    ];
    expect(CsvCodec.decode(CsvCodec.encode(rows))).toEqual(rows);
  });

  it('strips a UTF-8 BOM before parsing', async () => {
    const { CsvCodec } = await import('./state-export.service');
    const csv = '﻿section,key,value_json\r\nmeta,version,' + csvCell(1);
    expect(CsvCodec.decode(csv)).toEqual([{ section: 'meta', key: 'version', value: 1 }]);
  });

  it('decodes cells containing JSON-encoded double quotes correctly', async () => {
    const { CsvCodec } = await import('./state-export.service');



    const cell = csvCell('he said "hi"');
    const csv = `section,key,value_json\r\nconfig,msg,${cell}`;
    expect(CsvCodec.decode(csv)).toEqual([
      { section: 'config', key: 'msg', value: 'he said "hi"' },
    ]);
  });

  it('rejects CSV without the canonical header', async () => {
    const { CsvCodec } = await import('./state-export.service');
    expect(() => CsvCodec.decode('foo,bar,baz')).toThrow(/header/i);
  });

  it('rejects rows that do not have exactly three fields', async () => {
    const { CsvCodec } = await import('./state-export.service');
    expect(() => CsvCodec.decode('section,key,value_json\r\nconfig,provider')).toThrow(
      /three fields/,
    );
  });
});

describe('StateExportService — redaction', () => {
  let service: StateExportService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: ProjectStore, useClass: FakeStore }],
    });
    service = TestBed.inject(StateExportService);
  });

  it('replaces every non-empty API key with <redacted> by default', () => {
    const csv = service.exportState();
    expect(csv).toContain('"<redacted>"');
    expect(csv).not.toContain('sk-test-openrouter');
    expect(csv).not.toContain('sk-test-claude');
    expect(csv).not.toContain('sk-test-minimax');
  });

  it('keeps raw API keys when redactApiKeys is explicitly false', () => {
    const csv = service.exportState({ redactApiKeys: false });
    expect(csv).toContain('sk-test-openrouter');
    expect(csv).toContain('sk-test-claude');
    expect(csv).toContain('sk-test-minimax');
    expect(csv).not.toContain('<redacted>');
  });
});

describe('StateExportService — parseState', () => {
  let service: StateExportService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: ProjectStore, useClass: FakeStore }],
    });
    service = TestBed.inject(StateExportService);
  });

  it('honours the legacy lmStudioBaseUrl row for back-compat', () => {
    const csv = [
      'section,key,value_json',
      `meta,version,${csvCell(1)}`,
      `meta,exportedAt,${csvCell('2026-08-21T10:00:00.000Z')}`,
      `config,provider,${csvCell('openrouter')}`,
      `config,selectedModel,${csvCell('openrouter/legacy')}`,
      `config,defaultTemperature,${csvCell(0.2)}`,
      `config,defaultMaxTokens,${csvCell(16384)}`,
      `config,lmStudioBaseUrl,${csvCell('http://my-old-lmstudio:1234/v1')}`,
      `config,providerApiKeys,${csvCell({})}`,
    ].join('\r\n');
    const snap = service.parseState(csv);
    expect(snap.config.providerConfigs.openrouter.customBaseUrl).toBe('http://my-old-lmstudio:1234/v1');
    expect(snap.config.providerConfigs.openrouter.selectedModel).toBe('openrouter/legacy');
  });

  it('prefers customBaseUrl over the legacy lmStudioBaseUrl when both are present', () => {
    const csv = [
      'section,key,value_json',
      `meta,version,${csvCell(1)}`,
      `meta,exportedAt,${csvCell('2026-08-21T10:00:00.000Z')}`,
      `config,provider,${csvCell('openrouter')}`,
      `config,customBaseUrl,${csvCell('http://new-host/v1')}`,
      `config,lmStudioBaseUrl,${csvCell('http://legacy-host/v1')}`,
      `config,providerApiKeys,${csvCell({})}`,
    ].join('\r\n');
    const snap = service.parseState(csv);
    expect(snap.config.providerConfigs.openrouter.customBaseUrl).toBe('http://new-host/v1');
  });

  it('ignores <redacted> key slots so a re-import does not clobber live keys', () => {
    const csv = [
      'section,key,value_json',
      `meta,version,${csvCell(1)}`,
      `config,provider,${csvCell('openrouter')}`,
      `config,providerApiKeys,${csvCell({
        openrouter: '<redacted>',
        lmstudio: '',
        claude: '',
        chatgpt: '',
        grok: '',
        minimax: '<redacted>',
      })}`,
    ].join('\r\n');
    const snap = service.parseState(csv);
    expect(snap.providerApiKeys).toEqual({
      openrouter: '',
      lmstudio: '',
      claude: '',
      chatgpt: '',
      grok: '',
      minimax: '',
    });
  });

  it('rejects unknown CSV row identifiers', () => {
    const csv = [
      'section,key,value_json',
      `meta,version,${csvCell(1)}`,
      `config,bogusKey,${csvCell(42)}`,
    ].join('\r\n');
    expect(() => service.parseState(csv)).toThrow(/Unknown CSV row/);
  });

  it('rejects duplicate CSV rows', () => {
    const csv = [
      'section,key,value_json',
      `meta,version,${csvCell(1)}`,
      `config,provider,${csvCell('openrouter')}`,
      `config,provider,${csvCell('anthropic')}`,
    ].join('\r\n');
    expect(() => service.parseState(csv)).toThrow(/Duplicate/);
  });
});

describe('StateExportService — applySnapshot key handling', () => {
  let service: StateExportService;
  let store: FakeStore;

  beforeEach(() => {
    store = new FakeStore();
    store.replaceState.mockImplementation((snapshot: unknown) => {
      (store as unknown as { _lastReplace: unknown })._lastReplace = snapshot;
    });
    TestBed.configureTestingModule({
      providers: [{ provide: ProjectStore, useValue: store }],
    });
    service = TestBed.inject(StateExportService);
  });

  it('strips providerApiKeys by default — import never overwrites live keys', () => {
    const snapshot = {
      version: 1 as const,
      exportedAt: '2026-08-21T00:00:00.000Z',
      config: {
        provider: 'openrouter' as const,
        providerConfigs: {
          ...defaultProviderConfigs(),
          openrouter: {
            selectedModel: 'openrouter/x',
            customBaseUrl: 'http://localhost:1234/v1',
            defaultTemperature: 0.2,
            defaultMaxTokens: 16384,
          },
        },
        auditRepairMaxAttempts: 1,
        parallelSectionConcurrency: 6,
        plannerMaxAttempts: 30,
        requestTimeoutMs: 90_000,
      },
      providerApiKeys: {
        openrouter: 'injected-key',
        lmstudio: '',
        claude: '',
        chatgpt: '',
        grok: '',
        minimax: '',
      },
      plan: null,
      tokenStats: null,
      markdownOverrides: {},
      savedPlans: [],
    };
    service.applySnapshot(snapshot);
    const last = (store as any)._lastReplace as typeof snapshot;
    expect(last.providerApiKeys).toEqual({
      openrouter: '',
      lmstudio: '',
      claude: '',
      chatgpt: '',
      grok: '',
      minimax: '',
    });
  });

  it('honours includeKeys: true when the caller explicitly opts in', () => {
    const snapshot = {
      version: 1 as const,
      exportedAt: '2026-08-21T00:00:00.000Z',
      config: {
        provider: 'openrouter' as const,
        providerConfigs: {
          ...defaultProviderConfigs(),
          openrouter: {
            selectedModel: 'openrouter/x',
            customBaseUrl: 'http://localhost:1234/v1',
            defaultTemperature: 0.2,
            defaultMaxTokens: 16384,
          },
        },
        auditRepairMaxAttempts: 1,
        parallelSectionConcurrency: 6,
        plannerMaxAttempts: 30,
        requestTimeoutMs: 90_000,
      },
      providerApiKeys: {
        openrouter: 'restored-key',
        lmstudio: '',
        claude: '',
        chatgpt: '',
        grok: '',
        minimax: '',
      },
      plan: null,
      tokenStats: null,
      markdownOverrides: {},
      savedPlans: [],
    };
    service.applySnapshot(snapshot, { includeKeys: true });
    const last = (store as any)._lastReplace as typeof snapshot;
    expect(last.providerApiKeys.openrouter).toBe('restored-key');
  });
});

describe('STATE_SNAPSHOT_ROW_IDS — drift detection', () => {
  it('contains a row for every key of PlannerConfigState', () => {



    const configKeys: ReadonlyArray<keyof PlannerConfigState> = [
      'provider',
      'providerConfigs',
      'auditRepairMaxAttempts',
      'parallelSectionConcurrency',
      'plannerMaxAttempts',
      'requestTimeoutMs',
    ];
    for (const k of configKeys) {
      expect(STATE_SNAPSHOT_ROW_IDS).toContain(`config:${String(k)}`);
    }
  });

  it('has unique row ids (no duplicates)', () => {
    const seen = new Set<string>();
    for (const id of STATE_SNAPSHOT_ROW_IDS) {
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });

  it('rejects an unknown CSV row id via parseState', () => {
    const csv = [
      'section,key,value_json',
      'meta,version,1',
      'meta,exportedAt,"""2026-01-01T00:00:00.000Z"""',
      'config,provider,"""openrouter"""',
      'config,NOT_A_REAL_FIELD,42',
    ].join('\n');
    const service = TestBed.inject(StateExportService);
    expect(() => service.parseState(csv)).toThrow(/Unknown CSV row: config:NOT_A_REAL_FIELD/);
  });
});
