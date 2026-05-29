// Source prefetch + short-lived in-memory cache for the Next Episode pipeline.
//
// Motivation: when the embedded player approaches the end of an episode, we
// want the next episode's source list ready so the "Next Episode" button can
// start playback immediately. Fetching happens in the background while the
// current episode is still playing.
//
// Cache key: `${profileId}:${type}:${mediaId}:${playableId}`
// TTL: 7 minutes — long enough to cover a typical episode tail, short enough
// that stale URLs don't accumulate.
//
// URLs are NOT persisted to SQLite (direct stream URLs expire; only metadata
// and progress live in the DB).

import { addonSupportsResource } from "../stremio/meta.js";
import { streamDedupKey } from "../stremio/streams.js";
import type { StreamSourceResult, StremioStream } from "../stremio/types.js";
import type { AddonRow } from "../../types/preload.js";

const isDev =
  typeof process !== "undefined" && process.env.NODE_ENV !== "production";


// ── Cache ─────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 7 * 60 * 1000; // 7 minutes

interface CacheEntry {
  results: StreamSourceResult[];
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
// Track in-progress fetches so we don't double-fan-out for the same key.
const inFlight = new Set<string>();

export function makePrefetchKey(
  profileId: number,
  type: string,
  mediaId: string,
  playableId: string,
): string {
  return `${profileId}:${type}:${mediaId}:${playableId}`;
}

/** Returns cached source results if present and fresh, null otherwise. */
export function getCachedSources(key: string): StreamSourceResult[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.results;
}

export function setCachedSources(
  key: string,
  results: StreamSourceResult[],
): void {
  cache.set(key, { results, timestamp: Date.now() });
}

/** Evict a specific key (e.g. if the user manually refreshes sources). */
export function evictCachedSources(key: string): void {
  cache.delete(key);
}

export function clearPrefetchCache(): void {
  cache.clear();
  inFlight.clear();
}

// ── Prefetch ─────────────────────────────────────────────────────────────────

/**
 * Fire-and-forget: fan out to all eligible addons and cache the results.
 *
 * - If a fresh cache entry already exists, does nothing.
 * - If a fetch is already in flight for this key, does nothing.
 * - Failures from individual addons are silently ignored — we collect what we
 *   can and cache whatever comes back. A partial set is better than nothing.
 * - Never throws; never blocks the caller.
 */
export function prefetchEpisodeSources(
  addons: AddonRow[],
  type: string,
  mediaId: string,
  playableId: string,
  profileId: number,
): void {
  const key = makePrefetchKey(profileId, type, mediaId, playableId);

  // Already have fresh results.
  if (getCachedSources(key) !== null) {
    if (isDev) {
      console.log(`[prefetch] cache hit for ${type} ${playableId} — skipping fetch`);
    }
    return;
  }

  // Already fetching.
  if (inFlight.has(key)) {
    if (isDev) {
      console.log(`[prefetch] already in flight for ${type} ${playableId}`);
    }
    return;
  }

  const eligible = addons.filter((a) =>
    addonSupportsResource(a.manifest, "stream", type),
  );
  if (eligible.length === 0) {
    // Nothing to prefetch.
    setCachedSources(key, []);
    return;
  }

  if (isDev) {
    console.log(
      `[prefetch] starting background fetch for ${type} ${playableId} from ${eligible.length} addon(s)`,
    );
  }

  inFlight.add(key);

  void (async () => {
    try {
      const seen = new Set<string>();
      const collected: StreamSourceResult[] = [];

      await Promise.allSettled(
        eligible.map((a) =>
          window.mediaCenter.streams
            .fetch({ manifestUrl: a.manifestUrl, type, id: playableId })
            .then((res) => {
              (res.streams ?? []).forEach((s: StremioStream, i: number) => {
                const dk = streamDedupKey(s, `${a.id}#${i}`);
                if (seen.has(dk)) return;
                seen.add(dk);
                collected.push({
                  stream: s,
                  source: { addonId: a.id, addonName: a.manifest.name },
                  key: dk,
                });
              });
            })
            .catch(() => {
              // Per-addon failure is non-fatal — just skip this addon.
            }),
        ),
      );

      setCachedSources(key, collected);

      if (isDev) {
        console.log(
          `[prefetch] completed for ${type} ${playableId}: ${collected.length} sources cached`,
        );
      }
    } finally {
      inFlight.delete(key);
    }
  })();
}
