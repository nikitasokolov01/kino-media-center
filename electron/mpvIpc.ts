// MPV JSON IPC client (Stage 2 + Track 1 controls).
//
// MPV is launched with `--input-ipc-server=<pipe>` (a Windows named pipe or a
// Unix socket). This module connects to that pipe from the Electron MAIN
// process, polls playback state every 5 seconds, and persists watch progress
// to SQLite. It's a *progressive enhancement*: if the pipe never connects,
// playback continues unaffected — we just don't track progress.
//
// Track 1 adds *control* over the same socket: the session can send commands
// (pause/play, seek, quit, cycle audio/subtitle tracks) and report a live state
// snapshot for the in-app "Now Playing" bar. This is purely additive — the
// progress-tracking poll loop is unchanged.
//
// JSON IPC protocol (newline-delimited):
//   send:    {"command": ["get_property", "time-pos"], "request_id": 7}\n
//   receive: {"error": "success", "data": 123.4, "request_id": 7}\n
//   events:  {"event": "..."}                (ignored here)
//
// Reference: https://mpv.io/manual/master/#json-ipc

import net from "node:net";
import { upsertWatchProgress } from "./db.js";

export interface MpvProgressContext {
  /**
   * Profile to attribute watch progress to. May be null for a control-only
   * session (no profile attached) — in that case progress is NOT persisted but
   * playback control + state snapshots still work.
   */
  profileId: number | null;
  type: "movie" | "series";
  mediaId: string;
  playableId: string;
  mediaTitle: string;
  episodeTitle?: string | null;
  season?: number | null;
  episode?: number | null;
  poster?: string | null;
  streamTitle?: string | null;
}

/** One audio or subtitle track, as exposed to the renderer's track menus. */
export interface MpvTrack {
  id: number;
  /** Best available label: language, else title, else null (UI falls back). */
  lang: string | null;
  title: string | null;
  selected: boolean;
}

/**
 * Live snapshot of the active MPV session, polled by the renderer for the
 * Now Playing bar. All numeric fields are null until MPV reports them.
 */
export interface MpvStateSnapshot {
  timePos: number | null;
  duration: number | null;
  paused: boolean;
  title: string | null;
  /** Total selectable audio tracks and the currently-selected one (null = off). */
  audioTracks: number;
  currentAudioId: number | null;
  /** Total selectable subtitle tracks and the currently-selected one (null = off). */
  subTracks: number;
  currentSubId: number | null;
  /** Full track lists for the in-player menus. */
  audioTrackList: MpvTrack[];
  subTrackList: MpvTrack[];
}

export interface MpvCommandResult {
  ok: boolean;
  error?: string;
}

/**
 * Playback preferences applied once after MPV loads the file. Subtitle/audio
 * language selection is best-effort: if no matching track exists, MPV's default
 * is kept.
 */
export interface MpvPlaybackPreferences {
  autoEnableSubtitles: boolean;
  /** Preferred subtitle language ("en"/"eng"/"English"); "" = no preference. */
  subtitleLanguage: string;
  /** Preferred audio language; "" = original/auto. */
  audioLanguage: string;
  /**
   * url → language for the externally-added subtitle files. Lets us recover the
   * language of MPV's external sub tracks (matched via `external-filename`),
   * since `--sub-file` carries no language metadata.
   */
  subtitleLangByUrl?: Record<string, string>;
}

interface TrackListEntry {
  type?: string;
  id?: number;
  selected?: boolean;
  lang?: string;
  title?: string;
  external?: boolean;
  "external-filename"?: string;
}

const POLL_INTERVAL_MS = 5_000;
const CONNECT_RETRY_MS = 300;
const CONNECT_TIMEOUT_MS = 8_000;
const REQUEST_TIMEOUT_MS = 2_000;
const COMPLETED_THRESHOLD = 0.9;
// Mark complete when within this many seconds of the end (covers long films
// where 90% is still 15+ minutes from done, and end credits).
const COMPLETED_REMAINING_SECONDS = 900;

interface IpcMessage {
  error?: string;
  data?: unknown;
  request_id?: number;
  event?: string;
}

// Common ISO-639 aliases so loose user input ("English"/"eng"/"en") matches a
// track's `lang` ("en"/"eng"/...). Not exhaustive — falls back to a generic
// substring/equality check for anything not listed.
const LANG_ALIASES: Record<string, string[]> = {
  en: ["en", "eng", "english"],
  ja: ["ja", "jpn", "jp", "japanese"],
  es: ["es", "spa", "esp", "spanish", "español", "espanol"],
  fr: ["fr", "fra", "fre", "french", "français", "francais"],
  de: ["de", "ger", "deu", "german", "deutsch"],
  it: ["it", "ita", "italian", "italiano"],
  pt: ["pt", "por", "portuguese", "português", "portugues"],
  ru: ["ru", "rus", "russian"],
  zh: ["zh", "zho", "chi", "chinese", "mandarin"],
  ko: ["ko", "kor", "korean"],
  ar: ["ar", "ara", "arabic"],
  hi: ["hi", "hin", "hindi"],
  nl: ["nl", "dut", "nld", "dutch"],
  pl: ["pl", "pol", "polish"],
  tr: ["tr", "tur", "turkish"],
  sv: ["sv", "swe", "swedish"],
};

