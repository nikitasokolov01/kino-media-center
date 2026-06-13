// In-memory cache for Home page catalog rows.
//
// Motivation: navigating away from Home (e.g. to Library) and back causes all
// catalog rows to refetch, producing a visible blank-then-populate flash. This
// module caches fetched catalog items per profile+addon+catalog so that the
// second visit is instant.
//
// Cache key: "<profileId>:<addonId>:<type>:<catalogId>"
// TTL: 15 minutes — long enough for a normal browsing session.
//
// Only catalog metadata (StremioCatalogItem[]) is cached.
// Stream URLs and source lists are never stored here.
//
// Invalidation:
//   - invalidateHomeCatalogCache(profileId) wipes all entries for a profile.
//     Call this after installing or removing an addon.
//   - clearExpiredHomeCatalogCache() prunes stale entries; called lazily on
//     every cache read so the map never grows unbounded.

import type { StremioCatalogItem } from "../stremio/types.js";

// ---- Constants ---------------------------------------------------------------

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

// ---- Types -------------------------------------------------------------------

interface CacheEntry {
  items: StremioCatalogItem[];
  timestamp: number;
}

// ---- Module-level store ------------------------------------------------------

const store = new Map<string, CacheEntry>();

// ---- Key construction --------------------------------------------------------

export function makeHomeCacheKey(
  profileId: number,
  addonId: string,
  type: string,
  catalogId: string,
): string {
  return `${profileId}:${addonId}:${type}:${catalogId}`;
}

// ---- Cache operations --------------------------------------------------------

/** Prune expired entries. Called lazily so the map stays lean. */
export function clearExpiredHomeCatalogCache(): void {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      store.delete(key);
    }
  }
}

/**
 * Return cached items if present and still fresh, null otherwise.
 * Also prunes expired entries on every read.
 */
export function getHomeCatalogCache(key: string): StremioCatalogItem[] | null {
  clearExpiredHomeCatalogCache();
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    store.delete(key);
    return null;
  }
  return entry.items;
}

/** Store fetched items. Overwrites any existing entry for this key. */
export function setHomeCatalogCache(
  key: string,
  items: StremioCatalogItem[],
): void {
  store.set(key, { items, timestamp: Date.now() });
}

/**
 * Invalidate all cached entries for a given profile.
 * Call after the user adds or removes an addon so the next Home visit
 * shows fresh data rather than the now-stale cached rows.
 */
export function invalidateHomeCatalogCache(profileId: number): void {
  const prefix = `${profileId}:`;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
    }
  }
}

/** Wipe the entire cache (e.g. on profile switch). */
export function clearAllHomeCatalogCache(): void {
  store.clear();
}
