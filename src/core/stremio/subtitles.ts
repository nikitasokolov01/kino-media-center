// Stremio subtitle fetching + helpers.
//
// Endpoint: `<base>/subtitles/<type>/<id>.json`
// The response is `{ subtitles: [...] }`.
//
// For series, `<id>` MUST be the selected episode id from `meta.videos`, not
// the show id — same rule as streams. Callers pass the SelectedPlayableItem's
// `id`, which already encodes that distinction.
//
// This module is pure: no Electron, no React. It mirrors the structure of
// streams.ts so the two read consistently.

import type {
  StremioSubtitle,
  StremioSubtitlesResponse,
} from "./types.js";
import { baseUrlFromManifestUrl } from "./catalog.js";

const FETCH_TIMEOUT_MS = 15_000;

export class SubtitleFetchError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "SubtitleFetchError";
    this.status = status;
  }
}

export interface FetchStremioSubtitlesOptions {
  manifestUrl: string;
  type: string;
  /** Movie id, or the selected series episode id from meta.videos. */
  id: string;
}

export function buildSubtitlesUrl(opts: FetchStremioSubtitlesOptions): string {
  if (!opts.type) throw new SubtitleFetchError("type is required");
  if (!opts.id) throw new SubtitleFetchError("id is required");
  const base = baseUrlFromManifestUrl(opts.manifestUrl);
  const encType = encodeURIComponent(opts.type);
  const encId = encodeURIComponent(opts.id);
  return `${base}subtitles/${encType}/${encId}.json`;
}

function isSubtitle(v: unknown): v is StremioSubtitle {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  // A track is only useful if it carries a URL we can hand to the player.
  return typeof s.url === "string" && s.url.length > 0;
}

function validateSubtitlesResponse(raw: unknown): StremioSubtitlesResponse {
  if (!raw || typeof raw !== "object") {
    throw new SubtitleFetchError("Subtitles response is not an object");
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.subtitles)) {
    throw new SubtitleFetchError(
      "Subtitles response is missing a subtitles array",
    );
  }
  const subtitles = (obj.subtitles as unknown[]).filter(
    isSubtitle,
  ) as StremioSubtitle[];
  return { ...obj, subtitles };
}

export async function fetchStremioSubtitles(
  opts: FetchStremioSubtitlesOptions,
): Promise<StremioSubtitlesResponse> {
  const url = buildSubtitlesUrl(opts);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
      redirect: "follow",
    });
  } catch (err) {
    clearTimeout(timeout);
    const msg = err instanceof Error ? err.message : String(err);
    throw new SubtitleFetchError(`Failed to fetch subtitles: ${msg}`);
  }
  clearTimeout(timeout);

  if (!res.ok) {
    throw new SubtitleFetchError(
      `Subtitles request failed: ${res.status} ${res.statusText}`,
      res.status,
    );
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new SubtitleFetchError(`Subtitles is not valid JSON: ${msg}`);
  }

  return validateSubtitlesResponse(json);
}

// ----- Helpers -------------------------------------------------------------

/**
 * Best-effort subtitle format detection from a URL's file extension. Returns
 * an uppercased label like "SRT" / "VTT" / "ASS", or null when undetectable.
 * Query strings and fragments are ignored.
 */
export function detectSubtitleFormat(url: string | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // Not an absolute URL — fall back to stripping query/hash manually.
    pathname = url.split(/[?#]/)[0] ?? url;
  }
  const m = pathname.toLowerCase().match(/\.(srt|vtt|ass|ssa|sub|sbv)$/);
  if (!m) return null;
  return m[1].toUpperCase();
}

/**
 * A readable language label for a track. Prefers `lang`, then a display
 * `name`/`title`, then falls back to "Unknown".
 */
export function subtitleLanguageLabel(s: StremioSubtitle): string {
  const lang = typeof s.lang === "string" ? s.lang.trim() : "";
  if (lang) return lang;
  const name = typeof s.name === "string" ? s.name.trim() : "";
  if (name) return name;
  const title = typeof s.title === "string" ? s.title.trim() : "";
  if (title) return title;
  return "Unknown";
}

/**
 * Stable dedup key for a subtitle track. URL is the strongest identity; fall
 * back to addon + index so we never merge unrelated tracks.
 */
export function subtitleDedupKey(
  s: StremioSubtitle,
  fallbackId: string,
): string {
  if (typeof s.url === "string" && s.url.length > 0) {
    return `url:${s.url}`;
  }
  return `fallback:${fallbackId}`;
}