/** Expand a language token into its known alias set (lower-cased). */
function langTokens(value: string): Set<string> {
  const v = value.trim().toLowerCase();
  const out = new Set<string>();
  if (!v) return out;
  out.add(v);
  for (const aliases of Object.values(LANG_ALIASES)) {
    if (aliases.includes(v)) aliases.forEach((a) => out.add(a));
  }
  return out;
}

/**
 * True if a user preference like "English" matches a track's language/title.
 * Compares alias sets both ways, then falls back to substring containment.
 */
function languageMatches(
  pref: string,
  trackLang: string | null | undefined,
  trackTitle?: string | null,
): boolean {
  const p = pref.trim().toLowerCase();
  if (!p) return false;
  const prefTokens = langTokens(p);
  const candidates = [trackLang, trackTitle].filter(
    (c): c is string => typeof c === "string" && c.trim().length > 0,
  );
  for (const c of candidates) {
    const cl = c.trim().toLowerCase();
    if (prefTokens.has(cl)) return true;
    const cTokens = langTokens(cl);
    for (const t of prefTokens) {
      if (cTokens.has(t)) return true;
    }
    // Loose containment for free-text titles like "English (SDH)".
    if (cl.includes(p) || p.includes(cl)) return true;
  }
  return false;
}

export class MpvIpcSession {
  private socket: net.Socket | null = null;
  private buffer = "";
  private reqId = 0;
  private pending = new Map<number, (msg: IpcMessage) => void>();
  private pollTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private connected = false;
  private prefsApplied = false;

  constructor(
    private readonly pipePath: string,
    private readonly context: MpvProgressContext,
    private readonly preferences?: MpvPlaybackPreferences,
  ) {}

  /** True while the IPC socket is connected and the session isn't stopped. */
  get isConnected(): boolean {
    return this.connected && !this.stopped && this.socket !== null;
  }

