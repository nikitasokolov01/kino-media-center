// EXPERIMENTAL embedded libmpv canvas player — standalone test page (E3).
//
// This page is for manual testing: paste a direct URL, click Start, watch the
// canvas. It is fully independent from the EmbeddedPlayerOverlay and the
// embeddedRequest store. It calls useEmbeddedPlayback() directly.
//
// The overlay (EmbeddedPlayerOverlay) is the app-level experience triggered by
// "Play Embedded" on StreamCards. This page remains as a developer testing tool.
//
// Kept on the /experimental-embedded-player route (gated by the flag). Do not
// remove unless explicitly decided.

import { useCallback, useEffect, useState } from "react";
import { useEmbeddedPlayback } from "../features/player/useEmbeddedPlayback.js";

const DEFAULT_URL =
  "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4";

export default function ExperimentalEmbeddedPlayerPage() {
  const [url, setUrl] = useState(DEFAULT_URL);

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

  // Full stop + native session cleanup on unmount.
  useEffect(() => {
    return () => {
      stopPlayback();
    };
  }, [stopPlayback]);

  const start = useCallback(() => {
    void startPlayback(url.trim());
  }, [url, startPlayback]);

  const isBusy = running || starting;

  return (
    <div className="page">
      <h1>
        Embedded player <span className="exp-badge">EXPERIMENTAL</span>
      </h1>
      <div className="warning-banner" role="note">
        This is an experimental libmpv canvas renderer. It is{" "}
        <strong>copy-based and unoptimized</strong> (each frame is copied native
        → main → renderer), so it may be choppy at higher resolutions. It does{" "}
        <strong>not</strong> replace the external MPV player. Requires the
        native addon in <code>native/embedded-mpv</code> to be built.
      </div>
      <div className="warning-banner" role="note" style={{ marginTop: 6 }}>
        This page is for manual URL testing. To play real app sources in the
        embedded player, use the{" "}
        <strong>⬡ Play Embedded</strong> button on stream source cards (when
        the Experimental flag is enabled in Settings). That uses the in-app
        overlay instead of this page.
      </div>

      {!available && (
        <div className="error-banner" role="alert">
          The embedded player bridge isn't available in this build (
          <code>window.embeddedMpv</code> missing). Rebuild the app.
        </div>
      )}

      <div className="form-row" style={{ marginTop: 12 }}>
        <input
          type="text"
          className="text-input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Direct http(s) video URL"
          spellCheck={false}
          autoComplete="off"
          disabled={isBusy}
          style={{ flex: 1 }}
        />
        {!isBusy ? (
          <button
            type="button"
            className="primary-button"
            onClick={start}
            disabled={!available || url.trim().length === 0}
          >
            ▶ Start
          </button>
        ) : (
          <button
            type="button"
            className="ghost-button"
            onClick={stopPlayback}
            disabled={starting}
          >
            {starting ? "Starting…" : "⏹ Stop"}
          </button>
        )}
      </div>

      {error && (
        <div className="error-banner" role="alert" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}

      <div className="embedded-stage">
        <canvas ref={canvasRef} className="embedded-canvas" />
      </div>

      <div className="embedded-stats muted small">
        <span>
          Status:{" "}
          {starting
            ? "Starting…"
            : running
              ? "Playing (experimental)."
              : "Idle."}
        </span>
        <span>· {stats.fps.toFixed(1)} fps drawn</span>
        <span>· getFrame {stats.avgGetMs.toFixed(1)} ms avg</span>
        <span>· {stats.drawn} drawn</span>
        <span>· {stats.skipped} no-new-frame</span>
      </div>
    </div>
  );
}
