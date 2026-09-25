/**
 * Canonical constants referenced by the spec-kit `spec.md` renderer. These
 * IDs are part of the public contract with downstream analysers (e.g.
 * `/speckit-analyze`), so any rename here must be coordinated with the
 * analyser rule set.
 */

export const SC001_DEFAULT_SCENARIO =
  'warm session, single avatar, 10 Mbps down / 2 Mbps up, baseline laptop (Intel i5 / 16 GB), concurrent avatars = 1, sample size n=30';

export const SC003_BASELINE_DEFINITION =
  '"warm session = ≤3 min idle; cold session = ≥24 h idle"';

export const NON_GOALS_SEED: ReadonlyArray<string> = [
  'Multi-user / multi-tenant',
  'Mobile platform',
  'SSR rendering',
  'Voice / avatar marketplace',
];

export const GLOSSARY_SEED: ReadonlyArray<{ term: string; definition: string }> = [
  { term: 'bounded context', definition: 'A DDD-aligned code ownership boundary with its own ubiquitous language.' },
  { term: 'sidecar', definition: 'A local process that exposes the LLM/STT/TTS endpoints to the browser via HTTP.' },
  { term: 'BFF', definition: 'Backend-for-frontend: an application-layer facade shaped to the SPA surface.' },
  { term: 'signalStore', definition: 'NgRx signal-based reactive state container; mutations only via patchState().' },
  { term: 'OPFS', definition: 'Origin Private File System; the browser storage target for cached avatars and transcripts.' },
  { term: 'p95', definition: '95th percentile latency; the SLO measure used for every time-budget SC.' },
  { term: 'warm session', definition: 'A user session that has had activity within the last 3 minutes (see SC-003 baseline).' },
];

export const OPEN_QUESTIONS_ANCHOR = '<!-- anchor: open-questions -->';

export const MULTI_TENANT_BAN_WARNING =
  '⚠️ MULTI-TENANT-BAN VIOLATION: sidecar binds 0.0.0.0';
