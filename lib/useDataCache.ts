/**
 * useDataCache — Stale-While-Revalidate cache for dashboard API calls.
 *
 * HOW IT WORKS
 * ─────────────
 * A module-level Map stores the last successful fetch result for every URL.
 * When a component mounts:
 *  1. If cached data exists → shown immediately (zero wait, no skeleton).
 *  2. A background refetch is always triggered to keep data fresh.
 *  3. `isLoading` is `true` only on the very first load (no cached data).
 *  4. `isRevalidating` is `true` during a background refresh (no skeleton shown).
 *
 * The cache lives at module scope: persists across Next.js client-side
 * navigations (tab switches) but is wiped on a full page refresh.
 */

import { useEffect, useRef, useState, useCallback } from "react";

interface CacheEntry<T> {
  data: T;
  cachedAt: number;
}

// Module-level cache — survives SPA navigations, wiped on full reload.
const cache = new Map<string, CacheEntry<unknown>>();

export interface DataCacheState<T> {
  data: T | null;
  isLoading: boolean;       // true only on first load (cache miss)
  isRevalidating: boolean;  // true during silent background refresh
  error: Error | null;
  revalidate: () => void;   // manually trigger a background refresh
}

/**
 * Clear all cache entries matching a URL prefix.
 * Call after mutations so the next render fetches fresh data.
 */
export function invalidateCache(urlPrefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(urlPrefix)) {
      cache.delete(key);
    }
  }
}

/**
 * Stale-while-revalidate hook.
 *
 * @param url  The URL to fetch. Pass `null` to suspend fetching.
 *
 * @example
 * const { data, isLoading } = useDataCache<Order[]>(ordersUrl);
 */
export function useDataCache<T>(url: string | null): DataCacheState<T> {
  // Track the latest URL so in-flight responses for stale URLs are discarded.
  const latestUrlRef = useRef<string | null>(null);
  // A counter we can increment to force a revalidation.
  const [revalidationCount, setRevalidationCount] = useState(0);

  const [state, setState] = useState<Omit<DataCacheState<T>, "revalidate">>(() => {
    // Synchronous initialisation from cache (instant render with cached data).
    if (url) {
      const entry = cache.get(url) as CacheEntry<T> | undefined;
      if (entry) {
        return {
          data: entry.data,
          isLoading: false,
          isRevalidating: true, // will background-refresh on first effect
          error: null,
        };
      }
    }
    return { data: null, isLoading: true, isRevalidating: false, error: null };
  });

  useEffect(() => {
    if (!url) {
      setState({ data: null, isLoading: false, isRevalidating: false, error: null });
      return;
    }

    latestUrlRef.current = url;

    // Check cache — serve stale data immediately while we refetch.
    const cached = cache.get(url) as CacheEntry<T> | undefined;
    if (cached) {
      setState({
        data: cached.data,
        isLoading: false,
        isRevalidating: true,
        error: null,
      });
    } else {
      setState((prev) => ({ ...prev, isLoading: true, isRevalidating: false, error: null }));
    }

    let cancelled = false;

    const doFetch = async () => {
      try {
        const response = await fetch(url, {
          headers: { "ngrok-skip-browser-warning": "69420" },
        });

        if (cancelled || latestUrlRef.current !== url) return;

        if (!response.ok) {
          throw new Error(`Request failed: ${response.status} ${response.statusText}`);
        }

        const data = (await response.json()) as T;

        if (cancelled || latestUrlRef.current !== url) return;

        cache.set(url, { data, cachedAt: Date.now() });
        setState({ data, isLoading: false, isRevalidating: false, error: null });
      } catch (err) {
        if (cancelled || latestUrlRef.current !== url) return;
        setState((prev) => ({
          ...prev,
          isLoading: false,
          isRevalidating: false,
          error: err instanceof Error ? err : new Error(String(err)),
        }));
      }
    };

    void doFetch();

    return () => {
      cancelled = true;
    };
    // revalidationCount is used as a manual "bump" to re-run this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, revalidationCount]);

  const revalidate = useCallback(() => {
    setRevalidationCount((c) => c + 1);
  }, []);

  return { ...state, revalidate };
}
