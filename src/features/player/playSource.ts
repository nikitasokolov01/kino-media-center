// Shared "play this source in MPV" routine.
//
// Used by both the per-card "Play with MPV" button and the SourcesSection
// "Play Best Source" button so there is exactly one place that: collects
// subtitles, builds the PlayableStreamPayload (incl. the resolved audio
// language), and launches MPV. UI state (spinners, error banners) stays in the
// callers; this function is pure orchestration and never throws.

import { playWithMpv } from "../../core/player/mpvExternal.js";
import { collectSubtitles } from "./subtitles.js";
import type {
  MpvOpenResult,
  PlayableStreamPayload,
} from "../../core/player/types.js";
import type { StreamSourceResult } from "../../core/stremio/types.js";
import type { AddonRow } from "../../types/preload.js";

export interface PlaySourceParams {
  result: StreamSourceResult;
  type: "movie" | "series";
  mediaId: string;
  playableId: string;
  mediaTitle: string;
  mediaPoster?: string;
  episodeTitle?: string;
  season?: number;
  episode?: number;
  startSeconds?: number;
  /** Addons used to auto-collect subtitles (filtered to subtitle-capable). */
  subtitleAddons?: AddonRow[];
  profileId?: number;
  /** Resolved preferred audio language ("" = no preference / keep default). */
  audioLanguageOverride?: string;
}

export async function playSourceWithMpv(
  p: PlaySourceParams,
): Promise<MpvOpenResult> {
  const s = p.result.stream;
  if (!s.url) {
    return { ok: false, error: "Stream has no direct URL." };
  }

  // Auto-collect every available subtitle track. Failures never block playback.
  let subtitles: PlayableStreamPayload["subtitles"] = [];
  try {
    subtitles = await collectSubtitles(
      p.subtitleAddons ?? [],
      p.type,
      p.playableId,
    );
  } catch {
    subtitles = [];
  }
  if (import.meta.env.DEV) {
    console.log(
      `[subtitles] auto-loading ${subtitles?.length ?? 0} track(s) into MPV for ${p.type} ${p.playableId}`,
    );
  }

  const payload: PlayableStreamPayload = {
    type: p.type,
    mediaId: p.mediaId,
    playableId: p.playableId,
    mediaTitle: p.mediaTitle,
    episodeTitle: p.episodeTitle,
    season: p.season,
    episode: p.episode,
    poster: p.mediaPoster,
    streamUrl: s.url,
    streamTitle: s.title,
    streamName: s.name,
    profileId: p.profileId,
    startSeconds:
      typeof p.startSeconds === "number" && p.startSeconds > 0
        ? p.startSeconds
        : undefined,
    subtitles,
    audioLanguageOverride: p.audioLanguageOverride,
  };

  return playWithMpv(payload);
}
