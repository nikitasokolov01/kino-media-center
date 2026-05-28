// App-level embedded player overlay (E4).
//
// Appears over the current page when a PlayRequest with
// backend "embedded-mpv-experimental" is dispatched. Does NOT navigate.
//
// Layout:
//   ┌──────────────────────────────────────────────────────┐
//   │ [title]                         [EXPERIMENTAL]  [✕]  │  ← thin header
//   ├──────────────────────────────────────────────────────┤
//   │                                                      │
//   │                    [canvas]                          │  ← flex:1
//   │                                                      │
//   │  ┌──────────────────────────────────────────────┐   │
//   │  │ ⏸  ━━━━━━━━━━━━━━━━━━  0:45/1:52  🔊 CC  🎵 │   │  ← control bar overlay
//   │  └──────────────────────────────────────────────┘   │
//   └──────────────────────────────────────────────────────┘
//   [ 24.0 fps · getFrame 2.1ms ]                           ← dev stats strip
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
import type { PlayRequest } from "../core/player/types.js";
import type { MpvTrack } from "../types/embedded-mpv.js";

// ---- Utilities --------------------------------------------------------------

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

// ---- Component --------------------------------------------------------------

export default function EmbeddedPlayerOverlay() {
  const [req, setReq] = useState<PlayRequest | null>(
    () => getEmbeddedPlayRequest(),
  );

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

  useEffect(() => {
    if (!req) return;
    void startPlayback(req.streamUrl);
    return () => stopPlayback();
  }, [req, startPlayback, stopPlayback]);

  // ---- Keyboard shortcuts --------------------------------------------------

  const handleClose = useCallback(() => clearEmbeddedPlayRequest(), []);

  useEffect(() => {
    if (!req) return;
    function onKey(e: KeyboardEvent) {
      // Don't steal keys from inputs/selects.
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

      switch (e.key) {
        case "Escape":
          e.preventDefault();
          handleClose();
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
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [req, handleClose, togglePause, seekRelative, setVolume, playbackState?.volume]);

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
    setDragging(true);
    setDragValue(Number((e.target as HTMLInputElement).value));
  };
  const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDragValue(Number(e.target.value));
  };
  const handleProgressMouseUp = (e: React.MouseEvent<HTMLInputElement>) => {
    const val = Number((e.target as HTMLInputElement).value);
    setDragging(false);
    seekTo(val);
  };

  // ---- Volume --------------------------------------------------------------

  const volume = playbackState?.volume ?? 100;
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVolume(Number(e.target.value));
  };

  // ---- Derived display values ---------------------------------------------

  const paused = playbackState?.paused ?? true;

  const selectedSid =
    subtitleTracks.find((t) => t.selected)?.id ?? -1;
  const selectedAid =
    audioTracks.find((t) => t.selected)?.id ?? -1;

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

  return (
    <div className="emb-overlay" role="dialog" aria-label="Embedded player">
      {/* ── Header ── */}
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
        >
          ✕
        </button>
      </div>

      {/* ── Error banners ── */}
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

      {/* ── Canvas stage (fills remaining height) ── */}
      <div className="emb-overlay__stage">
        {starting && (
          <div className="emb-overlay__loading muted small">
            Starting native session…
          </div>
        )}
        <canvas ref={canvasRef} className="emb-overlay__canvas" />

        {/* ── Control bar (overlaid at bottom of stage) ── */}
        {(running || starting) && (
          <div className="emb-overlay__controls">
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
                title="No subtitle tracks loaded (subtitles TODO)"
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

      {/* ── Dev stats strip (small, below canvas) ── */}
      <div className="emb-overlay__stats muted small">
        <span>{stats.fps.toFixed(1)} fps drawn</span>
        <span>· getFrame {stats.avgGetMs.toFixed(1)} ms avg</span>
        <span>· {stats.drawn} drawn · {stats.skipped} skipped</span>
        <span>· URL: {req.streamUrl.slice(0, 60)}{req.streamUrl.length > 60 ? "…" : ""}</span>
      </div>
    </div>
  );
}
