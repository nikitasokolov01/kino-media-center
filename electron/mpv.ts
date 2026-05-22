// Main-process MPV launcher and availability probe.
//
// Stage 1: launch MPV as a detached external process. No shell, no string
// interpolation into a command line, no arbitrary args from the renderer.
// All inputs are validated here before spawn().
//
// Stage 2 (mpv-ipc) is now wired: MPV is launched with
// `--input-ipc-server=<pipe>` and the main process connects to that pipe to
// poll playback state for watch-progress tracking. See electron/mpvIpc.ts.
//
// Future stage (deliberately NOT in this build — see playerBackends.ts):
//   - Stage 3 (mpv-embedded): native window-handle embedding or libmpv via
//                             a Node native addon.

import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { getAppSettings } from "./db.js";
import {
  MpvIpcSession,
  type MpvProgressContext,
  type MpvPlaybackPreferences,
  type MpvStateSnapshot,
  type MpvCommandResult,
} from "./mpvIpc.js";

// Control actions the renderer can send to the active MPV session. Mirrors
// MpvControlAction in src/core/player/types.ts but typed locally so this file
// doesn't import from the renderer source tree at runtime.
export type MpvControlAction =
  | { kind: "play-pause" }
  | { kind: "stop" }
  | { kind: "seek"; deltaSeconds: number }
  | { kind: "seek-absolute"; seconds: number }
  | { kind: "cycle-audio" }
  | { kind: "cycle-sub" }
  | { kind: "set-audio"; id: number }
  | { kind: "set-sub"; id: number | "off" };

/** Live state returned to the renderer; adds session liveness to the snapshot. */
export interface MpvPlaybackState extends MpvStateSnapshot {
  active: boolean;
  pid?: number;
}

// ---- Active session registry --------------------------------------------
// Only ONE MPV instance is active at a time (the app's UX is one playback
// window). We track both the IPC session (for controls + progress) and the
// child process (so we can hard-stop a stale one). Both are cleared when MPV
// exits. This never affects progress tracking — the session object here is the
// same one the progress poller uses.
let activeSession: MpvIpcSession | null = null;
let activeChild: ChildProcess | null = null;
let activePid: number | undefined;

function clearActive(session: MpvIpcSession | null, child: ChildProcess | null) {
  if (session && activeSession === session) activeSession = null;
  if (child && activeChild === child) {
    activeChild = null;
    activePid = undefined;
  }
}

/**
 * Stop the current MPV (if any) before launching a new source. Saves progress
 * first (best-effort), asks MPV to quit cleanly over IPC, tears down the IPC
 * session (timers/pipe/listeners), and force-kills the process if it lingers.
 */
async function stopActiveSession(): Promise<void> {
  const session = activeSession;
  const child = activeChild;
  // Detach immediately so a late exit handler can't fight a new launch.
  activeSession = null;
  activeChild = null;
  activePid = undefined;

  if (session) {
    try {
      await session.flush(); // persist the latest position before closing
    } catch {
      /* ignore */
    }
    try {
      await session.quit(); // ask MPV to exit cleanly
    } catch {
      /* ignore */
    }
    session.stop(); // clear poll timer + destroy socket + drop listeners
  }

  if (child && child.exitCode === null && child.signalCode === null) {
    // Give MPV a moment to honor `quit`, then force-kill if still alive.
    setTimeout(() => {
      try {
        if (child.exitCode === null && child.signalCode === null) child.kill();
      } catch {
        /* ignore */
      }
    }, 1500);
  }
}

// What we accept on the IPC boundary. Mirrors PlayableStreamPayload in
// src/core/player/types.ts but typed locally so this file doesn't import from
// the renderer source tree at runtime.
export interface MpvPayload {
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
  /** Needed to persist watch progress; without it, tracking is skipped. */
  profileId?: number;
  /** Resume position in seconds → passed to MPV as `--start=<sec>`. */
  startSeconds?: number;
  /** @deprecated old single-track field; superseded by `subtitles`. */
  subtitleUrl?: string;
  /**
   * All auto-collected subtitle tracks. Each valid http(s) URL becomes a
   * repeated `--sub-file=<url>`; `lang` lets us match MPV's external tracks
   * back to a language for preferred-language selection.
   */
  subtitles?: Array<{ url: string; lang?: string; name?: string }>;
  /**
   * Effective preferred audio language for this playback (renderer-resolved,
   * accounting for anime vs. global default). "" = no preference. When a
   * string is provided it overrides the global `audioLanguage` setting.
   */
  audioLanguageOverride?: string;
}

