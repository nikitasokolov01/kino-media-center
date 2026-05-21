// Browser-player capability helpers. Pure functions — no React, no Electron.

import type { PlayabilityResult } from "../../features/player/types.js";
import type { DefaultPlayerSetting, PlayerBackend } from "./types.js";

/**
 * True if the built-in HTML5 player has a reasonable chance at this format.
 * .mkv is deliberately excluded — Chromium can sometimes play H.264-in-MKV
 * but most real-world MKV streams (Matroska + HEVC/AC3/EAC3/DTS) fail, so we
 * never recommend the browser for them.
 */
export function canBrowserPlay(format: PlayabilityResult["format"] | undefined): boolean {
  if (!format) return false;
  return format === "mp4" || format === "webm" || format === "hls";
}

/**
 * Pick the recommended backend for a given stream's classification and the
 * user's default-player preference. The caller is responsible for offering
 * the *other* backend as a secondary option when both are viable.
 */
export function recommendedBackend(
  classification: PlayabilityResult,
  userDefault: DefaultPlayerSetting,
): PlayerBackend {
  if (classification.kind !== "playable" && classification.kind !== "hls") {
    // Non-direct streams aren't relevant — caller handles externalUrl/yt/etc.
    return "browser";
  }
  const browserOk = canBrowserPlay(classification.format);
  // If the browser can't reasonably play this, MPV always wins.
  if (!browserOk) return "mpv-external";
  // Both viable — respect the user's preference.
  return userDefault === "browser" ? "browser" : "mpv-external";
}
