// Source affinity scoring for the Next Episode pipeline.
//
// When the embedded player transitions to the next episode, we want to prefer
// a source that "looks like" it came from the same release pack / file host /
// source group as the currently playing stream.
//
// Scoring is additive: each matching signal adds points. A candidate that
// matches several signals (same hostname + same stream name + same quality)
// is strongly preferred. When no candidate reaches the affinity threshold we
// fall back to the normal chooseBestSource() quality-ranked pick.
//
// Pure module — no Electron/React imports, no side effects.

import { detectResolution } from "./sourceRanking.js";
import { chooseBestSource } from "./sourceRanking.js";
import type { RankingOptions } from "./sourceRanking.js";
import { classifyStream } from "../../features/player/playability.js";
import type { StreamSourceResult, StremioStream } from "../stremio/types.js";

const isDev =
  typeof process !== "undefined" && process.env.NODE_ENV !== "production";


// ── Affinity profile ──────────────────────────────────────────────────────────

export interface SourceAffinity {
  /** Stremio addon ID that provided this stream. */
  addonId: string;
  /** stream.name (often the provider/group label, e.g. "YTS", "RARBG"). */
  streamName: string | null;
  /** Hostname from stream.url (e.g. "cdn.somedomain.com"). */
  hostname: string | null;
  /** First 1–3 path segments of stream.url — indicates same CDN folder. */
  pathPrefix: string | null;
  /** Release group: [Group] tag or -Group suffix detected in filename/title. */
  releaseGroup: string | null;
  /** Resolution tier detected from free-text fields. */
  quality: string | null;
  /** Video codec detected (e.g. "h264", "hevc"). */
  codec: string | null;
  /** HDR format detected (e.g. "hdr", "dv"). */
  hdr: string | null;
  /** True when season-pack indicators are present ("S01", "Complete", etc.). */
  seasonPack: boolean;
}

/** Build a SourceAffinity profile from a stream + its addon id. */
export function extractSourceAffinity(
  stream: StremioStream,
  addonId: string,
): SourceAffinity {
  const text = [stream.name, stream.title, stream.behaviorHints?.filename]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join("\n");

  const url = stream.url ?? "";

  // Hostname + path prefix from URL.
  let hostname: string | null = null;
  let pathPrefix: string | null = null;
  try {
    const u = new URL(url);
    hostname = u.hostname.replace(/^www\./, "");
    const parts = u.pathname.split("/").filter(Boolean);
    // Take up to 3 segments but drop the filename (last segment).
    const prefixParts = parts.slice(0, Math.min(3, Math.max(1, parts.length - 1)));
    pathPrefix = prefixParts.length > 0 ? prefixParts.join("/") : null;
  } catch {
    // Non-parseable URL — leave null.
  }

  // Release group: prefer [Group] tag, fall back to -Group at end.
  const bracketMatch = text.match(/\[([A-Za-z0-9_-]{2,20})\]/);
  const dashMatch = text.match(/-([A-Za-z0-9]{2,15})(?:\s|$|\.)/);
  const releaseGroup = bracketMatch?.[1] ?? dashMatch?.[1] ?? null;

  // Quality tier.
  const qualityTier = detectResolution(text);
  const quality = qualityTier !== "unknown" ? qualityTier : null;

  // Codec.
  const codecMatch = text.match(
    /\b(h\.?264|x264|avc1?|h\.?265|x265|hevc|av1|vp9)\b/i,
  );
  const codec = codecMatch
    ? codecMatch[1].toLowerCase().replace(/\./g, "").replace("h264", "h264").replace("h265", "h265")
    : null;

  // HDR.
  const hdrMatch = text.match(/\b(hdr10?\+?|dolby[\s.]?vision|dv|hlg)\b/i);
  const hdr = hdrMatch ? hdrMatch[1].toLowerCase().replace(/\s/g, "") : null;

  // Season-pack signals.
  const seasonPack =
    /\b(complete|season[\s.]?\d+|s0?\d+(?!e\d))\b/i.test(text);

  return {
    addonId,
    streamName: stream.name ?? null,
    hostname,
    pathPrefix,
    releaseGroup,
    quality,
    codec,
    hdr,
    seasonPack,
  };
}

// ── Scoring ───────────────────────────────────────────────────────────────────

// Weights for each affinity signal.
// Higher = stronger evidence that two streams come from the same source family.
const WEIGHT_ADDON_ID    = 40; // same addon → very likely same provider
const WEIGHT_STREAM_NAME = 30; // stream.name is the clearest "group" label
const WEIGHT_HOSTNAME    = 25; // same CDN / file host
const WEIGHT_PATH_PREFIX = 15; // same folder path on the CDN
const WEIGHT_REL_GROUP   = 20; // same [RELEASE] tag
const WEIGHT_QUALITY     = 10; // same resolution
const WEIGHT_CODEC       =  5; // same codec
const WEIGHT_HDR         =  5; // same HDR
const WEIGHT_SEASON_PACK = 10; // candidate looks like a season pack

/** Minimum cumulative affinity score to prefer over quality-ranked fallback. */
export const AFFINITY_THRESHOLD = 25;

export interface AffinityScore {
  score: number;
  reasons: string[];
}

