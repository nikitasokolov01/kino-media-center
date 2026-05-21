// Now Playing bar (external MPV controls).
//
// MPV plays in its own OS window; this bar drives it over JSON-IPC: play/pause,
// stop, seek (buttons + a scrubbable progress bar), and audio / subtitle track
// selection. Subtitle and audio menus list the tracks MPV currently has loaded
// (queried from MPV's track-list) — they are NOT addon search results. All
// subtitle tracks are auto-loaded into MPV at launch; the user picks one here.
//
// Design notes:
//   - Pure request/response: we POLL getMpvState() ~1s rather than subscribing.
//   - When no MPV session is active, the bar renders nothing.
//   - Every control degrades gracefully: a failed command never affects the
//     external MPV window, which remains usable on its own.

import { useCallback, useEffect, useRef, useState } from "react";
import { controlMpv, getMpvState } from "../core/player/mpvExternal.js";
import type { MpvPlaybackState, MpvTrack } from "../core/player/types.js";

const POLL_INTERVAL_MS = 1000;

function formatTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "--:--";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function trackLabel(t: MpvTrack): string {
  if (t.lang && t.title) return `${t.lang.toUpperCase()} · ${t.title}`;
  if (t.lang) return t.lang.toUpperCase();
  if (t.title) return t.title;
  return `Track ${t.id}`;
}

type MenuKind = "audio" | "sub" | null;

export default function NowPlayingBar() {
  const [state, setState] = useState<MpvPlaybackState | null>(null);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<MenuKind>(null);
  // While the user is scrubbing, show the dragged position instead of polled
  // time so the handle doesn't jump under their cursor.
  const [dragFraction, setDragFraction] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const s = await getMpvState();
      setState(s.active ? s : null);
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (!cancelled) void refresh();
    };
    tick();
    const id = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [refresh]);

  const run = useCallback(
    async (action: Parameters<typeof controlMpv>[0]) => {
      setBusy(true);
      try {
        await controlMpv(action);
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  // ---- Scrub bar ----------------------------------------------------------
  const fractionFromEvent = useCallback((clientX: number): number | null => {
    const el = barRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return null;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }, []);

  const onScrubDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!state || state.duration === null || state.duration <= 0) return;
      const f = fractionFromEvent(e.clientX);
      if (f === null) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragFraction(f);
    },
    [state, fractionFromEvent],
  );

  const onScrubMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (dragFraction === null) return;
      const f = fractionFromEvent(e.clientX);
      if (f !== null) setDragFraction(f);
    },
    [dragFraction, fractionFromEvent],
  );

  const onScrubUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (dragFraction === null || !state || state.duration === null) {
        setDragFraction(null);
        return;
      }
      const seconds = dragFraction * state.duration;
      setDragFraction(null);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      void run({ kind: "seek-absolute", seconds });
    },
    [dragFraction, state, run],
  );

  if (!state) return null;

  const { timePos, duration, paused, title, audioTrackList, subTrackList } = state;
  const seekable = duration !== null && duration > 0;
  const polledFraction =
    seekable && timePos !== null ? Math.min(1, Math.max(0, timePos / duration!)) : 0;
  const shownFraction = dragFraction !== null ? dragFraction : polledFraction;
  const shownTime =
    dragFraction !== null && seekable ? dragFraction * duration! : timePos;

  const subOff = subTrackList.every((t) => !t.selected);

  function toggleMenu(kind: Exclude<MenuKind, null>) {
    setMenu((m) => (m === kind ? null : kind));
  }

  return (
    <div className="now-playing" role="region" aria-label="Now playing (MPV)">
      <div
        ref={barRef}
        className={`now-playing__bar${seekable ? " now-playing__bar--seekable" : ""}`}
        onPointerDown={onScrubDown}
        onPointerMove={onScrubMove}
        onPointerUp={onScrubUp}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={duration ?? 0}
        aria-valuenow={timePos ?? 0}
      >
        <div
          className="now-playing__progress"
          style={{ width: `${shownFraction * 100}%` }}
        />
        {seekable && (
          <div
            className="now-playing__handle"
            style={{ left: `${shownFraction * 100}%` }}
          />
        )}
      </div>

      <div className="now-playing__row">
        <div className="now-playing__meta">
          <span className="now-playing__label">MPV</span>
          <span className="now-playing__title" title={title ?? undefined}>
            {title ?? "Playing…"}
          </span>
          <span className="now-playing__time mono">
            {formatTime(shownTime)} / {formatTime(duration)}
          </span>
        </div>

        <div className="now-playing__controls">
          <button
            type="button"
            className="now-playing__btn"
            onClick={() => run({ kind: "seek", deltaSeconds: -30 })}
            disabled={busy}
            title="Back 30 seconds"
          >
            ⏪ 30
          </button>
          <button
            type="button"
            className="now-playing__btn"
            onClick={() => run({ kind: "seek", deltaSeconds: -10 })}
            disabled={busy}
            title="Back 10 seconds"
          >
            ◀ 10
          </button>
          <button
            type="button"
            className="now-playing__btn now-playing__btn--primary"
            onClick={() => run({ kind: "play-pause" })}
            disabled={busy}
            title={paused ? "Play" : "Pause"}
          >
            {paused ? "▶" : "⏸"}
          </button>
          <button
            type="button"
            className="now-playing__btn"
            onClick={() => run({ kind: "seek", deltaSeconds: 10 })}
            disabled={busy}
            title="Forward 10 seconds"
          >
            10 ▶
          </button>
          <button
            type="button"
            className="now-playing__btn"
            onClick={() => run({ kind: "seek", deltaSeconds: 30 })}
            disabled={busy}
            title="Forward 30 seconds"
          >
            30 ⏩
          </button>

          <span className="now-playing__divider" aria-hidden="true" />

          {/* Audio track menu */}
          <div className="now-playing__menu-anchor">
            <button
              type="button"
              className="now-playing__btn"
              onClick={() => toggleMenu("audio")}
              disabled={busy}
              aria-haspopup="menu"
              aria-expanded={menu === "audio"}
              title="Audio track"
            >
              Audio ▾
            </button>
            {menu === "audio" && (
              <TrackMenu
                heading="Audio track"
                emptyText="No audio tracks."
                tracks={audioTrackList}
                showOff={false}
                offSelected={false}
                onPick={(id) => {
                  setMenu(null);
                  if (id !== "off") void run({ kind: "set-audio", id });
                }}
                onClose={() => setMenu(null)}
              />
            )}
          </div>

          {/* Subtitle track menu */}
          <div className="now-playing__menu-anchor">
            <button
              type="button"
              className="now-playing__btn"
              onClick={() => toggleMenu("sub")}
              disabled={busy}
              aria-haspopup="menu"
              aria-expanded={menu === "sub"}
              title="Subtitle track"
            >
              Subs ▾
            </button>
            {menu === "sub" && (
              <TrackMenu
                heading="Subtitles"
                emptyText="No subtitle tracks loaded."
                tracks={subTrackList}
                showOff
                offSelected={subOff}
                onPick={(id) => {
                  setMenu(null);
                  void run({ kind: "set-sub", id });
                }}
                onClose={() => setMenu(null)}
              />
            )}
          </div>

          <span className="now-playing__divider" aria-hidden="true" />

          <button
            type="button"
            className="now-playing__btn now-playing__btn--danger"
            onClick={() => run({ kind: "stop" })}
            disabled={busy}
            title="Stop and close MPV"
          >
            ⏹ Stop
          </button>
        </div>
      </div>
    </div>
  );
}

