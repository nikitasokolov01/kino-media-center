// Stremio stream fetching + label parsing.
//
// Endpoint: `<base>/stream/<type>/<id>.json`
// The response is `{ streams: [...] }`.
//
// Many addons cram quality, codec, HDR flags, and file size into the stream's
// `name`/`title` text since the protocol has no structured fields for them.
// The detectors below extract those labels so the UI can render structured
// tags instead of relying on whatever the addon happened to format.

import type {
  StremioStream,
  StremioStreamResponse,
} from "./types.js";
import { baseUrlFromManifestUrl } from "./catalog.js";

const FETCH_TIMEOUT_MS = 15_000;

export class StreamFetchError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "StreamFetchError";
    this.status = status;
  }
}

export interface FetchStremioStreamsOptions {
  manifestUrl: string;
  type: string;
  id: string;
}

export function buildStreamUrl(opts: FetchStremioStreamsOptions): string {
  if (!opts.type) throw new StreamFetchError("type is required");
  if (!opts.id) throw new StreamFetchError("id is required");
  const base = baseUrlFromManifestUrl(opts.manifestUrl);
  const encType = encodeURIComponent(opts.type);
  const encId = encodeURIComponent(opts.id);
  return `${base}stream/${encType}/${encId}.json`;
}

function isStream(v: unknown): v is StremioStream {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  // A stream must carry at least one of the playable handles to be useful.
  return (
    typeof s.url === "string" ||
    typeof s.externalUrl === "string" ||
    typeof s.infoHash === "string" ||
    typeof s.ytId === "string"
  );
}

function validateStreamResponse(raw: unknown): StremioStreamResponse {
  if (!raw || typeof raw !== "object") {
    throw new StreamFetchError("Stream response is not an object");
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.streams)) {
    throw new StreamFetchError("Stream response is missing a streams array");
  }
  const streams = (obj.streams as unknown[]).filter(isStream) as StremioStream[];
  return { ...obj, streams };
}

export async function fetchStremioStreams(
  opts: FetchStremioStreamsOptions,
): Promise<StremioStreamResponse> {
  const url = buildStreamUrl(opts);

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
    throw new StreamFetchError(`Failed to fetch streams: ${msg}`);
  }
  clearTimeout(timeout);

  if (!res.ok) {
    throw new StreamFetchError(
      `Stream request failed: ${res.status} ${res.statusText}`,
      res.status,
    );
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new StreamFetchError(`Streams is not valid JSON: ${msg}`);
  }

  return validateStreamResponse(json);
}

// ----- Stream kind classifier ----------------------------------------------

export type StreamKind = "http" | "torrent" | "youtube" | "external" | "unknown";

/**
 * Coarse categorization of how a stream would be played. Useful for badges
 * before we have a real player.
 */
export function streamKind(s: StremioStream): StreamKind {
  if (typeof s.url === "string" && s.url.length > 0) return "http";
  if (typeof s.infoHash === "string" && s.infoHash.length > 0) return "torrent";
  if (typeof s.ytId === "string" && s.ytId.length > 0) return "youtube";
  if (typeof s.externalUrl === "string" && s.externalUrl.length > 0)
    return "external";
  return "unknown";
}

// ----- Label detectors -----------------------------------------------------
// All detectors are pure and case-insensitive. They operate on free-form
// strings (typically `name + "\n" + title`).

const QUALITY_PATTERNS: Array<{ label: string; re: RegExp }> = [
  // 4K / UHD / 2160p — single bucket
  { label: "4K", re: /\b(4k|uhd|2160p)\b/i },
  { label: "1440p", re: /\b(1440p|qhd)\b/i },
  { label: "1080p", re: /\b(1080p|fhd|full[\s.-]?hd)\b/i },
  { label: "720p", re: /\b(720p|hd)\b/i },
  { label: "480p", re: /\b(480p|sd)\b/i },
  { label: "360p", re: /\b360p\b/i },
  { label: "CAM", re: /\b(cam|camrip|hdcam)\b/i },
  { label: "TS", re: /\b(ts|hdts|telesync)\b/i },
  { label: "SCR", re: /\b(scr|screener|dvdscr)\b/i },
  { label: "WEB-DL", re: /\bweb[\s.-]?dl\b/i },
  { label: "WEBRip", re: /\bweb[\s.-]?rip\b/i },
  { label: "BluRay", re: /\b(bluray|blu[\s.-]?ray|bdrip|brrip)\b/i },
  { label: "DVDRip", re: /\bdvd[\s.-]?rip\b/i },
];

