// Trailer support for the media detail hero.
//
// Two responsibilities:
//   1. A muted, looping background preview layer rendered inside the hero when
//      `autoplayHero` is on and a trailer exists. Audio is NEVER auto-enabled.
//   2. A "Watch Trailer" button that opens an expanded modal with real controls
//      (play/pause, mute/unmute, fullscreen, close) where audio is available.
//
// Direct video URLs use a native <video>. YouTube trailers use a chromeless
// youtube-nocookie iframe (hero) / controllable iframe (modal). For YouTube we
// drive play/pause/mute via the IFrame postMessage API (enablejsapi=1) and keep
// native controls as a fallback. There is also an "Open Trailer" escape hatch
// that opens the video in the user's browser.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  youTubeEmbedUrl,
  youTubeWatchUrl,
  type TrailerInfo,
} from "../core/stremio/trailer.js";

interface MediaTrailerProps {
  trailer: TrailerInfo;
  /** Autoplay the muted hero preview when true. */
  autoplayHero: boolean;
  /** Media title, for accessible labels. */
  title: string;
}

// Fire a YouTube IFrame API command via postMessage. No-op if the frame or its
// content window is not ready yet.
function ytCommand(iframe: HTMLIFrameElement | null, func: string): void {
  try {
    iframe?.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func, args: [] }),
      "*",
    );
  } catch {
    /* cross-origin timing; ignore */
  }
}

