/**
 * Safe wrappers around `localStorage.getItem` / `setItem` / `removeItem`
 * that swallow exceptions (privacy mode, blocked storage, no
 * `globalThis.localStorage`) and return `null` / no-op rather than throwing.
 *
 * Keys are passed in by the caller — this module does not know about any
 * specific key naming convention; callers should reuse `STORAGE_KEYS` from
 * `./persistence.constants` so the canonical key registry stays the single
 * source of truth.
 */

export function safeGetItem(key: string): string | null {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      return globalThis.localStorage.getItem(key);
    }
  } catch {

  }
  return null;
}

export function safeSetItem(key: string, value: string): void {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      globalThis.localStorage.setItem(key, value);
    }
  } catch {

  }
}

export function safeRemoveItem(key: string): void {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      globalThis.localStorage.removeItem(key);
    }
  } catch {

  }
}