  /**
   * Connect to the IPC pipe, retrying until CONNECT_TIMEOUT_MS elapses (MPV
   * needs a moment after spawn to create the pipe). Resolves true once
   * connected + polling, false if it gave up. Never rejects.
   */
  connect(): Promise<boolean> {
    const start = Date.now();
    return new Promise<boolean>((resolve) => {
      const attempt = () => {
        if (this.stopped) {
          resolve(false);
          return;
        }
        const sock = net.createConnection(this.pipePath);
        let settled = false;

        sock.on("connect", () => {
          settled = true;
          this.socket = sock;
          this.connected = true;
          sock.setEncoding("utf8");
          sock.on("data", (chunk: string) => this.onData(chunk));
          sock.on("close", () => this.handleSocketGone());
          sock.on("error", () => this.handleSocketGone());
          this.startPolling();
          resolve(true);
        });

        sock.on("error", () => {
          if (settled) return; // already connected; handled elsewhere
          sock.destroy();
          if (this.stopped || Date.now() - start >= CONNECT_TIMEOUT_MS) {
            resolve(false);
          } else {
            setTimeout(attempt, CONNECT_RETRY_MS);
          }
        });
      };
      attempt();
    });
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let msg: IpcMessage;
      try {
        msg = JSON.parse(line) as IpcMessage;
      } catch {
        continue;
      }
      if (typeof msg.request_id === "number" && this.pending.has(msg.request_id)) {
        const cb = this.pending.get(msg.request_id)!;
        this.pending.delete(msg.request_id);
        cb(msg);
      }
      // MPV pushes core events unprompted. We use "file-loaded" as the cue that
      // tracks (including external --sub-file subs) are available, so we can
      // apply language preferences exactly once.
      if (msg.event === "file-loaded" && !this.prefsApplied) {
        this.prefsApplied = true;
        void this.applyPreferences();
      }
    }
  }

  private send(command: unknown[]): Promise<IpcMessage> {
    const sock = this.socket;
    if (!sock) return Promise.reject(new Error("MPV IPC socket not connected"));
    const request_id = ++this.reqId;
    return new Promise<IpcMessage>((resolve, reject) => {
      this.pending.set(request_id, resolve);
      try {
        sock.write(JSON.stringify({ command, request_id }) + "\n");
      } catch (e) {
        this.pending.delete(request_id);
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      setTimeout(() => {
        if (this.pending.has(request_id)) {
          this.pending.delete(request_id);
          reject(new Error("MPV IPC request timed out"));
        }
      }, REQUEST_TIMEOUT_MS);
    });
  }

  private async getProperty<T = unknown>(name: string): Promise<T | null> {
    try {
      const msg = await this.send(["get_property", name]);
      if (msg.error && msg.error !== "success") return null;
      return (msg.data as T) ?? null;
    } catch {
      return null;
    }
  }

  // ---- Public control surface (Track 1) ------------------------------------
  //
  // These reuse the same socket as the progress poller. Each resolves with
  // { ok, error? } and never throws, so the renderer can surface a soft error
  // without affecting playback. A disconnected/stopped session returns ok:false.

  /** Send a raw MPV command (e.g. ["cycle","pause"]) and report success. */
  async command(args: unknown[]): Promise<MpvCommandResult> {
    if (!this.isConnected) {
      return { ok: false, error: "MPV is not connected." };
    }
    try {
      const msg = await this.send(args);
      if (msg.error && msg.error !== "success") {
        return { ok: false, error: msg.error };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Toggle pause/play. */
  togglePause(): Promise<MpvCommandResult> {
    return this.command(["cycle", "pause"]);
  }

  /** Seek by a relative number of seconds (negative = backward). */
  seekRelative(deltaSeconds: number): Promise<MpvCommandResult> {
    if (!Number.isFinite(deltaSeconds)) {
      return Promise.resolve({ ok: false, error: "Invalid seek delta." });
    }
    return this.command(["seek", deltaSeconds, "relative"]);
  }

  /** Cycle to the next audio track. */
  cycleAudio(): Promise<MpvCommandResult> {
    return this.command(["cycle", "aid"]);
  }

  /** Cycle to the next subtitle track (includes "off"). */
  cycleSub(): Promise<MpvCommandResult> {
    return this.command(["cycle", "sub"]);
  }

  /** Ask MPV to quit (closes its window). */
  quit(): Promise<MpvCommandResult> {
    return this.command(["quit"]);
  }

  /** Look up the language we recorded for an external sub file, by its URL. */
  private langForExternalSub(externalFilename: unknown): string | null {
    const map = this.preferences?.subtitleLangByUrl;
    if (!map || typeof externalFilename !== "string") return null;
    if (map[externalFilename]) return map[externalFilename];
    // MPV may report a normalized/decoded filename — match loosely.
    for (const [url, lang] of Object.entries(map)) {
      if (
        externalFilename === url ||
        externalFilename.includes(url) ||
        url.includes(externalFilename)
      ) {
        return lang;
      }
    }
    return null;
  }

  /** Split a raw track-list into typed audio/sub arrays for the menus. */
  private parseTracks(trackList: TrackListEntry[] | null): {
    audio: MpvTrack[];
    sub: MpvTrack[];
  } {
    const audio: MpvTrack[] = [];
    const sub: MpvTrack[] = [];
    if (!Array.isArray(trackList)) return { audio, sub };
    for (const t of trackList) {
      if (typeof t?.id !== "number") continue;
      const base: MpvTrack = {
        id: t.id,
        lang: typeof t.lang === "string" && t.lang ? t.lang : null,
        title: typeof t.title === "string" && t.title ? t.title : null,
        selected: t.selected === true,
      };
      if (t.type === "audio") {
        audio.push(base);
      } else if (t.type === "sub") {
        // Enrich external subs (added via --sub-file) with the language we
        // collected, since MPV doesn't know it otherwise.
        if (!base.lang && t.external) {
          base.lang = this.langForExternalSub(t["external-filename"]);
        }
        sub.push(base);
      }
    }
    return { audio, sub };
  }

  /**
   * Read a live snapshot of playback state for the Now Playing bar. Returns a
   * best-effort object; any property that fails to read is reported as null/0.
   */
  async getState(): Promise<MpvStateSnapshot> {
    const [timePos, duration, pause, mediaTitle, filename, aid, sid, trackList] =
      await Promise.all([
        this.getProperty<number>("time-pos"),
        this.getProperty<number>("duration"),
        this.getProperty<boolean>("pause"),
        this.getProperty<string>("media-title"),
        this.getProperty<string>("filename"),
        this.getProperty<unknown>("aid"),
        this.getProperty<unknown>("sid"),
        this.getProperty<TrackListEntry[]>("track-list"),
      ]);

    const { audio, sub } = this.parseTracks(trackList);

    return {
      timePos: typeof timePos === "number" ? timePos : null,
      duration: typeof duration === "number" ? duration : null,
      paused: pause === true,
      title:
        (typeof mediaTitle === "string" && mediaTitle) ||
        (typeof filename === "string" && filename) ||
        null,
      audioTracks: audio.length,
      currentAudioId: typeof aid === "number" ? aid : null,
      subTracks: sub.length,
      currentSubId: typeof sid === "number" ? sid : null,
      audioTrackList: audio,
      subTrackList: sub,
    };
  }

  // ---- Direct track / seek setters (used by the in-player menus) -----------

  setAudioTrack(id: number): Promise<MpvCommandResult> {
    if (!Number.isInteger(id)) {
      return Promise.resolve({ ok: false, error: "Invalid audio track id." });
    }
    return this.command(["set_property", "aid", id]);
  }

  setSubtitleTrack(id: number | "off"): Promise<MpvCommandResult> {
    if (id === "off") return this.command(["set_property", "sid", "no"]);
    if (!Number.isInteger(id)) {
      return Promise.resolve({ ok: false, error: "Invalid subtitle track id." });
    }
    return this.command(["set_property", "sid", id]);
  }

  seekAbsolute(seconds: number): Promise<MpvCommandResult> {
    if (!Number.isFinite(seconds) || seconds < 0) {
      return Promise.resolve({ ok: false, error: "Invalid seek position." });
    }
    return this.command(["seek", seconds, "absolute"]);
  }

  /**
   * Apply audio/subtitle language preferences once, after file-loaded. Pure
   * best-effort: any failure is swallowed and MPV's defaults are kept.
   */
  private async applyPreferences(): Promise<void> {
    const prefs = this.preferences;
    if (!prefs) return;
    try {
      const trackList = await this.getProperty<TrackListEntry[]>("track-list");
      const { audio, sub } = this.parseTracks(trackList);

      // Audio: switch to the preferred language if a matching track exists.
      const audioPref = prefs.audioLanguage.trim();
      if (audioPref) {
        const match = audio.find((t) => languageMatches(audioPref, t.lang, t.title));
        if (match && !match.selected) {
          await this.setAudioTrack(match.id);
        }
      }

      // Subtitles: respect the auto-enable toggle.
      if (!prefs.autoEnableSubtitles) {
        await this.setSubtitleTrack("off");
      } else {
        const subPref = prefs.subtitleLanguage.trim();
        if (subPref) {
          const match = sub.find((t) => languageMatches(subPref, t.lang, t.title));
          if (match && !match.selected) {
            await this.setSubtitleTrack(match.id);
          }
          // If no match: keep MPV's default (first loaded sub).
        }
      }
    } catch {
      // Best-effort only.
    }
  }

  /** Force an immediate progress poll+persist (used before stopping). */
  async flush(): Promise<void> {
    await this.poll();
  }

  private startPolling() {
    const tick = () => {
      void this.poll();
    };
    tick(); // immediate first read
    this.pollTimer = setInterval(tick, POLL_INTERVAL_MS);
  }

  private async poll() {
    if (this.stopped || !this.socket) return;
    // Query the spec'd properties. Only time-pos + duration are required to
    // persist; the rest are read for completeness / future use.
    const [timePos, duration, pause, filename, mediaTitle] = await Promise.all([
      this.getProperty<number>("time-pos"),
      this.getProperty<number>("duration"),
      this.getProperty<boolean>("pause"),
      this.getProperty<string>("filename"),
      this.getProperty<string>("media-title"),
    ]);

    void pause;
    void filename;
    void mediaTitle;

    if (
      typeof timePos === "number" &&
      typeof duration === "number" &&
      duration > 0 &&
      timePos >= 0
    ) {
      this.persist(timePos, duration);
    }
  }

  private persist(timePos: number, duration: number) {
    // Control-only sessions (no profile) never write progress.
    if (typeof this.context.profileId !== "number") return;
    // Complete when EITHER ≥90% watched OR within 15 minutes of the end.
    const completed =
      duration > 0 &&
      (timePos >= duration * COMPLETED_THRESHOLD ||
        duration - timePos <= COMPLETED_REMAINING_SECONDS);
    try {
      upsertWatchProgress({
        profileId: this.context.profileId,
        type: this.context.type,
        mediaId: this.context.mediaId,
        playableId: this.context.playableId,
        title: this.context.mediaTitle,
        episodeTitle: this.context.episodeTitle ?? null,
        poster: this.context.poster ?? null,
        streamTitle: this.context.streamTitle ?? null,
        season: this.context.season ?? null,
        episode: this.context.episode ?? null,
        progressSeconds: timePos,
        durationSeconds: duration,
        completed,
      });
    } catch {
      // DB write failures are non-fatal — playback isn't affected.
    }
  }

  private handleSocketGone() {
    // MPV quit (pipe closed) — stop cleanly. The last successful poll already
    // persisted the most recent position.
    this.stop();
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.connected = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch {
        /* ignore */
      }
      this.socket = null;
    }
    this.pending.clear();
  }
}
