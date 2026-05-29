// App-level embedded player overlay (E4 + E5 + E6).
//
// E6 additions (YouTube/Netflix UX):
//   - Stage fills entire window (position:absolute inset:0). Canvas uses
//     object-fit:contain so aspect ratio is always preserved.
//   - Header, controls, and stats are position:absolute overlays — they never
//     reduce the canvas area.
//   - Auto-hide: chrome fades after 2500 ms of inactivity. Controls reappear on
//     mouse movement, keyboard events, or when playback is paused.
//   - `controls-hidden` class on root triggers CSS fade + cursor:none.
//   - `is-fullscreen` class on root mirrors BrowserWindow fullscreen state.
//   - Esc: exits fullscreen first (if active), then closes overlay on second press.
//
// Safety: does not touch external MPV, profiles, library, DB, or debrid.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  clearEmbeddedPlayRequest,
  getEmbeddedPlayRequest,
  subscribeEmbeddedPlayRequest,
} from "../features/player/embeddedRequest.js";
import { useEmbeddedPlayback } from "../features/player/useEmbeddedPlayback.js";
import type { EmbeddedProgressContext } from "../features/player/useEmbeddedPlayback.js";
import { useProfile } from "../state/ProfileContext.js";
import type { PlayRequest } from "../core/player/types.js";
import type { MpvTrack } from "../types/embedded-mpv.js";

// ---- Constants ---------------------------------------------------------------

const HIDE_DELAY_MS = 2500;

// ---- Utilities ---------------------------------------------------------------

