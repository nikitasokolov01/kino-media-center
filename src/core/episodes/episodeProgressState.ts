// Episode progression helpers for the "caught up" / New Episode badge feature.
//
// Pure logic, no React/Electron. Operates on StremioMetaVideo[] (a show's
// episode list) and a set of watched (completed) episode ids. Specials
// (season === 0) are ignored, mirroring the rest of the app. Safe on missing
// season/episode metadata.

import type { StremioMetaVideo } from "../stremio/types.js";

/** Normal (non-special) episodes only. season===0 is a special; null/undefined
 *  season is treated as normal so episodes without season metadata aren't lost. */
export function normalEpisodes(videos: StremioMetaVideo[]): StremioMetaVideo[] {
  return (videos ?? []).filter((v) => v && v.season !== 0);
}

/** True if a is a later episode than b (season then episode). */
export function isEpisodeNewer(
  a: { season?: number | null; episode?: number | null },
  b: { season?: number | null; episode?: number | null },
): boolean {
  const as = typeof a.season === "number" ? a.season : -Infinity;
  const bs = typeof b.season === "number" ? b.season : -Infinity;
  if (as !== bs) return as > bs;
  const ae = typeof a.episode === "number" ? a.episode : -Infinity;
  const be = typeof b.episode === "number" ? b.episode : -Infinity;
  return ae > be;
}

/** The latest normal episode by season/episode order; falls back to the last in
 *  list order when season/episode are missing. Null if there are none. */
export function getLatestRegularEpisode(
  videos: StremioMetaVideo[],
): StremioMetaVideo | null {
  const eps = normalEpisodes(videos);
  if (eps.length === 0) return null;
  let best = eps[0];
  for (let i = 1; i < eps.length; i++) {
    const e = eps[i];
    // Prefer the strictly-newer episode; on a tie/unknown keep the later index.
    if (isEpisodeNewer(e, best) ||
        (typeof e.season !== "number" && typeof e.episode !== "number")) {
      best = e;
    }
  }
  return best;
}

/** Caught up = at least one normal episode exists AND every normal episode is
 *  watched/completed. */
export function isCaughtUp(
  videos: StremioMetaVideo[],
  watchedIds: Set<string>,
): boolean {
  const eps = normalEpisodes(videos);
  if (eps.length === 0) return false;
  return eps.every((v) => watchedIds.has(v.id));
}

/** Badge label for the current latest episode. */
export function getNewEpisodeBadgeLabel(latest: {
  season?: number | null;
  episode?: number | null;
} | null): string {
  if (latest && typeof latest.season === "number" && typeof latest.episode === "number") {
    return `S${latest.season}E${latest.episode} Out`;
  }
  return "New Episode";
}
