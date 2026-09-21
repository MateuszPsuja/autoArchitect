import { Plan } from '../plan.schema';

export type ElementKind =
  | 'architectureLayer'
  | 'domain'
  | 'boundedContext'
  | 'adr'
  | 'workflow'
  | 'agentTask';

export interface ElementRef {
  kind: ElementKind;
  id: string;
  name: string;
}

export interface FieldChange {
  path: string;
  from: unknown;
  to: unknown;
}

export interface AddedElement {
  kind: ElementKind;
  id: string;
  name: string;
  element: unknown;
}

export interface UserEditSummary {
  capturedAt: string;
  preservedFilePaths: string[];
  addedElements: AddedElement[];
  removedElements: ElementRef[];
  fieldChanges: FieldChange[];
  naturalLanguageDigest: string;
}

interface ArrayFieldSpec {
  kind: ElementKind;
  field: string;
  idOf: (entry: unknown) => string | null;
  nameOf: (entry: unknown) => string;
  element: unknown;
}

const DESCRIPTION_TRUNCATE_LIMIT = 120;

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const aKeys = Object.keys(ao);
    const bKeys = Object.keys(bo);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(bo, key)) return false;
      if (!deepEqual(ao[key], bo[key])) return false;
    }
    return true;
  }
  return false;
}

