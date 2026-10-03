import { safeGetItem, safeRemoveItem, safeSetItem } from './storage.utils';

class MemoryStorage {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
}

function setLocalStorage(value: Storage | undefined): void {
  Object.defineProperty(globalThis, 'localStorage', {
    value,
    configurable: true,
    writable: true,
  });
}

describe('storage.utils', () => {
  const ORIGINAL_LOCAL_STORAGE = (globalThis as { localStorage?: Storage }).localStorage;

  afterEach(() => {
    setLocalStorage(ORIGINAL_LOCAL_STORAGE);
  });

  describe('safeGetItem', () => {
    it('returns null when the key is missing', () => {
      const mem = new MemoryStorage();
      setLocalStorage(mem as unknown as Storage);
      expect(safeGetItem('arc-planner:missing')).toBeNull();
    });

    it('returns the stored value when the key exists', () => {
      const mem = new MemoryStorage();
      mem.setItem('arc-planner:plan', '{"ok":true}');
      setLocalStorage(mem as unknown as Storage);
      expect(safeGetItem('arc-planner:plan')).toBe('{"ok":true}');
    });

    it('returns null when localStorage throws', () => {
      setLocalStorage({
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => undefined,
        removeItem: () => undefined,
        clear: () => undefined,
        key: () => null,
        length: 0,
      } as unknown as Storage);
      expect(safeGetItem('arc-planner:plan')).toBeNull();
    });

    it('returns null when globalThis.localStorage is undefined', () => {
      setLocalStorage(undefined);
      expect(safeGetItem('arc-planner:plan')).toBeNull();
    });
  });

  describe('safeRemoveItem', () => {
    it('removes an existing key', () => {
      const mem = new MemoryStorage();
      mem.setItem('arc-planner:plan', 'x');
      setLocalStorage(mem as unknown as Storage);
      safeRemoveItem('arc-planner:plan');
      expect(mem.getItem('arc-planner:plan')).toBeNull();
    });

    it('is a no-op for a missing key', () => {
      const mem = new MemoryStorage();
      setLocalStorage(mem as unknown as Storage);
      expect(() => safeRemoveItem('arc-planner:absent')).not.toThrow();
    });

    it('does not throw when localStorage throws', () => {
      setLocalStorage({
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => {
          throw new Error('blocked');
        },
        clear: () => undefined,
        key: () => null,
        length: 0,
      } as unknown as Storage);
      expect(() => safeRemoveItem('arc-planner:plan')).not.toThrow();
    });
  });

  describe('safeSetItem', () => {
    it('persists the value via localStorage', () => {
      const mem = new MemoryStorage();
      setLocalStorage(mem as unknown as Storage);
      safeSetItem('arc-planner:plan', 'v1');
      expect(mem.getItem('arc-planner:plan')).toBe('v1');
    });

    it('does not throw when localStorage throws', () => {
      setLocalStorage({
        getItem: () => null,
        setItem: () => {
          throw new Error('blocked');
        },
        removeItem: () => undefined,
        clear: () => undefined,
        key: () => null,
        length: 0,
      } as unknown as Storage);
      expect(() => safeSetItem('arc-planner:plan', 'v1')).not.toThrow();
    });

    it('is a no-op when globalThis.localStorage is undefined', () => {
      setLocalStorage(undefined);
      expect(() => safeSetItem('arc-planner:plan', 'v1')).not.toThrow();
    });
  });
});