interface TrackMenuProps {
  heading: string;
  emptyText: string;
  tracks: MpvTrack[];
  /** Whether to show an explicit "Off / None" entry (subtitles only). */
  showOff: boolean;
  offSelected: boolean;
  onPick: (id: number | "off") => void;
  onClose: () => void;
}

function TrackMenu({
  heading,
  emptyText,
  tracks,
  showOff,
  offSelected,
  onPick,
  onClose,
}: TrackMenuProps) {
  return (
    <>
      {/* Click-away backdrop. */}
      <div className="now-playing__backdrop" onClick={onClose} aria-hidden="true" />
      <div className="now-playing__menu" role="menu">
        <div className="now-playing__menu-heading">{heading}</div>
        {showOff && (
          <button
            type="button"
            role="menuitemradio"
            aria-checked={offSelected}
            className={`now-playing__menu-item${offSelected ? " is-selected" : ""}`}
            onClick={() => onPick("off")}
          >
            <span className="now-playing__check">{offSelected ? "✓" : ""}</span>
            Off / None
          </button>
        )}
        {tracks.length === 0 && !showOff && (
          <div className="now-playing__menu-empty muted small">{emptyText}</div>
        )}
        {tracks.length === 0 && showOff && (
          <div className="now-playing__menu-empty muted small">{emptyText}</div>
        )}
        {tracks.map((t) => (
          <button
            key={t.id}
            type="button"
            role="menuitemradio"
            aria-checked={t.selected}
            className={`now-playing__menu-item${t.selected ? " is-selected" : ""}`}
            onClick={() => onPick(t.id)}
          >
            <span className="now-playing__check">{t.selected ? "✓" : ""}</span>
            {trackLabel(t)}
          </button>
        ))}
      </div>
    </>
  );
}
