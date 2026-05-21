// Player backend abstraction.
//
// The renderer asks for "play this stream" by handing a backend a
// PlayableStreamPayload. Each backend (browser, mpv-external, future
// mpv-ipc, mpv-embedded) gets the same payload but reaches the user in a
// different way. This keeps StreamCard / Settings UI ignorant of how MPV
// actually starts.

export type PlayerBackend =
  | "browser"              // existing HTML5 + hls.js player (PlayerPage)
  | "mpv-external"         // child_process.spawn("mpv", [...]); detached
  | "mpv-ipc"              // future: --input-ipc-server, JSON commands
  | "mpv-embedded-future"; // future: libmpv / mpv render API / native addon

/**
 * Lean payload sent across the IPC boundary to launch a stream. We
 * deliberately do NOT send the full StremioStream object — only what an
 * external player needs plus titles for the window/progress bookkeeping.
 */
export interface PlayableStreamPayload {
  type: "movie" | "series";
  mediaId: string;
  playableId: string;
  mediaTitle: string;
  episodeTitle?: string;
  season?: number;
  episode?: number;
  poster?: string;
  streamUrl: string;
  streamTitle?: string;
  streamName?: string;
  /** Needed by the main process to persist watch progress over MPV IPC. */
  profileId?: number;
  /** Resume position in seconds — becomes MPV's `--start=<sec>`. */
  startSeconds?: number;
  /**
   * @deprecated Single-track field from the old pre-play picker. No longer set
   * by the UI; kept so older callers/payloads still type-check. Use
   * `subtitles` instead.
   */
  subtitleUrl?: string;
  /**
   * All auto-collected subtitle tracks for this playable. Each valid http(s)
   * URL becomes a repeated `--sub-file=<url>` on the MPV command line; `lang`
   * lets the main process match MPV's external tracks back to a language for
   * preferred-language selection and nicer track labels.
   */
  subtitles?: Array<{ url: string; lang?: string; name?: string }>;
}

export interface MpvOpenResult {
  ok: boolean;
  pid?: number;
  error?: string;
  /**
   * True if the MPV JSON-IPC pipe connected and progress tracking is running.
   * False means playback works but progress won't be recorded — the UI shows
   * a non-blocking warning.
   */
  progressTracking?: boolean;
}

export interface MpvAvailability {
  available: boolean;
  /** Resolved path used to invoke MPV (defaults to "mpv" on PATH). */
  path: string;
  /** Parsed version string from `mpv --version` when available. */
  version?: string;
  /** Error message from spawn/exit when not available. */
  error?: string;
}

/**
 * Control actions the renderer can send to the active external-MPV session
 * over JSON-IPC (Track 1). Mirrors MpvControlAction in electron/mpv.ts.
 */
export type MpvControlAction =
  | { kind: "play-pause" }
  | { kind: "stop" }
  | { kind: "seek"; deltaSeconds: number }
  | { kind: "seek-absolute"; seconds: number }
  | { kind: "cycle-audio" }
  | { kind: "cycle-sub" }
  | { kind: "set-audio"; id: number }
  | { kind: "set-sub"; id: number | "off" };

export interface MpvControlResult {
  ok: boolean;
  error?: string;
}

/** One audio or subtitle track for the in-player track menus. */
export interface MpvTrack {
  id: number;
  lang: string | null;
  title: string | null;
  selected: boolean;
}

/**
 * Live snapshot of the active external-MPV session, polled by the Now Playing
 * bar. `active` is false when nothing is playing (or IPC isn't connected).
 */
export interface MpvPlaybackState {
  active: boolean;
  pid?: number;
  timePos: number | null;
  duration: number | null;
  paused: boolean;
  title: string | null;
  audioTracks: number;
  currentAudioId: number | null;
  subTracks: number;
  currentSubId: number | null;
  audioTrackList: MpvTrack[];
  subTrackList: MpvTrack[];
}

export type DefaultPlayerSetting = "browser" | "mpv";

export interface AppSettings {
  /** Which backend the user prefers when both are viable. */
  defaultPlayer: DefaultPlayerSetting;
  /** MPV executable path. Defaults to "mpv" (looked up on PATH). */
  mpvPath: string;
  /**
   * When true, try to enable subtitles after MPV starts (preferring
   * `subtitleLanguage`). When false, tracks are still auto-loaded but disabled.
   */
  autoEnableSubtitles: boolean;
  /** Preferred subtitle language ("en"/"eng"/"English"); "" = no preference. */
  subtitleLanguage: string;
  /** Preferred audio language ("ja"/"jpn"/"Japanese"); "" = original/auto. */
  audioLanguage: string;
}

/** Per-stream-format capability hints used by the action picker. */
export interface BackendCapability {
  id: PlayerBackend;
  label: string;
  description: string;
  /**
   * True if this backend is wired up *right now*. mpv-ipc and
   * mpv-embedded-future return false in this build — they exist in the type
   * so the abstraction is forward-compatible.
   */
  implemented: boolean;
}
