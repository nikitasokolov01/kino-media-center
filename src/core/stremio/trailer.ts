// Trailer extraction from Stremio meta objects.
//
// Pure logic, no React/Electron. Given a StremioMeta, returns a normalized
// trailer descriptor (or null). Two shapes are common across addons:
//
//   meta.trailerStreams: [{ title, ytId }]      (Cinemeta and modern addons)
//   meta.trailers:       [{ source, type }]      (legacy; source is a YouTube id)
//
// Some addons also expose a direct playable video URL on a trailer entry, or a
// trailer link in meta.links. We do NOT hardcode a single provider: YouTube ids
// become a youtube descriptor, anything that looks like a playable http(s)
// video URL becomes a direct descriptor.

import type { StremioMeta } from "./types.js";

export type TrailerInfo =
  | { kind: "youtube"; ytId: string; title?: string }
  | { kind: "direct"; url: string; title?: string };

const YT_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

// Pull a YouTube id out of a bare id or any youtube URL form.
function extractYouTubeId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  if (YT_ID_RE.test(s)) return s;
  // youtu.be/<id>, youtube.com/watch?v=<id>, /embed/<id>, /shorts/<id>
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.slice(1).split("/")[0];
      return YT_ID_RE.test(id) ? id : null;
    }
    if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      const v = u.searchParams.get("v");
      if (v && YT_ID_RE.test(v)) return v;
      const parts = u.pathname.split("/").filter(Boolean);
      const last = parts[parts.length - 1];
      if (last && YT_ID_RE.test(last)) return last;
    }
  } catch {
    /* not a URL */
  }
  return null;
}

// Heuristic: does this look like a directly-playable video file URL?
function asDirectVideoUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!/^https?:\/\//i.test(s)) return null;
  if (extractYouTubeId(s)) return null; // YouTube handled separately
  // Common video container extensions (allow query strings after them).
  if (/\.(mp4|webm|mov|m4v|mkv|m3u8)(\?|#|$)/i.test(s)) return s;
  return null;
}

interface TrailerStreamLike {
  title?: unknown;
  ytId?: unknown;
  url?: unknown;
}

interface LegacyTrailerLike {
  source?: unknown;
  type?: unknown;
  url?: unknown;
  ytId?: unknown;
  title?: unknown;
}

/**
 * Resolve the best trailer for a meta object, or null if none is available.
 * Preference order: modern trailerStreams, then legacy trailers, then any
 * trailer-category link. YouTube wins over direct only by appearance order.
 */
export function getTrailerInfo(meta: StremioMeta | null | undefined): TrailerInfo | null {
  if (!meta) return null;

  // 1) trailerStreams: [{ title, ytId }] (also tolerate a url field)
  const streams = Array.isArray(meta.trailerStreams)
    ? (meta.trailerStreams as TrailerStreamLike[])
    : [];
  for (const t of streams) {
    const yt = extractYouTubeId(t?.ytId) ?? extractYouTubeId(t?.url);
    if (yt) return { kind: "youtube", ytId: yt, title: typeof t?.title === "string" ? t.title : undefined };
    const direct = asDirectVideoUrl(t?.url);
    if (direct) return { kind: "direct", url: direct, title: typeof t?.title === "string" ? t.title : undefined };
  }

  // 2) legacy trailers: [{ source, type }] (source is usually a YouTube id)
  const legacy = Array.isArray(meta.trailers)
    ? (meta.trailers as LegacyTrailerLike[])
    : [];
  for (const t of legacy) {
    const yt =
      extractYouTubeId(t?.ytId) ??
      extractYouTubeId(t?.source) ??
      extractYouTubeId(t?.url);
    if (yt) return { kind: "youtube", ytId: yt, title: typeof t?.title === "string" ? t.title : undefined };
    const direct = asDirectVideoUrl(t?.url) ?? asDirectVideoUrl(t?.source);
    if (direct) return { kind: "direct", url: direct, title: typeof t?.title === "string" ? t.title : undefined };
  }

  // 3) links with a Trailer category (rare, but cheap to check)
  const links = Array.isArray(meta.links) ? meta.links : [];
  for (const l of links) {
    const cat = typeof l?.category === "string" ? l.category.toLowerCase() : "";
    if (cat !== "trailer" && cat !== "trailers") continue;
    const yt = extractYouTubeId(l?.url);
    if (yt) return { kind: "youtube", ytId: yt, title: typeof l?.name === "string" ? l.name : undefined };
    const direct = asDirectVideoUrl(l?.url);
    if (direct) return { kind: "direct", url: direct, title: typeof l?.name === "string" ? l.name : undefined };
  }

  return null;
}

/** Build a YouTube embed URL. `hero` mode is muted/looping/chromeless. */
export function youTubeEmbedUrl(
  ytId: string,
  opts: { hero: boolean; muted: boolean },
): string {
  const base = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(ytId)}`;
  const p = new URLSearchParams();
  p.set("autoplay", "1");
  p.set("mute", opts.muted ? "1" : "0");
  p.set("playsinline", "1");
  p.set("rel", "0");
  p.set("modestbranding", "1");
  p.set("enablejsapi", "1");
  if (opts.hero) {
    p.set("controls", "0");
    p.set("loop", "1");
    p.set("playlist", ytId); // required for loop to work on a single video
    p.set("disablekb", "1");
    p.set("fs", "0");
  } else {
    p.set("controls", "1");
  }
  return `${base}?${p.toString()}`;
}

/** Public watch URL for "Open Trailer" fallback. */
export function youTubeWatchUrl(ytId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(ytId)}`;
}
