// Custom hook owning the full libmpv canvas player lifecycle (E3 → E4).
//
// Owns: IPC start/stop, RAF draw loop, frame counters, stats state,
//       playback state polling (E4), and control dispatch helpers (E4).
//
// StrictMode safety via cancelledRef:
//   - cancelledRef.current is set false at the top of startPlayback
//   - stopPlayback sets it to true synchronously
//   - startPlayback checks it after every await; stale first-pass bails out
//
// Consumers:
//   - EmbeddedPlayerOverlay (app-level overlay, receives req from store)
//   - ExperimentalEmbeddedPlayerPage (standalone test page, calls start directly)

import { useCallback, useEffect, useRef, useState } from "react";
import type { EmbeddedPlaybackState, MpvTrack } from "../../types/embedded-mpv.js";

export interface EmbeddedPlaybackStats {
  fps: number;
  avgGetMs: number;
  drawn: number;
  skipped: number;
}

export interface UseEmbeddedPlaybackReturn {
  // Canvas
  canvasRef: React.RefObject<HTMLCanvasElement>;
  // Frame loop state
  running: boolean;
  starting: boolean;
  error: string | null;
  stats: EmbeddedPlaybackStats;
  available: boolean;
  // Lifecycle
  startPlayback: (url: string) => Promise<void>;
  stopPlayback: () => void;
  // E4: Playback state (polled every 250ms while running)
  playbackState: EmbeddedPlaybackState | null;
  audioTracks: MpvTrack[];
  subtitleTracks: MpvTrack[];
  // E4: Controls (fire-and-forget; safe to call when not running)
  setPause: (paused: boolean) => void;
  togglePause: () => void;
  seekTo: (seconds: number) => void;
  seekRelative: (deltaSecs: number) => void;
  setVolume: (volume: number) => void;
  setSubtitleTrack: (id: number) => void;  // -1 to disable
  setAudioTrack: (id: number) => void;
}

const EMPTY_STATS: EmbeddedPlaybackStats = {
  fps: 0,
  avgGetMs: 0,
  drawn: 0,
  skipped: 0,
};

function parseTracks(json: string): MpvTrack[] {
  try {
    const raw = JSON.parse(json) as unknown[];
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (t): t is MpvTrack =>
        typeof t === "object" &&
        t !== null &&
        typeof (t as Record<string, unknown>).id === "number" &&
        typeof (t as Record<string, unknown>).type === "string",
    );
  } catch {
    return [];
  }
}

