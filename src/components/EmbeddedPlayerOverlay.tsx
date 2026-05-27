// App-level embedded player overlay (E3).
//
// Appears over the current page when a PlayRequest with
// backend "embedded-mpv-experimental" is dispatched (e.g. from StreamCard's
// "Play Embedded" button). Does NOT navigate — the current route stays in
// place behind the overlay.
//
// Lifecycle:
//   1. dispatchEmbeddedExperimental calls setEmbeddedPlayRequest(req).
//   2. This component's subscription fires → sets req state → non-null.
//   3. A separate useEffect([req]) fires: calls startPlayback(req.streamUrl).
//   4. startPlayback: calls api.start(), awaits, then begins the RAF loop.
//   5. Close button / ESC → clearEmbeddedPlayRequest() → req → null → cleanup
//      effect fires stopPlayback() (cancels RAF + calls api.stop()).
//
// StrictMode safety: cancelledRef in useEmbeddedPlayback guards the async
// api.start() continuation — stale invocations from the first StrictMode pass
// bail out before touching state.
//
// This component intentionally does NOT replace or affect:
//   - External MPV playback
//   - MPV IPC progress tracking
//   - Profiles / library / Continue Watching / database
//   - The ExperimentalEmbeddedPlayerPage (standalone test page; kept intact)

import { useCallback, useEffect, useState } from "react";
import {
  clearEmbeddedPlayRequest,
  getEmbeddedPlayRequest,
  subscribeEmbeddedPlayRequest,
} from "../features/player/embeddedRequest.js";
import { useEmbeddedPlayback } from "../features/player/useEmbeddedPlayback.js";
import type { PlayRequest } from "../core/player/types.js";

export default function EmbeddedPlayerOverlay() {
  // Initialise from the store so we don't miss a request dispatched before
  // this component first renders (unlikely at app-level, but correct).
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
  } = useEmbeddedPlayback();

  // Subscribe to store changes while mounted.
  useEffect(() => {
    const unsub = subscribeEmbeddedPlayRequest((r) => setReq(r));
    return () => {
      unsub();
    };
  }, []);

  // Playback lifecycle: start when req changes to a valid request, stop on
  // cleanup. StrictMode-safe because startPlayback uses cancelledRef.
  useEffect(() => {
    if (!req) return;
    void startPlayback(req.streamUrl);
    return () => {
      stopPlayback();
    };
  }, [req, startPlayback, stopPlayback]);

  // ESC closes the overlay.
  useEffect(() => {
    if (!req) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        clearEmbeddedPlayRequest();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [req]);

  const handleClose = useCallback(() => {
    clearEmbeddedPlayRequest();
  }, []);

  const handleStop = useCallback(() => {
    clearEmbeddedPlayRequest();
  }, []);

  // Don't render when no request is active.
  if (!req) return null;

  const title =
    req.mediaId !== "experimental"
      ? req.episodeTitle
        ? `${req.mediaTitle} — ${req.episodeTitle}`
        : req.mediaTitle
      : "(experimental URL)";

  const statusText = starting
    ? "Starting…"
    : running
      ? "Playing (experimental)"
      : error
        ? "Error"
        : "Idle";

  return (
    <div className="emb-overlay" role="dialog" aria-label="Embedded player">
      {/* Header */}
      <div className="emb-overlay__header">
        <button
          type="button"
          className="emb-overlay__close"
          onClick={handleClose}
          title="Close embedded player (ESC)"
          aria-label="Close"
        >
          ✕
        </button>
        <div className="emb-overlay__title-area">
          <span className="emb-overlay__title">{title}</span>
          <span className="exp-badge">EXPERIMENTAL</span>
        </div>
        <span className="emb-overlay__status muted small">{statusText}</span>
      </div>

      {/* Error banner */}
      {!available && (
        <div className="error-banner emb-overlay__banner" role="alert">
          The embedded player bridge isn't available (
          <code>window.embeddedMpv</code> missing). Rebuild the app.
        </div>
      )}
      {error && (
        <div className="error-banner emb-overlay__banner" role="alert">
          {error}
        </div>
      )}

      {/* Canvas stage */}
      <div className="emb-overlay__stage">
        {starting && (
          <div className="emb-overlay__loading muted small">
            Starting native session…
          </div>
        )}
        <canvas ref={canvasRef} className="emb-overlay__canvas" />
      </div>

      {/* Control bar */}
      <div className="emb-overlay__controls">
        <button
          type="button"
          className="emb-overlay__ctrl emb-overlay__ctrl--stop"
          onClick={handleStop}
          title="Stop and close"
        >
          ⏹ Stop
        </button>
        {/* Pause and seek are not implemented — libmpv IPC controls require
            a separate IPC channel not yet wired for the embedded backend. */}
        <button
          type="button"
          className="emb-overlay__ctrl"
          disabled
          title="Pause — not implemented (TODO)"
        >
          ⏸ Pause
        </button>
        <span className="emb-overlay__ctrl-note muted small">
          Seek / pause TODO — no embedded IPC controls yet
        </span>
      </div>

      {/* Stats */}
      <div className="emb-overlay__stats muted small">
        <span>URL: {req.streamUrl.slice(0, 80)}{req.streamUrl.length > 80 ? "…" : ""}</span>
        <span>· {stats.fps.toFixed(1)} fps</span>
        <span>· getFrame {stats.avgGetMs.toFixed(1)} ms avg</span>
        <span>· {stats.drawn} drawn · {stats.skipped} skipped</span>
      </div>
    </div>
  );
}