/**
 * Detect a coarse quality label. Returns the first match in priority order
 * (resolution wins over format), or null if nothing matches.
 */
export function detectQuality(text: string): string | null {
  if (!text) return null;
  for (const { label, re } of QUALITY_PATTERNS) {
    if (re.test(text)) return label;
  }
  return null;
}

/**
 * Detect a size label like "12.4 GB" or "800 MB". Returns the cleaned-up
 * string, or null. Accepts both `.` and `,` as decimal separators.
 */
export function detectSize(text: string): string | null {
  if (!text) return null;
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*(TB|GB|MB|KB)\b/i);
  if (!m) return null;
  const num = m[1].replace(",", ".");
  const unit = m[2].toUpperCase();
  return `${num} ${unit}`;
}

/**
 * Detect HDR flavor: HDR10+, HDR10, HDR, or Dolby Vision.
 * Returns the most specific match.
 */
export function detectHdr(text: string): string | null {
  if (!text) return null;
  if (/\b(dolby[\s.-]?vision|\bdv\b)/i.test(text)) {
    // Some addons combine DV+HDR — surface whichever is more specific.
    if (/\bhdr10\+/i.test(text)) return "DV/HDR10+";
    if (/\bhdr10\b/i.test(text)) return "DV/HDR10";
    if (/\bhdr\b/i.test(text)) return "DV/HDR";
    return "DV";
  }
  if (/\bhdr10\+/i.test(text)) return "HDR10+";
  if (/\bhdr10\b/i.test(text)) return "HDR10";
  if (/\bhdr\b/i.test(text)) return "HDR";
  return null;
}

/**
 * Detect codec family. HEVC covers x265/h265; AVC covers x264/h264.
 */
export function detectCodec(text: string): string | null {
  if (!text) return null;
  if (/\b(x265|h\.?265|hevc)\b/i.test(text)) return "HEVC";
  if (/\b(x264|h\.?264|avc)\b/i.test(text)) return "AVC";
  if (/\bav1\b/i.test(text)) return "AV1";
  if (/\bvp9\b/i.test(text)) return "VP9";
  if (/\bmpeg[\s.-]?2\b/i.test(text)) return "MPEG-2";
  return null;
}

// ----- Dedup ---------------------------------------------------------------

/**
 * Compute a stable dedup key. Streams that share a key are considered the
 * same source.
 *
 * Rules, in order:
 *   1. infoHash + fileIdx (torrents — same swarm + file is the same content)
 *   2. ytId
 *   3. url
 *   4. externalUrl
 *   5. fall back to addon + index so we don't accidentally merge unrelated
 *      streams.
 */
export function streamDedupKey(
  s: StremioStream,
  fallbackId: string,
): string {
  if (typeof s.infoHash === "string" && s.infoHash.length > 0) {
    const idx =
      typeof s.fileIdx === "number" ? String(s.fileIdx) : "_";
    return `torrent:${s.infoHash.toLowerCase()}:${idx}`;
  }
  if (typeof s.ytId === "string" && s.ytId.length > 0) {
    return `yt:${s.ytId}`;
  }
  if (typeof s.url === "string" && s.url.length > 0) {
    return `url:${s.url}`;
  }
  if (typeof s.externalUrl === "string" && s.externalUrl.length > 0) {
    return `ext:${s.externalUrl}`;
  }
  return `fallback:${fallbackId}`;
}