export function useEmbeddedPlayback(): UseEmbeddedPlaybackReturn {
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<EmbeddedPlaybackStats>(EMPTY_STATS);
  const [playbackState, setPlaybackState] =
    useState<EmbeddedPlaybackState | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const cancelledRef = useRef(false);
  const lastIndexRef = useRef(0);

  const counters = useRef({
    drawn: 0,
    skipped: 0,
    getMsSum: 0,
    getCalls: 0,
    windowStart: 0,
    windowDrawn: 0,
  });

  const available =
    typeof window !== "undefined" && !!window.embeddedMpv;

  // ---- Frame drawing -------------------------------------------------------

  const drawFrame = useCallback(
    (width: number, height: number, rgba: Uint8Array) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const expected = width * height * 4;
      if (rgba.length < expected) return;
      const clamped = new Uint8ClampedArray(expected);
      clamped.set(rgba.subarray(0, expected));
      ctx.putImageData(new ImageData(clamped, width, height), 0, 0);
    },
    [],
  );

  // ---- RAF loop ------------------------------------------------------------

  const loop = useCallback(async () => {
    if (!runningRef.current) return;
    const api = window.embeddedMpv;
    if (!api) return;

    const t0 = performance.now();
    let frame: Awaited<ReturnType<NonNullable<Window["embeddedMpv"]>["getFrame"]>>;
    try {
      frame = await api.getFrame(lastIndexRef.current);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      runningRef.current = false;
      setRunning(false);
      return;
    }

    if (!runningRef.current) return;

    const getMs = performance.now() - t0;
    const c = counters.current;
    c.getMsSum += getMs;
    c.getCalls += 1;

    if (frame.error) {
      setError(frame.error);
      runningRef.current = false;
      setRunning(false);
      return;
    }

    if (!frame.noNewFrame && frame.rgba) {
      drawFrame(frame.width, frame.height, frame.rgba as Uint8Array);
      lastIndexRef.current = frame.frameIndex;
      c.drawn += 1;
      c.windowDrawn += 1;
    } else {
      c.skipped += 1;
    }

    const now = performance.now();
    if (c.windowStart === 0) c.windowStart = now;
    const elapsed = now - c.windowStart;
    if (elapsed >= 250) {
      setStats({
        fps: (c.windowDrawn * 1000) / elapsed,
        avgGetMs: c.getCalls > 0 ? c.getMsSum / c.getCalls : 0,
        drawn: c.drawn,
        skipped: c.skipped,
      });
      c.windowStart = now;
      c.windowDrawn = 0;
      c.getMsSum = 0;
      c.getCalls = 0;
    }

    rafRef.current = requestAnimationFrame(() => void loop());
  }, [drawFrame]);

  // ---- Loop control --------------------------------------------------------

  const stopLoop = useCallback(() => {
    runningRef.current = false;
    setRunning(false);
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const stopPlayback = useCallback(() => {
    cancelledRef.current = true;
    stopLoop();
    setStarting(false);
    setPlaybackState(null);
    const api = window.embeddedMpv;
    if (api) void api.stop().catch(() => {});
    if (import.meta.env.DEV) {
      console.log("[embedded:stop] native session stopped");
    }
  }, [stopLoop]);

  const startPlayback = useCallback(
    async (url: string) => {
      if (!url) return;
      const api = window.embeddedMpv;
      if (!api) {
        setError("Embedded player bridge unavailable (window.embeddedMpv missing).");
        return;
      }

      cancelledRef.current = false;

      stopLoop();
      lastIndexRef.current = 0;
      counters.current = {
        drawn: 0, skipped: 0,
        getMsSum: 0, getCalls: 0,
        windowStart: 0, windowDrawn: 0,
      };
      setError(null);
      setStats(EMPTY_STATS);
      setPlaybackState(null);
      setStarting(true);

      if (import.meta.env.DEV) {
        console.log("[embedded:start] calling api.start()", url.slice(0, 80));
      }

      let res: { ok: boolean; error?: string };
      try {
        res = await api.start(url);
      } catch (e) {
        if (cancelledRef.current) return;
        setStarting(false);
        setError(e instanceof Error ? e.message : String(e));
        return;
      }

      if (cancelledRef.current) {
        if (import.meta.env.DEV) {
          console.log("[embedded:start] cancelled after api.start() — ignoring stale invocation");
        }
        return;
      }

      setStarting(false);

      if (!res.ok) {
        setError(res.error ?? "Native addon failed to start.");
        return;
      }

      if (import.meta.env.DEV) {
        console.log("[embedded:start] native session started — beginning RAF loop");
      }

      runningRef.current = true;
      setRunning(true);
      rafRef.current = requestAnimationFrame(() => void loop());
    },
    [loop, stopLoop],
  );

  // ---- E4: Playback state polling ------------------------------------------
  // Poll getState() every 250ms while running. Stops automatically when the
  // RAF loop stops.

  useEffect(() => {
    if (!running) return;
    const api = window.embeddedMpv;
    if (!api) return;

    const poll = async () => {
      try {
        const s = await api.getState();
        setPlaybackState(s);
      } catch {
        // ignore — state read failures are non-fatal
      }
    };

    void poll(); // immediate first read
    const id = setInterval(() => void poll(), 250);
    return () => clearInterval(id);
  }, [running]);

  // ---- E4: Derived track lists ---------------------------------------------

  const allTracks = parseTracks(playbackState?.trackListJson ?? "[]");
  const audioTracks = allTracks.filter((t) => t.type === "audio");
  const subtitleTracks = allTracks.filter((t) => t.type === "sub");

  // ---- E4: Control helpers -------------------------------------------------

  const sendCmd = useCallback((type: string, value: number) => {
    const api = window.embeddedMpv;
    if (!api) return;
    void api.command(type, value).catch(() => {});
  }, []);

  const setPause = useCallback(
    (paused: boolean) => sendCmd("pause", paused ? 1 : 0),
    [sendCmd],
  );

  const togglePause = useCallback(() => {
    const paused = playbackState?.paused ?? false;
    setPause(!paused);
    // Optimistically flip local state immediately for snappy UI
    setPlaybackState((prev) =>
      prev ? { ...prev, paused: !paused } : prev,
    );
  }, [playbackState?.paused, setPause]);

  const seekTo = useCallback(
    (seconds: number) => sendCmd("seek", Math.max(0, seconds)),
    [sendCmd],
  );

  const seekRelative = useCallback(
    (deltaSecs: number) => {
      const current = playbackState?.timePos ?? 0;
      seekTo(Math.max(0, current + deltaSecs));
    },
    [playbackState?.timePos, seekTo],
  );

  const setVolume = useCallback(
    (volume: number) => sendCmd("volume", Math.min(130, Math.max(0, volume))),
    [sendCmd],
  );

  const setSubtitleTrack = useCallback(
    (id: number) => sendCmd("sid", id),
    [sendCmd],
  );

  const setAudioTrack = useCallback(
    (id: number) => sendCmd("aid", id),
    [sendCmd],
  );

  return {
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
    setPause,
    togglePause,
    seekTo,
    seekRelative,
    setVolume,
    setSubtitleTrack,
    setAudioTrack,
  };
}