function formatTime(seconds: number): string {
  if (seconds < 0 || !isFinite(seconds)) return "--:--";
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) {
    return `${h}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function trackLabel(t: MpvTrack, fallbackIndex: number): string {
  const parts: string[] = [];
  if (t.lang) parts.push(t.lang.toUpperCase());
  if (t.title) parts.push(t.title);
  if (parts.length === 0) parts.push(`Track ${fallbackIndex + 1}`);
  return parts.join(" — ");
}

// ---- Component ---------------------------------------------------------------

export default function EmbeddedPlayerOverlay() {
  const [req, setReq] = useState<PlayRequest | null>(
    () => getEmbeddedPlayRequest(),
  );

  // E5: active profile for progress tracking
  const { profile } = useProfile();

  const {
    canvasRef,
    running,
    starting,
    error,
    stats,
    available,
    startPlayback,
    stopPlayback,
    playbackState,
    audioTracks,
    subtitleTracks,
    togglePause,
    seekTo,
    seekRelative,
    setVolume,
    setSubtitleTrack,
    setAudioTrack,
  } = useEmbeddedPlayback();

  // E5 fix: fullscreen via BrowserWindow IPC
  const [isFullscreen, setIsFullscreen] = useState(false);
  const fullscreenAvailable =
    typeof window !== "undefined" && !!window.embeddedMpv?.setFullscreen;

  // E6: auto-hide controls state
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Refs so timer callbacks don't capture stale state
  const pausedRef = useRef(true);
  const runningRef = useRef(false);
  const draggingRef = useRef(false);
  // True while the pointer is over an interactive control (don't auto-hide then)
  const isInteractingRef = useRef(false);

  // Dragging scrub bar: track drag value separately to avoid seek spam.
  const [dragging, setDragging] = useState(false);
  const [dragValue, setDragValue] = useState(0);
  const prevVolumeRef = useRef(100); // for mute/unmute toggle

  // ---- Store subscription --------------------------------------------------

  useEffect(() => {
    const unsub = subscribeEmbeddedPlayRequest((r) => setReq(r));
    return () => unsub();
  }, []);

  // ---- Playback lifecycle (StrictMode-safe via cancelledRef in hook) -------
  //
  // E5: build progress context from req + active profile.
  // E5 fix: query saved progress BEFORE starting playback for resume.

  const profileId = profile?.id ?? null;

  useEffect(() => {
    if (!req || profileId === null) return;
    let cancelled = false;

    const doStart = async () => {
      let startSeconds: number | undefined;
      try {
        const saved = await window.mediaCenter.progress.get({
          profileId,
          mediaId: req.mediaId,
          playableId: req.playableId,
        });
        if (saved && !saved.completed && saved.progressSeconds > 10) {
          startSeconds = saved.progressSeconds;
          if (import.meta.env.DEV) {
            console.log(
              "[embedded:resume] found saved progress:",
              startSeconds,
              "s — will seek on file load",
            );
          }
        }
      } catch {
        // Progress lookup failure is non-fatal — just start from the beginning.
      }

      if (cancelled) return;

      const ctx: EmbeddedProgressContext = {
        profileId,
        type: req.type,
        mediaId: req.mediaId,
        playableId: req.playableId,
        mediaTitle: req.mediaTitle,
        episodeTitle: req.episodeTitle ?? null,
        season: req.season ?? null,
        episode: req.episode ?? null,
        poster: req.poster ?? null,
        streamTitle: req.streamTitle ?? null,
        startSeconds,
      };

      await startPlayback(req.streamUrl, ctx);
    };

    void doStart();
    return () => {
      cancelled = true;
      stopPlayback();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req, profileId, startPlayback, stopPlayback]);

  // ---- Fullscreen (E5 fix) -------------------------------------------------

  useEffect(() => {
    const api = window.embeddedMpv;
    if (!api?.onFullscreenChange) return;
    return api.onFullscreenChange(setIsFullscreen);
  }, []);

  const toggleFullscreen = useCallback(() => {
    void window.embeddedMpv?.setFullscreen(!isFullscreen);
  }, [isFullscreen]);

  // ---- Auto-hide controls (E6) --------------------------------------------

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHideControls = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      // Never hide while paused, dragging, or interacting with controls
      if (pausedRef.current || draggingRef.current || isInteractingRef.current) return;
      if (!runningRef.current) return;
      setControlsVisible(false);
    }, HIDE_DELAY_MS);
  }, [clearHideTimer]);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    scheduleHideControls();
  }, [scheduleHideControls]);

  // Pin controls while hovering interactive elements
  const pinControls = useCallback(() => {
    isInteractingRef.current = true;
    clearHideTimer();
    setControlsVisible(true);
  }, [clearHideTimer]);

  const unpinControls = useCallback(() => {
    isInteractingRef.current = false;
    scheduleHideControls();
  }, [scheduleHideControls]);

  // Keep pausedRef in sync
  const paused = playbackState?.paused ?? true;
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  // Keep runningRef in sync
  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  // When playback starts → show controls and start hide timer
  useEffect(() => {
    if (running) {
      showControls();
    }
  }, [running, showControls]);

  // When paused → always show controls, cancel hide timer
  useEffect(() => {
    if (paused) {
      clearHideTimer();
      setControlsVisible(true);
    } else if (running) {
      scheduleHideControls();
    }
  }, [paused, running, clearHideTimer, scheduleHideControls]);

  // When overlay is closed → clear any pending timer
  useEffect(() => {
    if (!req) {
      clearHideTimer();
      setControlsVisible(true);
    }
  }, [req, clearHideTimer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearHideTimer();
    };
  }, [clearHideTimer]);

  const handleMouseActivity = useCallback(() => {
    showControls();
  }, [showControls]);

  // ---- Keyboard shortcuts --------------------------------------------------

  const handleClose = useCallback(() => clearEmbeddedPlayRequest(), []);

  useEffect(() => {
    if (!req) return;
    function onKey(e: KeyboardEvent) {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

      // Any key shows controls
      showControls();

      switch (e.key) {
        case "Escape":
          e.preventDefault();
          if (isFullscreen) {
            void window.embeddedMpv?.setFullscreen(false);
          } else {
            handleClose();
          }
          break;
        case " ":
          e.preventDefault();
          togglePause();
          break;
        case "ArrowLeft":
          e.preventDefault();
          seekRelative(-5);
          break;
        case "ArrowRight":
          e.preventDefault();
          seekRelative(5);
          break;
        case "m":
        case "M": {
          e.preventDefault();
          const vol = playbackState?.volume ?? 100;
          if (vol > 0) {
            prevVolumeRef.current = vol;
            setVolume(0);
          } else {
            setVolume(prevVolumeRef.current || 100);
          }
          break;
        }
        case "f":
        case "F":
          if (fullscreenAvailable) {
            e.preventDefault();
            toggleFullscreen();
          }
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    req,
    handleClose,
    togglePause,
    seekRelative,
    setVolume,
    playbackState?.volume,
    fullscreenAvailable,
    toggleFullscreen,
    isFullscreen,
    showControls,
  ]);

  // ---- Track select handlers -----------------------------------------------

  const handleSubtitleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setSubtitleTrack(Number(e.target.value));
    },
    [setSubtitleTrack],
  );

  const handleAudioChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setAudioTrack(Number(e.target.value));
    },
    [setAudioTrack],
  );

  // ---- Progress bar --------------------------------------------------------

  const timePos = playbackState?.timePos ?? -1;
  const duration = playbackState?.duration ?? -1;
  const progressValue = dragging ? dragValue : (timePos >= 0 ? timePos : 0);
  const progressMax = duration > 0 ? duration : 100;

  const handleProgressMouseDown = (e: React.MouseEvent<HTMLInputElement>) => {
    draggingRef.current = true;
    setDragging(true);
    setDragValue(Number((e.target as HTMLInputElement).value));
    pinControls();
  };
  const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDragValue(Number(e.target.value));
  };
  const handleProgressMouseUp = (e: React.MouseEvent<HTMLInputElement>) => {
    const val = Number((e.target as HTMLInputElement).value);
    draggingRef.current = false;
    setDragging(false);
    seekTo(val);
    unpinControls();
  };

  // ---- Volume --------------------------------------------------------------

  const volume = playbackState?.volume ?? 100;
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVolume(Number(e.target.value));
  };

  // ---- Derived display values ---------------------------------------------

  const selectedSid = subtitleTracks.find((t) => t.selected)?.id ?? -1;
  const selectedAid = audioTracks.find((t) => t.selected)?.id ?? -1;

  const title =
    req && req.mediaId !== "experimental"
      ? req.episodeTitle
        ? `${req.mediaTitle} — ${req.episodeTitle}`
        : req.mediaTitle
      : "(experimental URL)";

  const statusText = starting
    ? "Starting…"
    : !running && !error
      ? "Idle"
      : error
        ? "Error"
        : paused
          ? "Paused"
          : "Playing";

  // ---- Render --------------------------------------------------------------

  if (!req) return null;

  const rootClass = [
    "emb-overlay",
    isFullscreen ? "is-fullscreen" : "",
    !controlsVisible ? "controls-hidden" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={rootClass}
      role="dialog"
      aria-label="Embedded player"
      onMouseMove={handleMouseActivity}
      onMouseEnter={handleMouseActivity}
    >
      {/* ── Stage: fills entire overlay, canvas uses object-fit:contain ── */}
      <div className="emb-overlay__stage">
        {starting && (
          <div className="emb-overlay__loading muted small">
            Starting native session…
          </div>
        )}

        <canvas ref={canvasRef} className="emb-overlay__canvas" />

        {/* ── Header — floating top overlay ── */}
        <div className="emb-overlay__header">
          <div className="emb-overlay__title-area">
            <span className="emb-overlay__title" title={title}>
              {title}
            </span>
            <span className="exp-badge">EXPERIMENTAL</span>
          </div>
          <span className="emb-overlay__status muted small">{statusText}</span>
          <button
            type="button"
            className="emb-overlay__close"
            onClick={handleClose}
            title="Close embedded player (Esc)"
            aria-label="Close embedded player"
            onMouseEnter={pinControls}
            onMouseLeave={unpinControls}
          >
            ✕
          </button>
        </div>

        {/* ── Error banners — always visible, above header gradient ── */}
        {(!available || error) && (
          <div className="emb-overlay__errors">
            {!available && (
              <div className="error-banner emb-overlay__banner" role="alert">
                Embedded player bridge unavailable (<code>window.embeddedMpv</code>{" "}
                missing). Rebuild the app.
              </div>
            )}
            {error && (
              <div className="error-banner emb-overlay__banner" role="alert">
                {error}
              </div>
            )}
          </div>
        )}

        {/* ── Dev stats HUD — corner, fades with controls ── */}
        <div className="emb-overlay__stats muted small">
          <span>{stats.fps.toFixed(1)} fps</span>
          <span>· {stats.avgGetMs.toFixed(1)} ms</span>
          <span>· {stats.drawn}d/{stats.skipped}s</span>
        </div>

        {/* ── Control bar — floating bottom overlay ── */}
        {(running || starting) && (
          <div
            className="emb-overlay__controls"
            onMouseEnter={pinControls}
            onMouseLeave={unpinControls}
            onFocus={pinControls}
            onBlur={unpinControls}
          >
            {/* Play / Pause */}
            <button
              type="button"
              className="emb-overlay__ctrl emb-overlay__ctrl--icon"
              onClick={togglePause}
              title={paused ? "Play (Space)" : "Pause (Space)"}
              aria-label={paused ? "Play" : "Pause"}
              disabled={starting}
            >
              {paused ? "▶" : "⏸"}
            </button>

            {/* Time display */}
            <span className="emb-overlay__time">
              {formatTime(dragging ? dragValue : timePos)}
            </span>

            {/* Progress scrubber */}
            <input
              type="range"
              className="emb-overlay__progress"
              min={0}
              max={progressMax}
              step={0.5}
              value={progressValue}
              onMouseDown={handleProgressMouseDown}
              onChange={handleProgressChange}
              onMouseUp={handleProgressMouseUp}
              aria-label="Seek"
              title="Seek (Left/Right arrows)"
            />

            {/* Duration */}
            <span className="emb-overlay__time emb-overlay__time--dur">
              {formatTime(duration)}
            </span>

            {/* Volume icon + slider */}
            <button
              type="button"
              className="emb-overlay__ctrl emb-overlay__ctrl--icon"
              onClick={() => {
                if (volume > 0) {
                  prevVolumeRef.current = volume;
                  setVolume(0);
                } else {
                  setVolume(prevVolumeRef.current || 100);
                }
              }}
              title="Mute/unmute (M)"
              aria-label={volume === 0 ? "Unmute" : "Mute"}
            >
              {volume === 0 ? "🔇" : volume < 50 ? "🔉" : "🔊"}
            </button>
            <input
              type="range"
              className="emb-overlay__volume"
              min={0}
              max={130}
              step={1}
              value={volume}
              onChange={handleVolumeChange}
              aria-label="Volume"
              title="Volume"
            />

            {/* Subtitle track selector */}
            {subtitleTracks.length > 0 ? (
              <select
                className="emb-overlay__track-select"
                value={selectedSid}
                onChange={handleSubtitleChange}
                title="Subtitle track"
                aria-label="Subtitle track"
              >
                <option value={-1}>CC: Off</option>
                {subtitleTracks.map((t, i) => (
                  <option key={t.id} value={t.id}>
                    CC: {trackLabel(t, i)}
                  </option>
                ))}
              </select>
            ) : (
              <span
                className="emb-overlay__ctrl emb-overlay__ctrl--disabled muted small"
                title="No subtitle tracks loaded"
              >
                CC: —
              </span>
            )}

            {/* Audio track selector */}
            {audioTracks.length > 1 ? (
              <select
                className="emb-overlay__track-select"
                value={selectedAid}
                onChange={handleAudioChange}
                title="Audio track"
                aria-label="Audio track"
              >
                {audioTracks.map((t, i) => (
                  <option key={t.id} value={t.id}>
                    🎵 {trackLabel(t, i)}
                  </option>
                ))}
              </select>
            ) : (
              <span className="emb-overlay__ctrl emb-overlay__ctrl--disabled muted small">
                🎵 —
              </span>
            )}

            {/* Fullscreen toggle */}
            {fullscreenAvailable && (
              <button
                type="button"
                className="emb-overlay__ctrl emb-overlay__ctrl--icon"
                onClick={toggleFullscreen}
                title={isFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen (F)"}
                aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              >
                {isFullscreen ? "⤡" : "⤢"}
              </button>
            )}

            {/* Stop / Close */}
            <button
              type="button"
              className="emb-overlay__ctrl emb-overlay__ctrl--stop"
              onClick={handleClose}
              title="Stop and close (Esc)"
            >
              ⏹ Stop
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
