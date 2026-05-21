// Classify a stream by what the v1 built-in player can do with it.
//
// In v1:
//   - Direct HTTP/HTTPS URLs to .mp4/.webm/.mkv (best-effort)/unknown play in
//     the HTML5 <video> element.
//   - .m3u8 plays via dynamically-loaded hls.js.
//   - .mpd (DASH) is marked unsupported until we wire dash.js.
//   - externalUrl opens in the OS browser via shell.openExternal.
//   - ytId and infoHash are not playable yet.

import type { StremioStream } from "../../core/stremio/types.js";
import type { PlayabilityResult } from "./types.js";

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** Best-effort container guess from the URL pathname. */
function formatFromPath(pathname: string): PlayabilityResult["format"] {
  const lower = pathname.toLowerCase();
  // Strip query/hash already removed via URL parsing.
  if (lower.endsWith(".m3u8")) return "hls";
  if (lower.endsWith(".mpd")) return "dash";
  if (lower.endsWith(".mp4") || lower.endsWith(".m4v")) return "mp4";
  if (lower.endsWith(".webm")) return "webm";
  if (lower.endsWith(".mkv")) return "mkv";
  return "unknown";
}

export function classifyStream(s: StremioStream): PlayabilityResult {
  // 1. Direct URL is preferred when available.
  if (typeof s.url === "string" && s.url.length > 0) {
    const u = parseUrl(s.url);
    if (!u) {
      return { kind: "unsupported", reason: "Stream URL is malformed." };
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return {
        kind: "unsupported",
        reason: `Only http/https URLs are supported (got ${u.protocol}).`,
      };
    }
    const format = formatFromPath(u.pathname);
    if (format === "dash") {
      return {
        kind: "unsupported",
        format,
        url: s.url,
        reason: "DASH (.mpd) playback is not enabled yet.",
      };
    }
    if (format === "hls") {
      return { kind: "hls", format, url: s.url };
    }
    return { kind: "playable", format, url: s.url };
  }

  // 2. External URL — open in OS browser.
  if (typeof s.externalUrl === "string" && s.externalUrl.length > 0) {
    const u = parseUrl(s.externalUrl);
    if (!u || (u.protocol !== "http:" && u.protocol !== "https:")) {
      return {
        kind: "unsupported",
        reason: "External URL is not http/https.",
      };
    }
    return { kind: "external", url: s.externalUrl };
  }

  // 3. YouTube id — not playable in v1.
  if (typeof s.ytId === "string" && s.ytId.length > 0) {
    return {
      kind: "youtube",
      reason: "YouTube playback is not enabled yet.",
    };
  }

  // 4. Torrent — needs a resolver / debrid integration.
  if (typeof s.infoHash === "string" && s.infoHash.length > 0) {
    return {
      kind: "torrent",
      reason: "Torrent playback requires a resolver (not in this build).",
    };
  }

  return { kind: "unsupported", reason: "Stream has no playable handles." };
}

// ----- Time helpers --------------------------------------------------------

/** Format seconds as `H:MM:SS` or `M:SS`. */
export function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const total = Math.floor(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(sec)}`;
  return `${m}:${pad(sec)}`;
}
