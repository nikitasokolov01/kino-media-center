// Headless subtitle collection for MPV auto-loading.
//
// Subtitles are NOT app-level sources and there is NO pre-play selection UI.
// When the user presses Play with MPV, we fan out a subtitle fetch across every
// installed subtitle-capable addon for the exact playable id (movie id, or the
// selected series episode id), collect all tracks that carry a direct http(s)
// URL, dedup them, and hand the whole list to MPV. The user then picks a track
// from the in-player controls after playback starts.
//
// This reuses the same per-addon fetch the (now-removed) SubtitlesSection used,
// but with no React state and no user choice.

import { addonSupportsResource } from "../../core/stremio/meta.js";
import { subtitleDedupKey } from "../../core/stremio/subtitles.js";
import type { StremioSubtitle } from "../../core/stremio/types.js";
import type { AddonRow } from "../../types/preload.js";

/** A subtitle track reduced to what MPV needs: a URL plus optional metadata. */
export interface CollectedSubtitle {
  url: string;
  lang?: string;
  name?: string;
  addonName?: string;
}

/** Overall cap so a slow subtitle addon can never block playback for long. */
const COLLECT_TIMEOUT_MS = 10_000;

function isHttpUrl(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length === 0) return false;
  return raw.startsWith("http://") || raw.startsWith("https://");
}

/**
 * Collect all valid subtitle tracks for a playable across subtitle-capable
 * addons. Never throws — a failed addon is skipped. Returns whatever has been
 * gathered by COLLECT_TIMEOUT_MS so playback is never blocked.
 */
export async function collectSubtitles(
  addons: AddonRow[],
  type: "movie" | "series",
  id: string,
): Promise<CollectedSubtitle[]> {
  const eligible = addons.filter((a) =>
    addonSupportsResource(a.manifest, "subtitles", type),
  );
  if (eligible.length === 0 || !id) return [];

  const seen = new Set<string>();
  const collected: CollectedSubtitle[] = [];

  const tasks = eligible.map((a, ai) =>
    window.mediaCenter.subtitles
      .fetch({ manifestUrl: a.manifestUrl, type, id })
      .then((res) => {
        const tracks = (res.subtitles ?? []) as StremioSubtitle[];
        tracks.forEach((t, i) => {
          if (!isHttpUrl(t.url)) return;
          const key = subtitleDedupKey(t, `${a.id}#${ai}#${i}`);
          if (seen.has(key)) return;
          seen.add(key);
          collected.push({
            url: t.url,
            lang: typeof t.lang === "string" ? t.lang : undefined,
            name:
              typeof t.name === "string"
                ? t.name
                : typeof t.title === "string"
                  ? t.title
                  : undefined,
            addonName: a.manifest.name,
          });
        });
      })
      .catch(() => {
        // Per-addon failure is non-fatal; skip it.
      }),
  );

  // Resolve as soon as everything settles OR the timeout fires — whichever is
  // first. `collected` is shared, so a timeout still returns partial results.
  await Promise.race([
    Promise.allSettled(tasks),
    new Promise<void>((resolve) => setTimeout(resolve, COLLECT_TIMEOUT_MS)),
  ]);

  return collected;
}
