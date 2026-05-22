// Source auto-selection ranking.
//
// Pure, UI-free logic for picking the "best" playable source from the list the
// SourcesSection already fetched + deduped. Only DIRECT http(s) stream.url
// sources are considered playable (MPV's requirement); torrents/externalUrl/
// youtube are never auto-selected.
//
// Quality is parsed from the stream's free-text fields (name/title/filename),
// the same place the existing detectors look. CAM/TS sources are always the
// lowest tier, and excluded entirely when `hideCamSources` is on (unless they
// are the only playable option).

import { classifyStream } from "../../features/player/playability.js";
import type { StreamSourceResult } from "../stremio/types.js";
import type { AppSettings, PreferredSourceQuality } from "./types.js";

export type QualityTier =
  | "2160p"
  | "1440p"
  | "1080p"
  | "720p"
  | "480p"
  | "unknown"
  | "cam";

/** Numeric rank — higher is better. CAM is below "unknown". */
const TIER_RANK: Record<QualityTier, number> = {
  "2160p": 5,
  "1440p": 4,
  "1080p": 3,
  "720p": 2,
  "480p": 1,
  unknown: 0,
  cam: -1,
};

/** Options the ranker needs. A full AppSettings satisfies this. */
export type RankingOptions = Pick<
  AppSettings,
  "preferredSourceQuality" | "hideCamSources"
>;

export interface StreamRank {
  /** Direct http(s) URL playable in MPV. */
  playable: boolean;
  /** CAM/TS (or similar low-quality capture) detected. */
  cam: boolean;
  tier: QualityTier;
  tierRank: number;
}

/** Combine the free-text fields the addon may have stuffed quality into. */
function sourceText(result: StreamSourceResult): string {
  const s = result.stream;
  return [s.name, s.title, s.behaviorHints?.filename]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join("\n");
}

/** Detect a coarse resolution tier from free text (excludes CAM — see below). */
export function detectResolution(text: string): QualityTier {
  if (!text) return "unknown";
  if (/\b(4k|uhd|2160p)\b/i.test(text)) return "2160p";
  if (/\b(1440p|qhd)\b/i.test(text)) return "1440p";
  if (/\b(1080p|fhd|full[\s.-]?hd)\b/i.test(text)) return "1080p";
  if (/\b(720p|hd)\b/i.test(text)) return "720p";
  if (/\b(480p|sd)\b/i.test(text)) return "480p";
  return "unknown";
}

/** Detect CAM / TS / TELESYNC / SCREENER-style low-quality captures. */
export function detectBadCamSource(text: string): boolean {
  if (!text) return false;
  return /\b(cam|camrip|hdcam|ts|hdts|telesync|telecine|dvdscr|screener)\b/i.test(
    text,
  );
}

/** Rank a single source: playability, CAM flag, and quality tier. */
export function rankStreamSource(
  source: StreamSourceResult,
  _settings?: RankingOptions,
): StreamRank {
  const text = sourceText(source);
  const classified = classifyStream(source.stream);
  const playable =
    (classified.kind === "playable" || classified.kind === "hls") &&
    typeof classified.url === "string";

  const cam = detectBadCamSource(text);
  // CAM always ranks lowest, regardless of any resolution token it may carry.
  const tier: QualityTier = cam ? "cam" : detectResolution(text);
  return { playable, cam, tier, tierRank: TIER_RANK[tier] };
}

/** The order of tier-ranks to try, given the preferred quality. */
function ladderFor(preferred: PreferredSourceQuality): number[] {
  // Full descending set including CAM (-1) at the very end.
  const ALL = [5, 4, 3, 2, 1, 0, -1];
  if (preferred === "best" || preferred === "first") return ALL;

  const targetRank =
    preferred === "2160p" ? 5 : preferred === "1080p" ? 3 : /* 720p */ 2;

  // Prefer the target, then progressively LOWER detected qualities, then
  // HIGHER ones, then unknown, then CAM. (Detected lower beats higher per spec.)
  const lower: number[] = [];
  for (let r = targetRank - 1; r >= 1; r--) lower.push(r);
  const higher: number[] = [];
  for (let r = targetRank + 1; r <= 5; r++) higher.push(r);
  return [targetRank, ...lower, ...higher, 0, -1];
}

interface Entry {
  result: StreamSourceResult;
  rank: StreamRank;
  order: number;
}

/**
 * Choose the best playable source, or null when none are playable in MPV.
 * Honors the preferred quality ladder and CAM handling. Original (addon/dedup)
 * order breaks ties and drives "first available".
 */
export function chooseBestSource(
  sources: StreamSourceResult[],
  settings: RankingOptions,
): StreamSourceResult | null {
  const entries: Entry[] = sources.map((result, order) => ({
    result,
    rank: rankStreamSource(result, settings),
    order,
  }));

  const playable = entries.filter((e) => e.rank.playable);
  if (playable.length === 0) return null;

  const nonCam = playable.filter((e) => !e.rank.cam);
  const cam = playable.filter((e) => e.rank.cam);

  // When hiding CAM, only consider CAM if there is literally nothing else.
  const pool =
    settings.hideCamSources && nonCam.length > 0 ? nonCam : playable;

  // "First available": first direct playable in original order (CAM already
  // excluded from `pool` when hiding and alternatives exist).
  if (settings.preferredSourceQuality === "first") {
    // Prefer a non-CAM entry if the pool still contains a mix.
    const ordered = [...pool].sort((a, b) => a.order - b.order);
    const firstNonCam = ordered.find((e) => !e.rank.cam);
    return (firstNonCam ?? ordered[0]).result;
  }

  const ladder = ladderFor(settings.preferredSourceQuality);
  for (const targetRank of ladder) {
    const matches = pool
      .filter((e) => e.rank.tierRank === targetRank)
      .sort((a, b) => a.order - b.order);
    if (matches.length > 0) return matches[0].result;
  }

  // Safety net: nothing matched the ladder (shouldn't happen) — first playable.
  return [...pool].sort((a, b) => a.order - b.order)[0]?.result ?? null;
}
