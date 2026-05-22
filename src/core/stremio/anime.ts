// Conservative anime classification.
//
// Goal: let anime default to a different audio language (typically Japanese)
// without mislabeling western animation. We PREFER provider/source signals
// (Kitsu) over genre guessing, and we treat the genre "Animation" as NOT
// sufficient on its own — only an explicit "Anime" genre counts.
//
// Pure module: no Electron, no React.

import type { StremioMeta } from "./types.js";

export interface AnimeContext {
  /** The addon that supplied the meta (id and/or name). */
  addonId?: string;
  addonName?: string;
  /** Catalog the item came from, if known. */
  catalogId?: string;
  catalogName?: string;
  /** The media id (movie id or series/show id). */
  mediaId?: string;
  /** A provider/source label if the meta exposes one. */
  provider?: string;
}

function lc(v: unknown): string {
  return typeof v === "string" ? v.toLowerCase() : "";
}

/** True if a value carries a Kitsu signal. */
function hasKitsuSignal(value: string): boolean {
  return (
    value.startsWith("kitsu:") ||
    value.startsWith("kitsu_") ||
    value.includes("kitsu")
  );
}

/**
 * Decide whether a media item is "likely anime". Order matters:
 *   1. Kitsu-style media id (anime is frequently pulled via Kitsu, not TMDb).
 *   2. Provider/addon/catalog signals containing "kitsu".
 *   3. Genre fallback — ONLY an explicit "Anime" genre. "Animation" alone does
 *      not count, so Arcane / The Simpsons / Family Guy stay non-anime.
 * When unsure, returns false (caller uses the global audio default).
 */
export function isLikelyAnime(
  meta: StremioMeta | null | undefined,
  context?: AnimeContext,
): boolean {
  // 1. Kitsu id signals (check both the explicit context id and the meta id).
  const ids = [lc(context?.mediaId), lc(meta?.id)].filter((s) => s.length > 0);
  if (ids.some(hasKitsuSignal)) return true;

  // 2. Provider / addon / catalog signals.
  const signals = [
    lc(context?.addonId),
    lc(context?.addonName),
    lc(context?.catalogId),
    lc(context?.catalogName),
    lc(context?.provider),
    lc((meta as Record<string, unknown> | null | undefined)?.["source"]),
  ].filter((s) => s.length > 0);
  if (signals.some((s) => s.includes("kitsu"))) return true;

  // 3. Genre fallback — explicit "Anime" only.
  const genres = Array.isArray(meta?.genres)
    ? meta!.genres.map((g) => lc(g))
    : [];
  // Match a genre that IS "anime" or contains the word "anime" (e.g. "Anime").
  // Deliberately do NOT treat "animation" as anime.
  if (genres.some((g) => g === "anime" || /\banime\b/.test(g))) return true;

  return false;
}