export interface MpvOpenResult {
  ok: boolean;
  pid?: number;
  error?: string;
  /**
   * True if the JSON-IPC pipe connected and progress tracking is running.
   * False means playback still works but progress won't be recorded.
   */
  progressTracking?: boolean;
}

/** Build a per-session IPC pipe path (Windows named pipe / Unix socket). */
function makePipeName(): string {
  const id = randomUUID();
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\media-center-mpv-${id}`;
  }
  return path.join(os.tmpdir(), `media-center-mpv-${id}.sock`);
}

export interface MpvAvailability {
  available: boolean;
  path: string;
  version?: string;
  error?: string;
}

function isHttpUrl(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length === 0) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function buildWindowTitle(p: MpvPayload): string {
  const parts: string[] = [p.mediaTitle];
  if (p.episodeTitle) {
    if (typeof p.season === "number" && typeof p.episode === "number") {
      parts.push(
        `S${String(p.season).padStart(2, "0")}E${String(p.episode).padStart(2, "0")}`,
      );
    }
    parts.push(p.episodeTitle);
  }
  return parts.filter(Boolean).join(" · ");
}

/**
 * Spawn MPV as a detached child with a JSON-IPC server, then connect to the
 * pipe for progress tracking. Playback is a *progressive enhancement*: if the
 * IPC pipe never connects, MPV still plays and we resolve with
 * `progressTracking: false` so the UI can warn the user.
 *
 * Order of operations:
 *   1. Validate inputs (http(s) URL, etc.).
 *   2. spawn() with a ~300ms window to catch ENOENT-style spawn errors.
 *   3. If spawn ok, attach the IPC session and await its connection.
 *   4. Resolve { ok, pid, progressTracking }.
 */
export async function openInMpv(payload: MpvPayload): Promise<MpvOpenResult> {
  // ---- Validate inputs -----------------------------------------------------
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "Invalid payload." };
  }
  if (!isHttpUrl(payload.streamUrl)) {
    return {
      ok: false,
      error: "Refusing to launch MPV: stream URL must be http(s).",
    };
  }
  if (typeof payload.mediaTitle !== "string") {
    return { ok: false, error: "Missing mediaTitle." };
  }

  // Single active instance: stop any currently-playing MPV (saving its progress
  // first) before launching the new source.
  await stopActiveSession();

  const settings = getAppSettings();
  const { mpvPath } = settings;
  const title = buildWindowTitle(payload);
  const pipePath = makePipeName();

  // Collect valid http(s) subtitle URLs and remember each one's language so the
  // session can match MPV's external sub tracks back to a language later.
  const subtitleLangByUrl: Record<string, string> = {};
  const subtitleUrls: string[] = [];
  if (Array.isArray(payload.subtitles)) {
    for (const sub of payload.subtitles) {
      if (!sub || !isHttpUrl(sub.url)) continue;
      if (subtitleUrls.includes(sub.url)) continue;
      subtitleUrls.push(sub.url);
      if (typeof sub.lang === "string" && sub.lang.trim()) {
        subtitleLangByUrl[sub.url] = sub.lang.trim();
      }
    }
  }

  // IMPORTANT: args is an array. shell:false ensures no shell interpretation
  // of the URL or title — they're passed as separate argv entries.
  //
  // Default args:
  //   --profile=fast               faster startup + lower CPU for streaming
  //   --cache=yes                  enable the demuxer cache
  //   --demuxer-max-bytes=150M     forward cache (pre-pull ahead of playhead)
  //   --demuxer-max-back-bytes=75M backward cache for small seeks
  //   --demuxer-readahead-secs=30  read ahead 30 s of content
  //   --network-timeout=15         fail fast on dead URLs
  //   --really-quiet               suppress MPV's startup chatter
  //   --input-ipc-server=<pipe>    enable JSON IPC for progress tracking
  //   --start=<sec>                resume position (added only when provided)
  //
  // TODO: surface a "Custom MPV arguments" field in Settings.
  const args = [
    "--force-window=yes",
    "--profile=fast",
    "--cache=yes",
    "--demuxer-max-bytes=150M",
    "--demuxer-max-back-bytes=75M",
    "--demuxer-readahead-secs=30",
    "--network-timeout=15",
    "--really-quiet",
    `--input-ipc-server=${pipePath}`,
    `--title=${title}`,
  ];
  if (typeof payload.startSeconds === "number" && payload.startSeconds > 0) {
    args.push(`--start=${Math.floor(payload.startSeconds)}`);
  }
  // Auto-load ALL collected subtitle tracks. Each is added with a repeated
  // `--sub-file=<url>`; only http(s) URLs are accepted (same safety rule as the
  // stream URL). Bad URLs are dropped so they can never block playback.
  for (const subUrl of subtitleUrls) {
    args.push(`--sub-file=${subUrl}`);
  }
  // Back-compat: honor the deprecated single field if a caller still sends it.
  if (isHttpUrl(payload.subtitleUrl) && !subtitleUrls.includes(payload.subtitleUrl)) {
    args.push(`--sub-file=${payload.subtitleUrl}`);
  }
  // If auto-enable is off, start with subtitles disabled. Tracks are still
  // loaded (above) — the user turns one on from the in-player Subs menu.
  if (!settings.autoEnableSubtitles) {
    args.push("--sid=no");
  }
  args.push(payload.streamUrl); // URL is always the final argument

  // ---- Spawn + detect immediate failure ------------------------------------
  let child: ChildProcess | undefined;
  const spawnError = await new Promise<MpvOpenResult | null>((resolve) => {
    let done = false;
    const finish = (r: MpvOpenResult | null) => {
      if (done) return;
      done = true;
      resolve(r);
    };

    try {
      child = spawn(mpvPath, args, {
        detached: true,
        stdio: "ignore",
        shell: false,
      });
    } catch (err) {
      finish({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    child.on("error", (err) => {
      const msg =
        err && (err as NodeJS.ErrnoException).code === "ENOENT"
          ? `MPV was not found at "${mpvPath}". Install MPV or set its path in Settings.`
          : err.message;
      finish({ ok: false, error: msg });
    });

    // Don't keep the Electron process alive on behalf of MPV.
    child.unref();

    // No error within 300ms → assume the process started cleanly.
    setTimeout(() => finish(null), 300);
  });

  if (spawnError) return spawnError;
  // child is guaranteed assigned here (spawnError would be set otherwise).
  const proc = child!;
  // Register the process immediately so single-instance enforcement can stop it
  // even if the IPC pipe never connects.
  activeChild = proc;
  activePid = proc.pid;

  // ---- IPC session: progress tracking (best effort) + control --------------
  // We always create a session so the Now Playing controls work, even when no
  // profile is attached. Progress is only *persisted* when a profileId is
  // present (enforced in MpvIpcSession.persist), so progress-tracking behavior
  // is unchanged from before: `progressTracking` is true only when we have a
  // profile AND the IPC pipe connected.
  const context: MpvProgressContext = {
    profileId: typeof payload.profileId === "number" ? payload.profileId : null,
    type: payload.type,
    mediaId: payload.mediaId,
    playableId: payload.playableId,
    mediaTitle: payload.mediaTitle,
    episodeTitle: payload.episodeTitle ?? null,
    season: payload.season ?? null,
    episode: payload.episode ?? null,
    poster: payload.poster ?? null,
    streamTitle: payload.streamTitle ?? null,
  };
  // Renderer-resolved audio override (anime vs. global) wins when provided;
  // otherwise fall back to the global setting.
  const audioLanguage =
    typeof payload.audioLanguageOverride === "string"
      ? payload.audioLanguageOverride
      : settings.audioLanguage;
  const preferences: MpvPlaybackPreferences = {
    autoEnableSubtitles: settings.autoEnableSubtitles,
    subtitleLanguage: settings.subtitleLanguage,
    audioLanguage,
    subtitleLangByUrl,
  };
  const session = new MpvIpcSession(pipePath, context, preferences);
  // Stop tracking + drop the active references when MPV exits.
  proc.on("exit", () => {
    session.stop();
    clearActive(session, proc);
  });

  let progressTracking = false;
  try {
    const connected = await session.connect();
    if (connected) {
      activeSession = session;
      progressTracking = typeof payload.profileId === "number";
    }
  } catch {
    progressTracking = false;
  }

  return { ok: true, pid: proc.pid, progressTracking };
}

/**
 * Send a control action to the active MPV session. Resolves with
 * `{ ok:false }` (never throws) when there is no live session, so the renderer
 * can hide/disable controls gracefully. Playback is never affected by a failed
 * command — external MPV remains usable on its own window regardless.
 */
export async function mpvControl(
  action: MpvControlAction,
): Promise<MpvCommandResult> {
  const session = activeSession;
  if (!session || !session.isConnected) {
    return { ok: false, error: "No active MPV session." };
  }
  if (!action || typeof action !== "object") {
    return { ok: false, error: "Invalid control action." };
  }
  switch (action.kind) {
    case "play-pause":
      return session.togglePause();
    case "stop":
      return session.quit();
    case "seek":
      return session.seekRelative(action.deltaSeconds);
    case "seek-absolute":
      return session.seekAbsolute(action.seconds);
    case "cycle-audio":
      return session.cycleAudio();
    case "cycle-sub":
      return session.cycleSub();
    case "set-audio":
      return session.setAudioTrack(action.id);
    case "set-sub":
      return session.setSubtitleTrack(action.id);
    default:
      return { ok: false, error: "Unknown control action." };
  }
}

/**
 * Read a live snapshot of the active MPV session for the Now Playing bar.
 * Returns `{ active:false }` when nothing is playing.
 */
export async function mpvGetState(): Promise<MpvPlaybackState> {
  const session = activeSession;
  if (!session || !session.isConnected) {
    return {
      active: false,
      timePos: null,
      duration: null,
      paused: false,
      title: null,
      audioTracks: 0,
      currentAudioId: null,
      subTracks: 0,
      currentSubId: null,
      audioTrackList: [],
      subTrackList: [],
    };
  }
  const snapshot = await session.getState();
  return { active: true, pid: activePid, ...snapshot };
}

/**
 * Probe MPV by running `<mpvPath> --version` with shell:false. Resolves with
 * `available: true` and the parsed version on success.
 */
export function checkMpvAvailable(): Promise<MpvAvailability> {
  const { mpvPath } = getAppSettings();
  return new Promise<MpvAvailability>((resolve) => {
    let child;
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (r: MpvAvailability) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    try {
      child = spawn(mpvPath, ["--version"], { shell: false });
    } catch (err) {
      finish({
        available: false,
        path: mpvPath,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      const msg = (err as NodeJS.ErrnoException).code === "ENOENT"
        ? `MPV was not found at "${mpvPath}". Install MPV or set its path in Settings.`
        : err.message;
      finish({ available: false, path: mpvPath, error: msg });
    });
    child.on("close", (code) => {
      if (code === 0) {
        // First line looks like: "mpv 0.39.0 Copyright © ..."
        const firstLine = stdout.split(/\r?\n/)[0]?.trim() ?? "";
        const match = firstLine.match(/^mpv\s+([0-9][^\s]+)/i);
        finish({
          available: true,
          path: mpvPath,
          version: match?.[1] ?? firstLine,
        });
      } else {
        const tail = (stderr || stdout || "").trim().split(/\r?\n/).slice(-3).join("\n");
        finish({
          available: false,
          path: mpvPath,
          error: tail || `mpv exited with code ${code}`,
        });
      }
    });

    // Safety timeout so a misbehaving binary can't hang the probe forever.
    setTimeout(() => {
      if (settled) return;
      try { child?.kill(); } catch { /* ignore */ }
      finish({
        available: false,
        path: mpvPath,
        error: "Timed out waiting for `mpv --version` to respond.",
      });
    }, 5000);
  });
}
