// Types for the built-in player.
//
// `PlayableStream` is the unit handed from the source list to the player. It
// bundles the chosen stream with enough context (titles, poster, ids) that the
// player can render its header and persist watch progress without needing to
// re-query the meta addon.

import type { StremioStream } from "../../core/stremio/types.js";

export interface PlayableStream {
  type: "movie" | "series";
  /** The meta id — e.g. tt0133093 for The Matrix or a series show id. */
  mediaId: string;
  /** Movie id, or episode id for series. This is what /stream takes. */
  playableId: string;
  mediaTitle: string;
  episodeTitle?: string;
  season?: number;
  episode?: number;
  poster?: string;
  stream: StremioStream;
  /** Which addon supplied this stream — for the player header byline. */
  source?: {
    addonId: string;
    addonName: string;
  };
}

/** Coarse classification of what we can do with a stream right now. */
export type PlayabilityKind =
  | "playable"      // direct URL we'll try in the HTML5 player
  | "hls"           // .m3u8 — needs hls.js
  | "external"      // open externalUrl in OS browser
  | "youtube"       // ytId — not playable in v1
  | "torrent"       // infoHash — needs a resolver, not in v1
  | "unsupported";  // nothing usable

export interface PlayabilityResult {
  kind: PlayabilityKind;
  /** Best-effort container/format guess for the `playable`/`hls` cases. */
  format?: "mp4" | "mkv" | "webm" | "hls" | "dash" | "unknown";
  /** URL the player should load, when applicable. */
  url?: string;
  /** Human-readable reason for non-playable cases, shown in the UI. */
  reason?: string;
}