export function scoreNextEpisodeSource(
  current: SourceAffinity,
  candidate: SourceAffinity,
): AffinityScore {
  let score = 0;
  const reasons: string[] = [];

  if (candidate.addonId && candidate.addonId === current.addonId) {
    score += WEIGHT_ADDON_ID;
    reasons.push("same-addon");
  }
  if (
    current.streamName &&
    candidate.streamName &&
    candidate.streamName === current.streamName
  ) {
    score += WEIGHT_STREAM_NAME;
    reasons.push("same-stream-name");
  }
  if (current.hostname && candidate.hostname === current.hostname) {
    score += WEIGHT_HOSTNAME;
    reasons.push("same-hostname");
  }
  if (
    current.pathPrefix &&
    candidate.pathPrefix &&
    candidate.pathPrefix.startsWith(current.pathPrefix)
  ) {
    score += WEIGHT_PATH_PREFIX;
    reasons.push("same-path-prefix");
  }
  if (
    current.releaseGroup &&
    candidate.releaseGroup &&
    candidate.releaseGroup.toLowerCase() ===
      current.releaseGroup.toLowerCase()
  ) {
    score += WEIGHT_REL_GROUP;
    reasons.push("same-release-group");
  }
  if (current.quality && candidate.quality === current.quality) {
    score += WEIGHT_QUALITY;
    reasons.push("same-quality");
  }
  if (current.codec && candidate.codec === current.codec) {
    score += WEIGHT_CODEC;
    reasons.push("same-codec");
  }
  if (current.hdr && candidate.hdr === current.hdr) {
    score += WEIGHT_HDR;
    reasons.push("same-hdr");
  }
  if (candidate.seasonPack) {
    score += WEIGHT_SEASON_PACK;
    reasons.push("season-pack");
  }

  return { score, reasons };
}

// ── Selection ─────────────────────────────────────────────────────────────────

/**
 * Choose the best next-episode source.
 *
 * Steps:
 *  1. Filter to direct http(s) playable candidates only.
 *  2. Score each against the current stream's affinity profile.
 *  3. If any candidate reaches AFFINITY_THRESHOLD, pick the highest scorer
 *     (ties broken by quality tier, then original list order).
 *  4. Otherwise fall back to chooseBestSource() (quality-ranked).
 *
 * @param currentStream  The stream currently playing (used to extract affinity).
 * @param currentAddonId The addon that provided the current stream (may be "" if unknown).
 * @param candidates     Source list for the next episode (from the prefetch cache).
 * @param settings       Quality ranking settings (same as used for auto-select).
 */
export function chooseNextEpisodeSource(
  currentStream: StremioStream,
  currentAddonId: string,
  candidates: StreamSourceResult[],
  settings: RankingOptions,
): StreamSourceResult | null {
  if (candidates.length === 0) return null;

  const currentAffinity = extractSourceAffinity(currentStream, currentAddonId);

  // Filter to playable candidates first.
  const playable = candidates.filter((c) => {
    const classified = classifyStream(c.stream);
    return (
      (classified.kind === "playable" || classified.kind === "hls") &&
      typeof classified.url === "string"
    );
  });
  if (playable.length === 0) return null;

  // Score all playable candidates.
  const scored = playable.map((result, order) => {
    const affinity = extractSourceAffinity(
      result.stream,
      result.source.addonId,
    );
    const { score, reasons } = scoreNextEpisodeSource(currentAffinity, affinity);
    return { result, score, reasons, order };
  });

  const best = scored.reduce(
    (a, b) => (b.score > a.score ? b : a),
    scored[0],
  );

  if (isDev) {
    console.log("[affinity] top candidate:", {
      name: best.result.stream.name,
      score: best.score,
      reasons: best.reasons.join(", ") || "none",
    });
  }

  if (best.score >= AFFINITY_THRESHOLD) {
    // Have a confident affinity match — pick the best-scored, then quality.
    const topScore = best.score;
    const tied = scored.filter((s) => s.score === topScore);
    // Among tied affinity scores, prefer higher quality tier.
    tied.sort((a, b) => {
      // Quick resolution detection from stream text.
      const textA = [a.result.stream.name, a.result.stream.title].filter(Boolean).join("\n");
      const textB = [b.result.stream.name, b.result.stream.title].filter(Boolean).join("\n");
      const tierA = detectResolution(textA);
      const tierB = detectResolution(textB);
      const RANKS: Record<string, number> = {
        "2160p": 5, "1440p": 4, "1080p": 3, "720p": 2, "480p": 1,
        unknown: 0, cam: -1,
      };
      const rankDiff = (RANKS[tierB] ?? 0) - (RANKS[tierA] ?? 0);
      if (rankDiff !== 0) return rankDiff;
      return a.order - b.order;
    });

    if (isDev) {
      console.log(
        `[affinity] selected by affinity (score ${tied[0].score}, reasons: ${tied[0].reasons.join(", ")}):`,
        tied[0].result.stream.name,
        tied[0].result.source.addonId,
      );
    }
    return tied[0].result;
  }

  // No meaningful affinity — fall back to normal quality ranking.
  if (isDev) {
    console.log(
      `[affinity] best score ${best.score} below threshold ${AFFINITY_THRESHOLD} — falling back to best-source ranking`,
    );
  }
  return chooseBestSource(candidates, settings);
}
