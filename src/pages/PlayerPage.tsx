// Built-in Player v1 — /watch/:type/:id
//
// Reads the pending PlayableStream from the in-memory store (populated by
// StreamCard right before navigating). Renders the chosen stream in an
// HTML5 <video> element, with hls.js bolted on for .m3u8 sources.
//
// Hardened against the "stuck on Loading" failure modes:
//   - `classification` is memoized so the attach effect doesn't re-fire every
//     render and constantly reset the video src.
//   - 20-second timeout flips the UI into a clear error if the stream never
//     fires `loadedmetadata` / `canplay`.
//   - All key media events are wired and their state is reflected in the UI
//     and (in dev) the console + an on-screen debug panel.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useProfile } from "../state/ProfileContext.js";
import {
  classifyStream,
  formatTime,
} from "../features/player/playability.js";
import {
  clearPendingPlayable,
  getPendingPlayable,
} from "../features/player/store.js";
import type {
  PlayableStream,
  PlayabilityResult,
} from "../features/player/types.js";
import type { WatchProgress } from "../types/preload.js";

const PROGRESS_SAVE_INTERVAL_MS = 10_000;
const RESUME_EDGE_SECONDS = 30;
const LOAD_TIMEOUT_MS = 20_000;

const DEV = import.meta.env.DEV;
function devLog(...args: unknown[]): void {
  if (DEV) console.log("[PlayerPage]", ...args);
}

function streamHeaderTitle(s: PlayableStream): string {
  const lines = (s.stream.title ?? "").split("\n").filter(Boolean);
  return lines[0] ?? s.stream.name ?? "Stream";
}

function mediaErrorMessage(err: MediaError | null): string {
  if (!err) return "Playback failed for an unknown reason.";
  switch (err.code) {
    case 1: // MEDIA_ERR_ABORTED
      return "Playback was aborted.";
    case 2: // MEDIA_ERR_NETWORK
      return "Network error while loading the stream. It may be blocked by CORS, offline, or the URL is unreachable.";
    case 3: // MEDIA_ERR_DECODE
      return "Decoding error. The stream may use a codec your browser can't play (try a different source).";
    case 4: // MEDIA_ERR_SRC_NOT_SUPPORTED
      return "The source isn't supported. The URL may have expired, been blocked, or not be a direct video file.";
    default:
      return `Playback failed (code ${err.code}).`;
  }
}

interface HlsHandle {
  destroy(): void;
}

/**
 * Attach the stream to the <video> element. For HLS, dynamically imports
 * hls.js (no cost in the main bundle) and attaches it. Returns a cleanup
 * function the effect can call on unmount.
 */
