// Custom hook owning the full libmpv canvas player lifecycle (E3).
//
// Owns: IPC start/stop, RAF draw loop, frame counters, stats state.
// Uses the `cancelledRef` pattern to be safe under React 18 StrictMode:
//   - cancelledRef.current is set false at the top of startPlayback
//   - stopPlayback sets it to true synchronously
//   - startPlayback checks it after every await; if true it bails out so the
//     stale async continuation from the first StrictMode invocation doesn't
//     trample the second valid one.
//
// Consumers:
//   - EmbeddedPlayerOverlay (app-level overlay, receives req from store)
//   - ExperimentalEmbeddedPlayerPage (standalone test page, calls start directly)

import { useCallback, useRef, useState } from "react";

export interface EmbeddedPlaybackStats {
  fps: number;
  avgGetMs: number;
  drawn: number;
  skipped: number;
}

export interface UseEmbeddedPlaybackReturn {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  running: boolean;
  starting: boolean;
  error: string | null;
  stats: EmbeddedPlaybackStats;
  available: boolean;
  startPlayback: (url: string) => Promise<void>;
  stopPlayback: () => void;
}

const EMPTY_STATS: EmbeddedPlaybackStats = {
  fps: 0,
  avgGetMs: 0,
  drawn: 0,
  skipped: 0,
};

export function useEmbeddedPlayback(): UseEmbeddedPlaybackReturn {
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<EmbeddedPlaybackStats>(EMPTY_STATS);

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

  // The RAF loop — only runs while runningRef.current is true.
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

    if (!runningRef.current) return; // stopped while awaiting

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
      const fps = (c.windowDrawn * 1000) / elapsed;
      setStats({
        fps,
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

  /** Stop only the RAF loop (does NOT stop the native session). */
  const stopLoop = useCallback(() => {
    runningRef.current = false;
    setRunning(false);
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  /**
   * Full stop: cancel the RAF loop AND stop the native addon session.
   * Also marks cancelledRef so any in-flight startPlayback bails out.
   */
  const stopPlayback = useCallback(() => {
    cancelledRef.current = true;
    stopLoop();
    setStarting(false);
    const api = window.embeddedMpv;
    if (api) void api.stop().catch(() => {});
    if (import.meta.env.DEV) {
      console.log("[embedded:stop] native session stopped");
    }
  }, [stopLoop]);

  /**
   * Start a new native addon session and begin the RAF draw loop.
   * StrictMode-safe: cancelledRef guards the async continuation so the
   * stale first invocation doesn't start a loop after StrictMode cleanup
   * fires stopPlayback().
   */
  const startPlayback = useCallback(
    async (url: string) => {
      if (!url) return;
      const api = window.embeddedMpv;
      if (!api) {
        setError("Embedded player bridge unavailable (window.embeddedMpv missing).");
        return;
      }

      // Reset cancelled flag for this invocation.
      cancelledRef.current = false;

      stopLoop(); // cancel any running RAF before we issue a new start
      lastIndexRef.current = 0;
      counters.current = {
        drawn: 0, skipped: 0,
        getMsSum: 0, getCalls: 0,
        windowStart: 0, windowDrawn: 0,
      };
      setError(null);
      setStats(EMPTY_STATS);
      setStarting(true);

      if (import.meta.env.DEV) {
        console.log("[embedded:start] calling api.start()", url.slice(0, 80));
      }

      let res: { ok: boolean; error?: string };
      try {
        res = await api.start(url);
      } catch (e) {
        // Check cancelled BEFORE touching React state.
        if (cancelledRef.current) return;
        setStarting(false);
        setError(e instanceof Error ? e.message : String(e));
        return;
      }

      // Guard: StrictMode cleanup (stopPlayback) may have fired while we
      // were awaiting api.start(). If so, bail — the second valid effect
      // invocation will start its own session.
      if (cancelledRef.current) {
        if (import.meta.env.DEV) {
          console.log("[embedded:start] cancelled after api.start() returned — ignoring");
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

  return {
    canvasRef,
    running,
    starting,
    error,
    stats,
    available,
    startPlayback,
    stopPlayback,
  };
}