function truncate(value: unknown, limit = DESCRIPTION_TRUNCATE_LIMIT): string {
  if (typeof value !== 'string') return JSON.stringify(value);
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}…`;
}

function keyFor(kind: ElementKind, id: string): string {
  return `${kind}:${id}`;
}

function idOf(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object') return null;
  const id = (entry as Record<string, unknown>)['id'];
  return typeof id === 'string' ? id : null;
}

function nameOf(entry: unknown): string {
  if (!entry || typeof entry !== 'object') return '';
  const record = entry as Record<string, unknown>;
  if (typeof record['name'] === 'string') return record['name'] as string;
  if (typeof record['title'] === 'string') return record['title'] as string;
  return (record['id'] as string | undefined) ?? '';
}

function collectArrayFields(current: Plan, baseline: Plan): ArrayFieldSpec[] {
  const specs: ArrayFieldSpec[] = [];
  const cur = current as unknown as Record<string, unknown>;
  const bas = baseline as unknown as Record<string, unknown>;
  const candidates: { kind: ElementKind; field: string }[] = [
    { kind: 'boundedContext', field: 'boundedContexts' },
    { kind: 'architectureLayer', field: 'architectureLayers' },
    { kind: 'domain', field: 'domains' },
    { kind: 'workflow', field: 'workflows' },
    { kind: 'adr', field: 'adrs' },
    { kind: 'agentTask', field: 'agentTasks' },
  ];
  for (const c of candidates) {
    const list = cur[c.field];
    if (Array.isArray(list)) {
      specs.push({ kind: c.kind, field: c.field, idOf, nameOf, element: list });
    } else if (Array.isArray(bas[c.field])) {
      specs.push({ kind: c.kind, field: c.field, idOf, nameOf, element: list ?? [] });
    }
  }
  return specs;
}

function diffArrayField(
  spec: ArrayFieldSpec,
  current: Plan,
  baseline: Plan,
): { added: AddedElement[]; removed: ElementRef[]; fieldChanges: FieldChange[] } {
  const cur = ((current as unknown as Record<string, unknown>)[spec.field] as unknown[]) ?? [];
  const bas = ((baseline as unknown as Record<string, unknown>)[spec.field] as unknown[]) ?? [];
  const baseMap = new Map<string, { entry: unknown; index: number }>();
  const nextMap = new Map<string, { entry: unknown; index: number }>();
  bas.forEach((entry, index) => {
    const id = spec.idOf(entry);
    if (!id) return;
    baseMap.set(keyFor(spec.kind, id), { entry, index });
  });
  cur.forEach((entry, index) => {
    const id = spec.idOf(entry);
    if (!id) return;
    nextMap.set(keyFor(spec.kind, id), { entry, index });
  });

  const added: AddedElement[] = [];
  const removed: ElementRef[] = [];
  const fieldChanges: FieldChange[] = [];

  for (const [key, value] of nextMap.entries()) {
    if (!baseMap.has(key)) {
      const id = key.split(':')[1] ?? key;
      const name = spec.nameOf(value.entry);
      added.push({ kind: spec.kind, id, name, element: value.entry });
    }
  }

  for (const [key, value] of baseMap.entries()) {
    if (!nextMap.has(key)) {
      const id = key.split(':')[1] ?? key;
      const name = spec.nameOf(value.entry);
      removed.push({ kind: spec.kind, id, name });
    }
  }

  for (const [key, baseValue] of baseMap.entries()) {
    const nextValue = nextMap.get(key);
    if (!nextValue) continue;
    const index = baseValue.index;
    const basePath = `${spec.field}[${index}]`;
    const diffs = collectFieldDiffs(baseValue.entry, nextValue.entry, basePath);
    fieldChanges.push(...diffs);
  }

  return { added, removed, fieldChanges };
}

function collectFieldDiffs(base: unknown, next: unknown, basePath: string, prefix = ''): FieldChange[] {
  if (deepEqual(base, next)) return [];
  if (prefix === '' && (typeof base !== 'object' || base === null || typeof next !== 'object' || next === null || Array.isArray(base) || Array.isArray(next))) {
    return [{ path: basePath, from: base, to: next }];
  }
  if (Array.isArray(base) && Array.isArray(next)) {
    if (base.length !== next.length) {
      return [{ path: basePath, from: base, to: next }];
    }
    const out: FieldChange[] = [];
    for (let i = 0; i < base.length; i += 1) {
      out.push(...collectFieldDiffs(base[i], next[i], `${basePath}[${i}]`, `${prefix}[${i}]`));
    }
    return out;
  }
  if (typeof base === 'object' && base !== null && typeof next === 'object' && next !== null && !Array.isArray(base) && !Array.isArray(next)) {
    const bo = base as Record<string, unknown>;
    const no = next as Record<string, unknown>;
    const keys = new Set<string>([...Object.keys(bo), ...Object.keys(no)]);
    const out: FieldChange[] = [];
    for (const key of keys) {
      const childPath = `${basePath}.${key}`;
      const childPrefix = `${prefix}.${key}`;
      if (!Object.prototype.hasOwnProperty.call(bo, key)) {
        out.push({ path: childPath, from: undefined, to: no[key] });
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(no, key)) {
        out.push({ path: childPath, from: bo[key], to: undefined });
        continue;
      }
      out.push(...collectFieldDiffs(bo[key], no[key], childPath, childPrefix));
    }
    return out;
  }
  return [{ path: basePath, from: base, to: next }];
}

function diffNonArrayFields(current: Plan, baseline: Plan): FieldChange[] {
  const out: FieldChange[] = [];
  const scalar: { field: string }[] = [
    { field: 'meta' },
    { field: 'systemOverview' },
  ];
  for (const { field } of scalar) {
    const baseVal = (baseline as unknown as Record<string, unknown>)[field];
    const nextVal = (current as unknown as Record<string, unknown>)[field];
    if (!deepEqual(baseVal, nextVal)) {
      out.push(...collectFieldDiffs(baseVal, nextVal, field, field));
    }
  }
  return out;
}

export function computeUserEditSummary(
  current: Plan,
  baseline: Plan,
  overrides: Record<string, string>,
): UserEditSummary | null {
  const overridePaths = Object.keys(overrides ?? {}).sort();
  const arraySpecs = collectArrayFields(current, baseline);

  const added: AddedElement[] = [];
  const removed: ElementRef[] = [];
  const fieldChanges: FieldChange[] = [];

  for (const spec of arraySpecs) {
    const diff = diffArrayField(spec, current, baseline);
    added.push(...diff.added);
    removed.push(...diff.removed);
    fieldChanges.push(...diff.fieldChanges);
  }

  fieldChanges.push(...diffNonArrayFields(current, baseline));

  const hasOverrides = overridePaths.length > 0;
  if (!hasOverrides && added.length === 0 && removed.length === 0 && fieldChanges.length === 0) {
    return null;
  }

  return {
    capturedAt: new Date().toISOString(),
    preservedFilePaths: overridePaths,
    addedElements: added,
    removedElements: removed,
    fieldChanges,
    naturalLanguageDigest: renderDigest(overridePaths, removed, added, fieldChanges),
  };
}

function renderDigest(
  overridePaths: string[],
  removed: ElementRef[],
  added: AddedElement[],
  fieldChanges: FieldChange[],
): string {
  const sections: string[] = [
    'The user changed the plan since generation. Treat as follows:',
  ];

  if (overridePaths.length > 0) {
    sections.push(
      '- Markdown files (literal text wins, will be re-applied as overrides):',
      ...overridePaths.map((p) => `  - ${p}`),
    );
  }

  if (removed.length > 0) {
    sections.push(
      '- Removed elements (omit from output; do not re-add in any section):',
      ...removed.map((e) => `  - ${e.kind}[id=${e.id}, name=${e.name}]`),
    );
  }

  if (added.length > 0) {
    sections.push(
      '- Added elements (keep id and name verbatim; expand other fields for coherence):',
      ...added.map((a) => {
        const desc = describeElement(a.element);
        return `  - ${a.kind}[id=${a.id}, name=${a.name}${desc ? `, ${desc}` : ''}]`;
      }),
    );
  }

  if (fieldChanges.length > 0) {
    sections.push(
      '- Modified fields (treat as guidance, may rewrite for coherence; stay conservative on unchanged fields):',
      ...fieldChanges.map((c) => `  - ${c.path}: ${truncate(c.from)} -> ${truncate(c.to)}`),
    );
  }

  if (hasTechStackChange(fieldChanges)) {
    sections.push(
      '- TECH STACK LOCKED — treat architectureLayers[].techStack as HARD requirements.',
      '  The user has explicitly chosen these technologies. Use them verbatim for the',
      '  named layer. Do not propose substitutes or alternative stacks. Adjust dependent',
      '  fields (patterns, technicalContext, directoryStructure,',
      '  component dependencies) to match the chosen stack.',
    );
  }

  return sections.join('\n');
}

const TECH_STACK_PATH = /^architectureLayers\[\d+\]\.techStack(?:\[\d+\])?$/;

function hasTechStackChange(fieldChanges: FieldChange[]): boolean {
  return fieldChanges.some((c) => TECH_STACK_PATH.test(c.path));
}

function describeElement(element: unknown): string {
  if (!element || typeof element !== 'object') return '';
  const record = element as Record<string, unknown>;
  if (typeof record['description'] === 'string') {
    return `description=${truncate(record['description'])}`;
  }
  if (typeof record['purpose'] === 'string') {
    return `purpose=${truncate(record['purpose'])}`;
  }
  return '';
}

export function elementKey(kind: ElementKind, id: string): string {
  return keyFor(kind, id);
}