async function attachSource(
  video: HTMLVideoElement,
  classification: PlayabilityResult,
): Promise<() => void> {
  const url = classification.url;
  if (!url) throw new Error("No URL to attach.");

  if (classification.kind === "hls") {
    // Safari (and a few other browsers) can play HLS natively — if so, no need
    // to load hls.js.
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      devLog("attaching HLS natively", url);
      video.src = url;
      video.load();
      return () => {
        video.removeAttribute("src");
        video.load();
      };
    }

    devLog("loading hls.js for", url);
    const HlsMod = await import("hls.js");
    const Hls = HlsMod.default;
    if (!Hls.isSupported()) {
      throw new Error("HLS is not supported in this browser.");
    }
    const hls = new Hls() as unknown as HlsHandle & {
      loadSource(u: string): void;
      attachMedia(v: HTMLVideoElement): void;
      on(event: string, handler: (...args: unknown[]) => void): void;
    };
    const ERROR_EVENT = (Hls as unknown as { Events: { ERROR: string } }).Events
      .ERROR;
    hls.on(ERROR_EVENT, (_event, data: unknown) => {
      const d = data as { fatal?: boolean; type?: string; details?: string };
      devLog("hls error", d);
      if (d.fatal) {
        const msg = `HLS error: ${d.details ?? d.type ?? "unknown"}`;
        video.dispatchEvent(new CustomEvent("hls-fatal", { detail: msg }));
      }
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    return () => {
      devLog("destroying hls.js instance");
      hls.destroy();
    };
  }

  // Direct video src for everything else (mp4/mkv/webm/unknown).
  devLog("attaching direct src", url);
  video.src = url;
  video.load();
  return () => {
    video.removeAttribute("src");
    video.load();
  };
}

export default function PlayerPage() {
  const { type: rawType, id: rawId } = useParams<{ type: string; id: string }>();
  const type = decodeURIComponent(rawType ?? "");
  const mediaId = decodeURIComponent(rawId ?? "");
  const navigate = useNavigate();
  const { profile } = useProfile();

  // ----- Pending stream / no-stream state -----------------------------------
  const [playable] = useState<PlayableStream | null>(() => {
    const p = getPendingPlayable();
    if (!p) return null;
    if (p.type !== type || p.mediaId !== mediaId) return null;
    return p;
  });

  // Memoize classification so the attach effect's deps stay stable across
  // re-renders — this is what was causing the infinite re-attach loop and the
  // "stuck on Loading" symptom.
  const classification = useMemo<PlayabilityResult | null>(
    () => (playable ? classifyStream(playable.stream) : null),
    [playable],
  );
  const playerUrl = classification?.url ?? null;
  const canPlay =
    classification?.kind === "playable" || classification?.kind === "hls";

  // Dev-only: dump the full state so it's easy to verify what got passed in.
  useEffect(() => {
    if (!DEV) return;
    devLog("route params", { type, mediaId });
    devLog("pending playable", playable);
    if (playable) {
      devLog("stream.url", playable.stream.url);
      devLog("stream.externalUrl", playable.stream.externalUrl);
      devLog("stream.infoHash", playable.stream.infoHash);
      devLog("stream.ytId", playable.stream.ytId);
    }
    devLog("classification", classification);
  }, [type, mediaId, playable, classification]);

  // ----- Video state --------------------------------------------------------
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [duration, setDuration] = useState(0);
  const [lastEvent, setLastEvent] = useState<string>("(none)");
  const [timedOut, setTimedOut] = useState(false);

  // ----- Resume prompt ------------------------------------------------------
  const [savedProgress, setSavedProgress] = useState<WatchProgress | null>(null);
  const [resumeDecision, setResumeDecision] = useState<"pending" | "resume" | "start">(
    "pending",
  );

  // Load saved progress (best-effort) before deciding what to do on play.
  useEffect(() => {
    if (!profile || !playable) return;
    let cancelled = false;
    window.mediaCenter.progress
      .get({
        profileId: profile.id,
        mediaId: playable.mediaId,
        playableId: playable.playableId,
      })
      .then((p) => {
        if (cancelled) return;
        setSavedProgress(p);
        if (
          !p ||
          p.progressSeconds < RESUME_EDGE_SECONDS ||
          (p.durationSeconds > 0 &&
            p.progressSeconds > p.durationSeconds - RESUME_EDGE_SECONDS)
        ) {
          setResumeDecision("start");
        }
      })
      .catch(() => {
        if (!cancelled) setResumeDecision("start");
      });
    return () => {
      cancelled = true;
    };
  }, [profile, playable]);

  // ----- Attach video source ------------------------------------------------
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playable || !classification || !canPlay) return;

    let cleanup: (() => void) | null = null;
    let cancelled = false;
    setError(null);
    setIsReady(false);
    setTimedOut(false);

    attachSource(video, classification)
      .then((c) => {
        if (cancelled) {
          c();
          return;
        }
        cleanup = c;
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          devLog("attachSource failed", msg);
          setError(msg);
        }
      });

    return () => {
      cancelled = true;
      if (cleanup) cleanup();
    };
  }, [playable, classification, canPlay]);

  // ----- Video event listeners ----------------------------------------------
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const mark = (name: string) => () => {
      setLastEvent(name);
      devLog(`video event: ${name}`, {
        currentTime: video.currentTime,
        duration: video.duration,
        readyState: video.readyState,
        networkState: video.networkState,
        paused: video.paused,
      });
    };

    const onLoadStart = mark("loadstart");
    const onLoadedMetadata = () => {
      mark("loadedmetadata")();
      setIsReady(true);
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    };
    const onLoadedData = mark("loadeddata");
    const onCanPlay = () => {
      mark("canplay")();
      // canplay is sometimes the first signal we get (some servers don't fire
      // loadedmetadata before canplay). Treat it as "ready" too.
      setIsReady(true);
      setDuration((d) =>
        d > 0 ? d : Number.isFinite(video.duration) ? video.duration : 0,
      );
    };
    const onPlaying = mark("playing");
    const onWaiting = mark("waiting");
    const onStalled = mark("stalled");
    const onSuspend = mark("suspend");
    const onEmptied = mark("emptied");

    const onError = () => {
      mark("error")();
      const msg = mediaErrorMessage(video.error);
      devLog("MediaError", video.error);
      setError(msg);
    };
    const onHlsFatal = (e: Event) => {
      mark("hls-fatal")();
      const detail = (e as CustomEvent<string>).detail;
      setError(detail ?? "HLS playback failed.");
    };

    video.addEventListener("loadstart", onLoadStart);
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("loadeddata", onLoadedData);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("stalled", onStalled);
    video.addEventListener("suspend", onSuspend);
    video.addEventListener("emptied", onEmptied);
    video.addEventListener("error", onError);
    video.addEventListener("hls-fatal", onHlsFatal);
    return () => {
      video.removeEventListener("loadstart", onLoadStart);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("loadeddata", onLoadedData);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("stalled", onStalled);
      video.removeEventListener("suspend", onSuspend);
      video.removeEventListener("emptied", onEmptied);
      video.removeEventListener("error", onError);
      video.removeEventListener("hls-fatal", onHlsFatal);
    };
  }, [playerUrl]);

  // ----- 20-second load timeout --------------------------------------------
  useEffect(() => {
    if (!playerUrl) return;
    if (isReady || error) return;
    const id = window.setTimeout(() => {
      if (!isReady && !error) {
        setTimedOut(true);
        setError(
          "The stream did not start within 20 seconds. It may be blocked (CORS), expired, unsupported, or not a direct playable URL.",
        );
        devLog("load timeout fired");
      }
    }, LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [playerUrl, isReady, error]);

  // ----- Resume application -------------------------------------------------
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isReady) return;
    if (resumeDecision !== "resume") return;
    if (!savedProgress) return;
    try {
      video.currentTime = savedProgress.progressSeconds;
    } catch {
      // ignored
    }
  }, [isReady, resumeDecision, savedProgress]);

  // Once we have a play decision, kick off playback.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isReady) return;
    if (resumeDecision === "pending") return;
    video.play().catch((err) => {
      devLog("play() rejected", err);
    });
  }, [isReady, resumeDecision]);

  // ----- Save progress every 10 seconds -------------------------------------
  const saveProgress = useCallback(
    async (force = false) => {
      if (!profile || !playable) return;
      const video = videoRef.current;
      if (!video) return;
      const dur = Number.isFinite(video.duration) ? video.duration : 0;
      const cur = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      if (!force && cur < 1) return;
      if (dur <= 0) return;
      try {
        await window.mediaCenter.progress.upsert({
          profileId: profile.id,
          type: playable.type,
          mediaId: playable.mediaId,
          playableId: playable.playableId,
          title: playable.mediaTitle,
          episodeTitle: playable.episodeTitle ?? null,
          poster: playable.poster ?? null,
          streamTitle: streamHeaderTitle(playable),
          season: playable.season ?? null,
          episode: playable.episode ?? null,
          progressSeconds: cur,
          durationSeconds: dur,
        });
      } catch {
        // best-effort
      }
    },
    [profile, playable],
  );

  useEffect(() => {
    if (!isReady) return;
    const id = window.setInterval(() => void saveProgress(false), PROGRESS_SAVE_INTERVAL_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [isReady, saveProgress]);

  useEffect(() => {
    return () => {
      void saveProgress(true);
    };
  }, [saveProgress]);

  useEffect(() => {
    return () => clearPendingPlayable();
  }, []);

  // ----- Keyboard shortcuts -------------------------------------------------
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const video = videoRef.current;
      if (!video) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }
      switch (e.key) {
        case " ":
        case "Spacebar":
          e.preventDefault();
          if (video.paused) void video.play().catch(() => {});
          else video.pause();
          break;
        case "ArrowLeft":
          e.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 10);
          break;
        case "ArrowRight":
          e.preventDefault();
          if (Number.isFinite(video.duration)) {
            video.currentTime = Math.min(video.duration, video.currentTime + 10);
          } else {
            video.currentTime = video.currentTime + 10;
          }
          break;
        case "f":
        case "F":
          e.preventDefault();
          if (document.fullscreenElement) {
            void document.exitFullscreen().catch(() => {});
          } else {
            void (containerRef.current ?? video).requestFullscreen().catch(() => {});
          }
          break;
        case "m":
        case "M":
          e.preventDefault();
          video.muted = !video.muted;
          break;
        case "Escape":
          if (document.fullscreenElement) {
            e.preventDefault();
            void document.exitFullscreen().catch(() => {});
          }
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ----- Render -------------------------------------------------------------

  const backHref = `/media/${encodeURIComponent(type)}/${encodeURIComponent(mediaId)}`;

  // Dev-only debug panel rendered alongside player content.
  const debugPanel = DEV && playable ? (
    <div className="player-debug">
      <div className="player-debug__title">DEV · debug</div>
      <dl className="kv">
        <dt>stream type</dt>
        <dd>{classification?.kind} {classification?.format && `(${classification.format})`}</dd>
        <dt>stream url</dt>
        <dd className="mono">{playable.stream.url ?? <em>—</em>}</dd>
        <dt>externalUrl</dt>
        <dd className="mono">{playable.stream.externalUrl ?? <em>—</em>}</dd>
        <dt>infoHash</dt>
        <dd className="mono">{playable.stream.infoHash ?? <em>—</em>}</dd>
        <dt>ytId</dt>
        <dd className="mono">{playable.stream.ytId ?? <em>—</em>}</dd>
        <dt>stream name</dt>
        <dd>{playable.stream.name ?? <em>—</em>}</dd>
        <dt>stream title</dt>
        <dd>{playable.stream.title ?? <em>—</em>}</dd>
        <dt>last event</dt>
        <dd>{lastEvent}{timedOut && " (timed out)"}</dd>
      </dl>
    </div>
  ) : null;

  // 1. No stream queued at all.
  if (!playable) {
    return (
      <div className="page player-page">
        <header className="player-header">
          <Link to={backHref} className="back-link">← Back</Link>
        </header>
        <div className="empty">
          No stream is queued for playback. Pick a source on the media detail
          page and click <strong>Play</strong>.
        </div>
      </div>
    );
  }

  // 2. Stream exists but has no direct URL — explicit message per spec.
  if (!playable.stream.url) {
    return (
      <div className="page player-page">
        <header className="player-header">
          <Link to={backHref} className="back-link">← Back</Link>
          <div className="player-header__titles">
            <div className="player-header__media">{playable.mediaTitle}</div>
            {playable.episodeTitle && (
              <div className="player-header__episode muted small">
                {playable.episodeTitle}
              </div>
            )}
          </div>
        </header>
        <div className="error-banner">
          No direct playable stream URL was provided.
          {classification?.reason && <div className="muted small" style={{ marginTop: 6 }}>{classification.reason}</div>}
        </div>
        {debugPanel}
      </div>
    );
  }

  // 3. Stream URL exists but the kind isn't something we can play (e.g. DASH
  //    not enabled, or unsupported protocol).
  if (!canPlay) {
    return (
      <div className="page player-page">
        <header className="player-header">
          <Link to={backHref} className="back-link">← Back</Link>
          <div className="player-header__titles">
            <div className="player-header__media">{playable.mediaTitle}</div>
            {playable.episodeTitle && (
              <div className="player-header__episode muted small">
                {playable.episodeTitle}
              </div>
            )}
          </div>
        </header>
        <div className="error-banner">
          This stream can't be played in the built-in player yet.
          {classification?.reason && <> · {classification.reason}</>}
        </div>
        {debugPanel}
      </div>
    );
  }

  const showResumePrompt =
    resumeDecision === "pending" && savedProgress && savedProgress.progressSeconds > 0;

  return (
    <div className="page player-page">
      <header className="player-header">
        <Link to={backHref} className="back-link" title="Back">
          ← Back
        </Link>
        <div className="player-header__titles">
          <div className="player-header__media">{playable.mediaTitle}</div>
          {playable.episodeTitle && (
            <div className="player-header__episode muted small">
              {typeof playable.season === "number" &&
                typeof playable.episode === "number" &&
                `S${String(playable.season).padStart(2, "0")}E${String(playable.episode).padStart(2, "0")} · `}
              {playable.episodeTitle}
            </div>
          )}
          <div className="player-header__stream muted small">
            {streamHeaderTitle(playable)}
            {playable.source && <> · {playable.source.addonName}</>}
          </div>
        </div>
      </header>

      <div className="player-stage" ref={containerRef}>
        <video
          ref={videoRef}
          className="player-video"
          controls
          playsInline
          preload="metadata"
        />

        {!isReady && !error && (
          <div className="player-overlay">
            <div className="player-loading">Loading stream…</div>
          </div>
        )}

        {showResumePrompt && !error && (
          <div className="player-overlay">
            <div className="resume-prompt">
              <div className="resume-prompt__label muted small">Saved progress</div>
              <button
                type="button"
                className="primary-button"
                onClick={() => setResumeDecision("resume")}
              >
                Resume from {formatTime(savedProgress!.progressSeconds)}
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setResumeDecision("start")}
              >
                Start from beginning
              </button>
              {duration > 0 && (
                <div className="muted small" style={{ marginTop: 4 }}>
                  Total {formatTime(duration)}
                </div>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="player-overlay">
            <div className="player-error-card error-banner" role="alert">
              <div>{error}</div>
              <p className="muted small" style={{ marginTop: 6 }}>
                Try a different source on the media page.
              </p>
              <div style={{ marginTop: 8 }}>
                <Link to={backHref} className="ghost-button">
                  Back to sources
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="player-shortcuts muted small">
        Shortcuts: <kbd>Space</kbd> play/pause · <kbd>←</kbd>/<kbd>→</kbd>{" "}
        ±10s · <kbd>F</kbd> fullscreen · <kbd>M</kbd> mute · <kbd>Esc</kbd>{" "}
        exit fullscreen
      </div>

      {debugPanel}
    </div>
  );
}