export default function MediaTrailer({ trailer, autoplayHero, title }: MediaTrailerProps) {
  const [expanded, setExpanded] = useState(false);
  // Delay the hero preview slightly so the static backdrop shows first and we
  // never flash a black frame on navigation.
  const [showHeroPreview, setShowHeroPreview] = useState(false);

  // Modal playback state (optimistic for YouTube; authoritative for <video>).
  const [modalPlaying, setModalPlaying] = useState(true);
  const [modalMuted, setModalMuted] = useState(false);

  const heroVideoRef = useRef<HTMLVideoElement | null>(null);
  const heroIframeRef = useRef<HTMLIFrameElement | null>(null);
  const modalVideoRef = useRef<HTMLVideoElement | null>(null);
  const modalIframeRef = useRef<HTMLIFrameElement | null>(null);
  const heroWrapRef = useRef<HTMLDivElement | null>(null);

  // Start the hero preview after a short delay.
  useEffect(() => {
    if (!autoplayHero) {
      setShowHeroPreview(false);
      return;
    }
    const t = setTimeout(() => setShowHeroPreview(true), 1400);
    return () => clearTimeout(t);
  }, [autoplayHero, trailer]);

  // Pause the hero preview when it scrolls out of view (and resume when back).
  useEffect(() => {
    if (!showHeroPreview) return;
    const el = heroWrapRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries[0]?.isIntersecting ?? true;
        if (trailer.kind === "direct") {
          const v = heroVideoRef.current;
          if (!v) return;
          if (visible) void v.play().catch(() => {});
          else v.pause();
        } else {
          ytCommand(heroIframeRef.current, visible ? "playVideo" : "pauseVideo");
        }
      },
      { threshold: 0.25 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [showHeroPreview, trailer]);

  // Esc closes the modal.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeModal();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  const openModal = useCallback(() => {
    // Pause the hero preview while the modal is open.
    if (trailer.kind === "direct") heroVideoRef.current?.pause();
    else ytCommand(heroIframeRef.current, "pauseVideo");
    setModalPlaying(true);
    setModalMuted(false);
    setExpanded(true);
  }, [trailer]);

  const closeModal = useCallback(() => {
    setExpanded(false);
    // Resume the muted hero preview.
    if (trailer.kind === "direct") void heroVideoRef.current?.play().catch(() => {});
    else ytCommand(heroIframeRef.current, "playVideo");
  }, [trailer]);

  const toggleModalPlay = useCallback(() => {
    if (trailer.kind === "direct") {
      const v = modalVideoRef.current;
      if (!v) return;
      if (v.paused) {
        void v.play().catch(() => {});
        setModalPlaying(true);
      } else {
        v.pause();
        setModalPlaying(false);
      }
    } else {
      ytCommand(modalIframeRef.current, modalPlaying ? "pauseVideo" : "playVideo");
      setModalPlaying((p) => !p);
    }
  }, [trailer, modalPlaying]);

  const toggleModalMute = useCallback(() => {
    if (trailer.kind === "direct") {
      const v = modalVideoRef.current;
      if (!v) return;
      v.muted = !v.muted;
      setModalMuted(v.muted);
    } else {
      ytCommand(modalIframeRef.current, modalMuted ? "unMute" : "mute");
      setModalMuted((m) => !m);
    }
  }, [trailer, modalMuted]);

  const goFullscreen = useCallback(() => {
    const target =
      trailer.kind === "direct" ? modalVideoRef.current : modalIframeRef.current;
    void target?.requestFullscreen?.().catch(() => {});
  }, [trailer]);

  const openExternal = useCallback(() => {
    const url =
      trailer.kind === "youtube" ? youTubeWatchUrl(trailer.ytId) : trailer.url;
    void window.mediaCenter.system.openExternal(url);
  }, [trailer]);

  return (
    <>
      {/* Muted hero preview layer */}
      {showHeroPreview && (
        <div className="media-trailer__preview" ref={heroWrapRef} aria-hidden>
          {trailer.kind === "direct" ? (
            <video
              ref={heroVideoRef}
              className="media-trailer__preview-media"
              src={trailer.url}
              autoPlay
              muted
              loop
              playsInline
              controls={false}
              disablePictureInPicture
              tabIndex={-1}
            />
          ) : (
            <iframe
              ref={heroIframeRef}
              className="media-trailer__preview-media"
              src={youTubeEmbedUrl(trailer.ytId, { hero: true, muted: true })}
              title={`${title} trailer preview`}
              allow="autoplay; encrypted-media"
              frameBorder={0}
              tabIndex={-1}
            />
          )}
          <div className="media-trailer__preview-scrim" />
        </div>
      )}

      {/* Watch Trailer button (lives in the hero) */}
      <button
        type="button"
        className="btn btn--secondary media-trailer__watch-btn"
        onClick={openModal}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
        Watch Trailer
      </button>

      {/* Expanded modal with audio + controls */}
      {expanded && (
        <div
          className="trailer-modal"
          role="dialog"
          aria-modal="true"
          aria-label={`${title} trailer`}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="trailer-modal__frame">
            <div className="trailer-modal__video">
              {trailer.kind === "direct" ? (
                <video
                  ref={modalVideoRef}
                  src={trailer.url}
                  autoPlay
                  controls={false}
                  playsInline
                  onPlay={() => setModalPlaying(true)}
                  onPause={() => setModalPlaying(false)}
                  onVolumeChange={(e) => setModalMuted((e.target as HTMLVideoElement).muted)}
                />
              ) : (
                <iframe
                  ref={modalIframeRef}
                  src={youTubeEmbedUrl(trailer.ytId, { hero: false, muted: false })}
                  title={`${title} trailer`}
                  allow="autoplay; encrypted-media; fullscreen"
                  allowFullScreen
                  frameBorder={0}
                />
              )}
            </div>

            <div className="trailer-modal__controls">
              <button type="button" className="icon-btn" onClick={toggleModalPlay} title={modalPlaying ? "Pause" : "Play"}>
                {modalPlaying ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                )}
              </button>
              <button type="button" className="icon-btn" onClick={toggleModalMute} title={modalMuted ? "Unmute" : "Mute"}>
                {modalMuted ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="3 9 7 9 12 4 12 20 7 15 3 15 3 9" /><line x1="16" y1="9" x2="22" y2="15" stroke="currentColor" strokeWidth="2" /><line x1="22" y1="9" x2="16" y2="15" stroke="currentColor" strokeWidth="2" /></svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="3 9 7 9 12 4 12 20 7 15 3 15 3 9" /><path d="M16 8a5 5 0 0 1 0 8" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
                )}
              </button>
              <span className="trailer-modal__title">{trailer.title || `${title} - Trailer`}</span>
              <span className="trailer-modal__spacer" />
              <button type="button" className="icon-btn" onClick={openExternal} title="Open in browser">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
              </button>
              <button type="button" className="icon-btn" onClick={goFullscreen} title="Fullscreen">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3" /></svg>
              </button>
              <button type="button" className="icon-btn" onClick={closeModal} title="Close">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
