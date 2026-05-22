// Resolve the effective preferred audio language for a single playback,
// accounting for the global default vs. the anime-specific default.
//
// The result is the language string the MPV layer should try to select after
// playback starts. "" means "no preference — keep MPV's default".
//
// Pure module: no Electron, no React.

import type { AppSettings } from "./types.js";

/**
 * Compute the audio language to prefer for this item.
 *   - Non-anime → the global `audioLanguage`.
 *   - Anime:
 *       "" (Off / use global)        → global `audioLanguage`
 *       "auto" / "original"          → "" (keep MPV's default audio)
 *       otherwise (e.g. "ja"/"jpn")  → that value
 * Empty string at any point means "no preference"; the MPV layer then keeps
 * whatever MPV picks by default.
 */
export function resolveAudioLanguage(
  settings: AppSettings,
  isAnime: boolean,
): string {
  if (isAnime) {
    const anime = (settings.animeAudioLanguage ?? "").trim();
    if (anime === "") return settings.audioLanguage;
    const lower = anime.toLowerCase();
    if (lower === "auto" || lower === "original") return "";
    return anime;
  }
  return settings.audioLanguage;
}
