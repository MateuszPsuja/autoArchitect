import { inject, Injectable } from '@angular/core';
import Papa from 'papaparse';
import { PlannerError } from './planner-error.model';
import { ProjectStore, defaultProviderConfigs } from './project.store';
import { StateSnapshot, STATE_SNAPSHOT_ROW_IDS } from './state-snapshot.model';

const HEADER = 'section,key,value_json';
const EMPTY_KEYS = {
  openrouter: '',
  lmstudio: '',
  claude: '',
  chatgpt: '',
  grok: '',
  minimax: '',
} as const;

const ALLOWED_ROW_IDS: ReadonlySet<string> = new Set(STATE_SNAPSHOT_ROW_IDS);

const REDACTED = '<redacted>' as const;

type Row = { section: string; key: string; value: unknown };

export class CsvCodec {
  static encode(rows: Row[]): string {
    return [
      HEADER,
      ...rows.map((row) => [row.section, row.key, JSON.stringify(row.value)].map(quote).join(',')),
    ].join('\r\n');
  }

  static decode(csv: string): Row[] {
    const parsed = Papa.parse<string[]>(csv, {
      header: false,
      skipEmptyLines: true,
    });
    const records = parsed.data;
    if (records.length === 0 || records[0].join(',') !== HEADER) {
      throw csvError('CSV header must be section,key,value_json');
    }
    return records.slice(1).map((r) => {
      if (r.length !== 3) throw csvError('CSV row must contain exactly three fields');
      try {
        return { section: r[0], key: r[1], value: JSON.parse(r[2]) };
      } catch (error) {
        throw csvError(
          `Invalid JSON for ${r[0]}:${r[1]}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    });
  }
}

export interface ExportStateOptions {

  redactApiKeys?: boolean;
}

@Injectable({ providedIn: 'root' })
export class StateExportService {
  private readonly store = inject(ProjectStore);

  buildSnapshot(): StateSnapshot {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      config: { ...this.store.config() },
      providerApiKeys: { ...this.store.providerApiKeys() },
      plan: this.store.plan(),
      tokenStats: this.store.tokenStats(),
      markdownOverrides: { ...this.store.markdownOverrides() },
      savedPlans: this.store.savedPlans(),
    };
  }

  exportState(options: ExportStateOptions = {}): string {
    const { redactApiKeys = true } = options;
    const snapshot = this.buildSnapshot();
    return CsvCodec.encode([
      { section: 'meta', key: 'version', value: snapshot.version },
      { section: 'meta', key: 'exportedAt', value: snapshot.exportedAt },
      ...Object.entries(snapshot.config).map(([key, value]) => ({
        section: 'config',
        key,
        value,
      })),
      {
        section: 'config',
        key: 'providerApiKeys',
        value: redactApiKeys ? this.redactKeys(snapshot.providerApiKeys) : snapshot.providerApiKeys,
      },
      { section: 'plan', key: 'plan', value: snapshot.plan },
      { section: 'plan', key: 'tokenStats', value: snapshot.tokenStats },
      { section: 'plan', key: 'markdownOverrides', value: snapshot.markdownOverrides },
      { section: 'plans', key: 'savedPlans', value: snapshot.savedPlans },
    ]);
  }

  parseState(csv: string): StateSnapshot {
    const rows = CsvCodec.decode(csv);
    const values = new Map<string, unknown>();
    for (const row of rows) {
      const id = `${row.section}:${row.key}`;
      if (values.has(id)) throw csvError(`Duplicate CSV row: ${id}`);
      if (!ALLOWED_ROW_IDS.has(id)) throw csvError(`Unknown CSV row: ${id}`);
      values.set(id, row.value);
    }
    if (values.get('meta:version') !== undefined && values.get('meta:version') !== 1) {
      throw csvError('Unsupported snapshot version');
    }



    const customBaseUrl =
      (values.get('config:customBaseUrl') as string | undefined) ??
      (values.get('config:lmStudioBaseUrl') as string | undefined) ??
      'http://localhost:1234/v1';

    const provider =
      (values.get('config:provider') as StateSnapshot['config']['provider']) ?? 'openrouter';
    const providerConfigs =
      (values.get('config:providerConfigs') as
        | StateSnapshot['config']['providerConfigs']
        | undefined) ??



      ({
        ...defaultProviderConfigs(),
        [provider]: {
          selectedModel: (values.get('config:selectedModel') as string) ?? '',
          customBaseUrl,
          defaultTemperature: (values.get('config:defaultTemperature') as number) ?? 0.2,
          defaultMaxTokens: Math.max(
            (values.get('config:defaultMaxTokens') as number) ?? 16_384,
            16_384,
          ),
        },
      } as StateSnapshot['config']['providerConfigs']);

    const config = {
      provider,
      providerConfigs,
      auditRepairMaxAttempts:
        (values.get('config:auditRepairMaxAttempts') as number) ?? 1,
      parallelSectionConcurrency:
        (values.get('config:parallelSectionConcurrency') as number) ?? 6,
      plannerMaxAttempts:
        (values.get('config:plannerMaxAttempts') as number) ?? 75,
      requestTimeoutMs:
        (values.get('config:requestTimeoutMs') as number) ?? 90_000,
    } as StateSnapshot['config'];

    return {
      version: 1,
      exportedAt: String(values.get('meta:exportedAt') ?? ''),
      config,



      providerApiKeys: {
        ...EMPTY_KEYS,
        ...this.stripRedactedKeys(
          (values.get('config:providerApiKeys') as Record<string, string> | undefined) ?? {},
        ),
      },
      plan: (values.get('plan:plan') as StateSnapshot['plan']) ?? null,
      tokenStats: (values.get('plan:tokenStats') as StateSnapshot['tokenStats']) ?? null,
      markdownOverrides:
        (values.get('plan:markdownOverrides') as Record<string, string> | undefined) ?? {},
      savedPlans: (values.get('plans:savedPlans') as StateSnapshot['savedPlans'] | undefined) ?? [],
    };
  }

  applySnapshot(snapshot: StateSnapshot, options: { includeKeys?: boolean } = {}): void {
    const sanitized = options.includeKeys
      ? snapshot
      : { ...snapshot, providerApiKeys: { ...EMPTY_KEYS } };
    this.store.replaceState(sanitized);
  }

  downloadSnapshot(options: ExportStateOptions = {}): void {
    const csv = this.exportState(options);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `auto-architect-state-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  importFromFile(file: File, options: { includeKeys?: boolean } = {}): Promise<StateSnapshot> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const snapshot = this.parseState(String(reader.result ?? ''));



          const sanitized = options.includeKeys
            ? snapshot
            : { ...snapshot, providerApiKeys: { ...EMPTY_KEYS } };
          resolve(sanitized);
        } catch (error) {
          const plannerError = error as PlannerError;
          this.store.setError(plannerError);
          reject(error);
        }
      };
      reader.onerror = () => {
        const error = csvError('Unable to read snapshot file');
        this.store.setError(error);
        reject(error);
      };
      reader.readAsText(file, 'utf-8');
    });
  }

  private redactKeys(keys: Record<string, string>): Record<string, typeof REDACTED | string> {
    const out: Record<string, string> = {};
    for (const [slot, value] of Object.entries(keys)) {
      out[slot] = value ? REDACTED : '';
    }
    return out;
  }

  private stripRedactedKeys(keys: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [slot, value] of Object.entries(keys)) {
      if (value === REDACTED || value === '') continue;
      out[slot] = value;
    }
    return out;
  }
}

function quote(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
function csvError(message: string): PlannerError {
  return { type: 'invalid_json', message, raw: message };
}
