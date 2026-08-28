/**
 * lib/core/cache.ts
 *
 * Cache abstraction (locked decision #1): in-memory LRU+TTL today, behind a
 * `CacheStore` interface so a shared backend (Upstash/Redis) can be dropped in
 * later with ZERO call-site changes.
 *
 * Usage:
 *   import { cache } from "@/lib/core/cache";
 *   const hit = await cache.get<Menu>(key);
 *   await cache.set(key, value, 60_000);
 *   const v = await cache.getOrSet(key, 60_000, () => loadMenu());
 *
 * To swap backends later: implement CacheStore (e.g. RedisCacheStore) and set
 * `setCacheStore(new RedisCacheStore(...))` at startup.
 */

export interface CacheStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
  del(key: string): Promise<void>;
  delByPrefix(prefix: string): Promise<void>;
  /** Load-through helper: returns cached value or computes, stores, and returns it. */
  getOrSet<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T>;
}

interface Entry<T> {
  value: T;
  expiresAt: number;
}

/**
 * In-memory store with TTL + LRU eviction. Per-instance (serverless-local);
 * acceptable for menu/settings/embedding-query caches. Eviction bounds memory.
 */
export class InMemoryCacheStore implements CacheStore {
  private store = new Map<string, Entry<unknown>>();
  private inflight = new Map<string, Promise<unknown>>();
  private readonly maxEntries: number;

  constructor(maxEntries = 5000) {
    this.maxEntries = maxEntries;
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    // LRU touch: re-insert to move to the end of iteration order.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      // Evict least-recently-used (first key in insertion/iteration order).
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async delByPrefix(prefix: string): Promise<void> {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  async getOrSet<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    // De-duplicate concurrent loads for the same key (stampede protection).
    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    const promise = (async () => {
      try {
        const value = await loader();
        await this.set(key, value, ttlMs);
        return value;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, promise);
    return promise;
  }
}

let activeStore: CacheStore = new InMemoryCacheStore();

/** Swap the backend at startup (e.g. Redis) without touching call sites. */
export function setCacheStore(store: CacheStore): void {
  activeStore = store;
}

/** The process-wide cache. Import this everywhere. */
export const cache: CacheStore = {
  get: (k) => activeStore.get(k),
  set: (k, v, ttl) => activeStore.set(k, v, ttl),
  del: (k) => activeStore.del(k),
  delByPrefix: (p) => activeStore.delByPrefix(p),
  getOrSet: (k, ttl, loader) => activeStore.getOrSet(k, ttl, loader),
};
