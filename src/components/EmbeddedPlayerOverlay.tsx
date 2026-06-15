// App-level embedded player overlay (E4 + E5 + E6 + E7 + E8).
//
// E8 additions (Next Episode pipeline):
//   - When playing a series episode the overlay queries series.getNextEpisode()
//     to find the next normal (non-special) episode.
//   - Sources for that episode are prefetched in the background via
//     sourcePrefetch.ts while the current episode is still playing.
//   - The best next-episode source is chosen via sourceAffinity.ts (same-pack
//     preference, falling back to quality ranking).
//   - When remaining time ≤ 180 s a "Next Episode" button appears.
//   - Clicking it flushes current progress (marks completed since remaining
//     ≤ 900 s satisfies the completed threshold), stops playback, and immediately
//     starts the next episode using the preselected source.
//   - The next-next episode is prefetched automatically after the transition.
//
// Safety: does not touch external MPV, profiles, library, DB schema, or debrid.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  clearEmbeddedPlayRequest,
  getEmbeddedPlayRequest,
  setEmbeddedPlayRequest,
  subscribeEmbeddedPlayRequest,
} from "../features/player/embeddedRequest.js";
import { useEmbeddedPlayback } from "../features/player/useEmbeddedPlayback.js";
import type { EmbeddedProgressContext } from "../features/player/useEmbeddedPlayback.js";
import { useProfile } from "../state/ProfileContext.js";
import { useSettings } from "../state/SettingsContext.js";
import {
  makePrefetchKey,
  getCachedSources,
  prefetchEpisodeSources,
} from "../core/player/sourcePrefetch.js";
import { chooseNextEpisodeSource } from "../core/player/sourceAffinity.js";
import type { PlayRequest } from "../core/player/types.js";
import type { MpvTrack } from "../types/embedded-mpv.js";
import type { SeriesNextEpisode } from "../types/preload.js";
import type { StreamSourceResult, StremioStream } from "../core/stremio/types.js";
import { addonSupportsResource } from "../core/stremio/meta.js";
import { streamDedupKey } from "../core/stremio/streams.js";
import { chooseBestSource, detectResolution } from "../core/player/sourceRanking.js";
import { buildPlayRequest, dispatchPlayRequest } from "../features/player/playRequest.js";
import {
  PlayIcon, PauseIcon, SkipForwardIcon,
  VolumeHighIcon, VolumeMidIcon, VolumeMuteIcon,
  SubtitlesIcon, HeadphonesIcon, SlidersIcon,
  MaximizeIcon, MinimizeIcon, XIcon, InfoIcon,
} from "./PlayerIcons.js";

// Dev flag — safe in both Vite (renderer) and plain Node.
const isDev =
  typeof process !== "undefined" && process.env.NODE_ENV !== "production";

// ---- Constants ---------------------------------------------------------------

const HIDE_DELAY_MS = 2500;
/** Show "Next Episode" button when this many seconds remain. */
const NEXT_EP_PROMPT_SECS = 180;

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

function nextEpLabel(ep: SeriesNextEpisode): string {
  const s = ep.season != null ? `S${String(ep.season).padStart(2, "0")}` : "";
  const e = ep.episode != null ? `E${String(ep.episode).padStart(2, "0")}` : "";
  const se = [s, e].filter(Boolean).join("");
  return se || "Next Episode";
}

// ---- Component ---------------------------------------------------------------

export default function EmbeddedPlayerOverlay() {
  const [req, setReq] = useState<PlayRequest | null>(
    () => getEmbeddedPlayRequest(),
  );

  const { profile } = useProfile();
  const { settings } = useSettings();

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

  // ---- Fullscreen (E5 fix) -------------------------------------------------

  const [isFullscreen, setIsFullscreen] = useState(false);
  // Increment to force the playback lifecycle effect to retry after an error.
  const [retryKey, setRetryKey] = useState(0);
  const fullscreenAvailable =
    typeof window !== "undefined" && !!window.embeddedMpv?.setFullscreen;
  // Ref-mirror so the req-change effect below can read the current value
  // without needing isFullscreen in its dep array (which would re-run on
  // every fullscreen toggle instead of only when req goes null).
  const isFullscreenRef = useRef(false);
  isFullscreenRef.current = isFullscreen;
  // Track whether the app was already fullscreen before opening the overlay.
  // On close we only exit fullscreen if we entered it ourselves.
  const wasFullscreenBeforeRef = useRef(false);

  // ---- Auto-hide controls (E6) --------------------------------------------

  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pausedRef = useRef(true);
  const runningRef = useRef(false);
  const draggingRef = useRef(false);
  const isInteractingRef = useRef(false);
  // Accumulates raw wheel delta for smooth volume control.
  const wheelAccumulatorRef = useRef(0);

  // ---- Scrub bar state -----------------------------------------------------

  const [dragging, setDragging] = useState(false);
  const [dragValue, setDragValue] = useState(0);
  const prevVolumeRef = useRef(100);
  /** Ref to the current volume (avoids stale closure in wheel handler). */
  const volumeRef = useRef(100);
  /** Timer for dismissing the volume toast. */
  const volumeToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Debounce timer for persisting volume to the DB. */
  const saveVolumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Timeout id used to detect double-click (not a real dblclick event guard). */
  const dblClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- E8: Next Episode state ----------------------------------------------

  /** Next normal episode in canonical order (null if last or unknown). */
  const [nextEpisode, setNextEpisode] = useState<SeriesNextEpisode | null>(null);
  /** The preselected best source for the next episode (null while loading). */
  const [nextSource, setNextSource] = useState<StreamSourceResult | null>(null);
  /** True while the prefetch result is being evaluated. */
  const [nextSourceLoading, setNextSourceLoading] = useState(false);
  /** Show the Next Episode prompt (remaining ≤ NEXT_EP_PROMPT_SECS). */
  const [showNextEpPrompt, setShowNextEpPrompt] = useState(false);
  /** Transitioning to next episode — prevents double-click. */
  const [transitioning, setTransitioning] = useState(false);

  // ---- In-player source picker state (Part 5) ----------------------------

  /** Whether the source panel drawer is open. */
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false);
  /** All fetched sources for the current playable. Null = not yet fetched. */
  const [overlayResults, setOverlayResults] = useState<StreamSourceResult[] | null>(null);
  /** True while sources are loading for the panel. */
  const [overlayLoading, setOverlayLoading] = useState(false);
  /** Error while fetching sources for the panel. */
  const [overlayFetchError, setOverlayFetchError] = useState<string | null>(null);
  /** Key of the source currently playing (for badge). */
  const [currentSourceKey, setCurrentSourceKey] = useState<string | null>(null);

  /**
   * Player-first fetch status.
   *  null           = not in pending-fetch mode (normal direct-URL play)
   *  "finding"      = fetching sources from addons
   *  "choosing"     = sources received, picking best
   *  "error-fetch"  = fetch failed or no playable source found
   */
  const [fetchStatus, setFetchStatus] = useState<null | "finding" | "choosing" | "error-fetch">(null);
  /** Error message shown when fetchStatus === "error-fetch". */
  const [fetchError, setFetchError] = useState<string | null>(null);

  /** Whether the dev stats HUD is visible (hidden by default — Part 4). */
  const [statsVisible, setStatsVisible] = useState(false);
  /** Optimistic subtitle/audio track ids: updated immediately on select change
   *  so the dropdown reflects the choice before the 250ms poll catches up. */
  const [optimisticSid, setOptimisticSid] = useState<number | null>(null);
  const [optimisticAid, setOptimisticAid] = useState<number | null>(null);
  /** Temporary volume feedback text ("Volume 65%"), null when hidden. */
  const [volumeToast, setVolumeToast] = useState<string | null>(null);
  /** Temporary track switch feedback text (e.g. "Subtitles: EN"), null when hidden. */
  const [trackToast, setTrackToast] = useState<string | null>(null);
  const trackToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- Store subscription --------------------------------------------------

  useEffect(() => {
    const unsub = subscribeEmbeddedPlayRequest((r) => setReq(r));
    return () => unsub();
  }, []);

  // ---- Exit fullscreen when overlay closes --------------------------------
  // When req goes null: only exit fullscreen if the overlay entered it.
  // If the app was already fullscreen before, leave it fullscreen.
  useEffect(() => {
    if (req === null && isFullscreenRef.current && !wasFullscreenBeforeRef.current) {
      void window.embeddedMpv?.setFullscreen(false);
      setIsFullscreen(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req]);

  // ---- Playback lifecycle --------------------------------------------------

  const profileId = profile?.id ?? null;

  useEffect(() => {
    if (!req || profileId === null) return;
    let cancelled = false;

    const doStart = async () => {
      // 0. Record pre-play fullscreen state, then go fullscreen.
      try {
        const alreadyFullscreen = await window.mediaCenter.system.getFullscreen();
        wasFullscreenBeforeRef.current = alreadyFullscreen;
        if (!alreadyFullscreen) {
          await window.mediaCenter.system.setFullscreen(true);
        }
      } catch {
        wasFullscreenBeforeRef.current = false;
      }

      // 1. Load saved progress (always).
      let startSeconds: number | undefined;
      try {
        const saved = await window.mediaCenter.progress.get({
          profileId,
          mediaId: req.mediaId,
          playableId: req.playableId,
        });
        if (saved && !saved.completed && saved.progressSeconds > 10) {
          startSeconds = saved.progressSeconds;
          if (isDev) {
            console.log(
              "[embedded:resume] found saved progress:",
              startSeconds,
              "s -- will seek on file load",
            );
          }
        }
      } catch {
        // Progress lookup failure is non-fatal.
      }

      if (cancelled) return;

      // 2. Load saved volume (always). We store it in a local variable so
      //    the playbackState sync effect (volumeRef.current = state.volume)
      //    can't overwrite it before we apply it after startPlayback.
      let pendingVolume: number | null = null;
      try {
        const savedVol = await window.embeddedMpv?.getVolume(profileId);
        if (typeof savedVol === "number") {
          pendingVolume = savedVol;
          prevVolumeRef.current = savedVol > 0 ? savedVol : prevVolumeRef.current;
        }
      } catch {
        // Non-fatal -- fall back to mpv default.
      }
      if (cancelled) return;

      // 3. Player-first: resolve the best source inside the overlay when
      //    the request arrives without a URL (pendingSourceFetch === true).
      let resolvedUrl = req.streamUrl;
      if (req.pendingSourceFetch) {
        setFetchStatus("finding");
        const pendingCollected: StreamSourceResult[] = [];
        try {
          const pendingAddons = await window.mediaCenter.addons.list(profileId);
          const eligible = pendingAddons.filter((a) =>
            addonSupportsResource(a.manifest, "stream", req.type),
          );
          const seen = new Set<string>();
          await Promise.allSettled(
            eligible.map((a) =>
              window.mediaCenter.streams
                .fetch({ manifestUrl: a.manifestUrl, type: req.type, id: req.playableId })
                .then((res) => {
                  ((res.streams ?? []) as StremioStream[]).forEach((s, i) => {
                    const key = streamDedupKey(s, `${a.id}#${i}`);
                    if (!seen.has(key)) {
                      seen.add(key);
                      pendingCollected.push({
                        stream: s,
                        source: { addonId: a.id, addonName: a.manifest.name },
                        key,
                      });
                    }
                  });
                })
                .catch(() => {}),
            ),
          );
          if (cancelled) return;
          if (pendingCollected.length === 0) {
            setFetchStatus("error-fetch");
            setFetchError("No sources found. Try choosing a source manually.");
            return;
          }
          setFetchStatus("choosing");
          // Apply saved source pref ordering.
          let ordered = [...pendingCollected];
          try {
            const pref = await window.mediaCenter.sourcePref.get({
              profileId,
              type: req.type,
              mediaId: req.mediaId,
              playableId: req.playableId,
            });
            if (pref && !cancelled) {
              const prefIdx = ordered.findIndex(
                (r) =>
                  r.source.addonId === pref.addonId &&
                  (pref.quality === "" || (r.stream.name ?? "").includes(pref.quality)) &&
                  (pref.sourceName === "" ||
                    (r.stream.name ?? "")
                      .toLowerCase()
                      .includes(pref.sourceName.slice(0, 6).toLowerCase())),
              );
              if (prefIdx > 0) {
                const [match] = ordered.splice(prefIdx, 1);
                ordered = [match, ...ordered];
              }
            }
          } catch {
            // Pref lookup failure is non-fatal.
          }
          if (cancelled) return;
          // Populate source panel so "Choose Source" works without re-fetching.
          setOverlayResults(ordered);

          // Manual source mode: show picker, wait for user selection.
          if (req.manualSourceSelect) {
            setFetchStatus(null);
            setSourcePanelOpen(true);
            return;
          }

          const best = chooseBestSource(ordered, settings);
          if (!best?.stream.url) {
            setFetchStatus("error-fetch");
            setFetchError("No playable source found. Try choosing a source manually.");
            return;
          }
          resolvedUrl = best.stream.url;
          setCurrentSourceKey(best.key);
          // Persist this source as the preferred one for next time.
          void window.mediaCenter.sourcePref
            .save({
              profileId,
              type: req.type,
              mediaId: req.mediaId,
              playableId: req.playableId,
              addonId: best.source.addonId,
              quality: detectResolution(best.stream.name ?? ""),
              sourceName: best.stream.name ?? "",
            })
            .catch(() => {});
        } catch (err) {
          if (!cancelled) {
            setFetchStatus("error-fetch");
            setFetchError(err instanceof Error ? err.message : "Failed to load sources.");
          }
          return;
        }
        if (cancelled) return;
        setFetchStatus(null);
      }

      // 4. Build progress context + start playback.
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

      await startPlayback(resolvedUrl, ctx);
      // Apply saved volume after session starts (mpv resets to 100 on start).
      // We use pendingVolume (the local var) rather than volumeRef.current because
      // the playbackState sync effect may have overwritten volumeRef during
      // startPlayback (MPV reports 100 before our command arrives).
      if (!cancelled && pendingVolume !== null) {
        volumeRef.current = pendingVolume;
        void window.embeddedMpv?.command("volume", pendingVolume).catch(() => {});
      }
    };

    void doStart();
    return () => {
      cancelled = true;
      stopPlayback();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req, profileId, retryKey, startPlayback, stopPlayback]);

  // ---- E8: Resolve next episode + prefetch when req changes ---------------

  useEffect(() => {
    // Reset next-episode state whenever the current episode changes.
    setNextEpisode(null);
    setNextSource(null);
    setNextSourceLoading(false);
    setShowNextEpPrompt(false);

    if (!req || req.type !== "series" || profileId === null) return;
    let cancelled = false;

    const resolveAndPrefetch = async () => {
      // 1. Resolve the next normal episode from the DB cache.
      let next: SeriesNextEpisode | null = null;
      try {
        next = await window.mediaCenter.series.getNextEpisode({
          seriesId: req.mediaId,
          currentVideoId: req.playableId,
        });
      } catch {
        return; // Non-fatal — series may not be cached yet.
      }
      if (cancelled || !next) return;

      setNextEpisode(next);
      if (isDev) {
        console.log("[next-ep] resolved:", nextEpLabel(next), next.videoId);
      }

      // 2. Get addon list for prefetching.
      let addons;
      try {
        addons = await window.mediaCenter.addons.list(profileId);
      } catch {
        return;
      }
      if (cancelled) return;

      // 3. Fire-and-forget prefetch (non-blocking).
      prefetchEpisodeSources(addons, "series", req.mediaId, next.videoId, profileId);
      if (isDev) {
        console.log("[next-ep] prefetch triggered for", next.videoId);
      }

      // 4. Poll for the prefetch result (up to ~30s, checking every 2s).
      //    Once sources arrive, run affinity scoring to pick the best one.
      setNextSourceLoading(true);
      let attempts = 0;
      const MAX_ATTEMPTS = 15;
      const POLL_INTERVAL = 2000;

      const pollForSource = () => {
        if (cancelled) return;
        const cacheKey = makePrefetchKey(profileId, "series", req.mediaId, next!.videoId);
        const cached = getCachedSources(cacheKey);
        if (cached !== null) {
          // Sources arrived — pick the best using affinity scoring.
          const currentStream: StremioStream = {
            url: req.streamUrl,
            name: req.streamName,
            title: req.streamTitle,
          };
          const best = chooseNextEpisodeSource(
            currentStream,
            "", // addonId unknown from PlayRequest; affinity uses other signals
            cached,
            settings,
          );
          if (!cancelled) {
            setNextSource(best);
            setNextSourceLoading(false);
            if (isDev) {
              console.log(
                "[next-ep] source preselected:",
                best?.stream.name ?? "(none)",
                best?.stream.url?.slice(0, 60) ?? "",
              );
            }
          }
          return;
        }
        attempts++;
        if (attempts < MAX_ATTEMPTS) {
          setTimeout(pollForSource, POLL_INTERVAL);
        } else {
          if (!cancelled) setNextSourceLoading(false);
          if (isDev) {
            console.log("[next-ep] prefetch timed out — no source preselected");
          }
        }
      };
      setTimeout(pollForSource, POLL_INTERVAL);
    };

    void resolveAndPrefetch();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req, profileId]);

  // ---- Reset source picker + fetch state when the episode/movie changes ----
  useEffect(() => {
    setSourcePanelOpen(false);
    setOverlayResults(null);
    setOverlayFetchError(null);
    setCurrentSourceKey(null);
    setFetchStatus(null);
    setFetchError(null);
    setOptimisticSid(null);
    setOptimisticAid(null);
  }, [req?.playableId]);

  // ---- Apply subtitle/audio preferences once when tracks first arrive ------
  //
  // External MPV gets subtitle/audio settings via CLI args (--slang, --alang,
  // --no-sub). The embedded player must apply them via IPC after tracks load.
  // This effect fires every time the track lists change, but the actual
  // commands are sent only ONCE per playable (tracked via ref) so that user
  // manual selections are never overridden.
  //
  // Priority:
  //   1. If autoEnableSubtitles === false: disable subtitles (sid = -1).
  //   2. If autoEnableSubtitles === true:  find best track by language pref.
  //   3. Audio: find best track by audioLanguage (or animeAudioLanguage).
  const prefsAppliedRef = useRef(false);

  // Reset the applied flag whenever the playable changes.
  useEffect(() => {
    prefsAppliedRef.current = false;
  }, [req?.playableId]);

  useEffect(() => {
    // Only fire after tracks load AND running AND not yet applied for this req.
    if (!running || prefsAppliedRef.current) return;
    const hasSubs = subtitleTracks.length > 0;
    const hasAudio = audioTracks.length > 0;
    if (!hasSubs && !hasAudio) return; // tracks not yet available

    prefsAppliedRef.current = true; // mark before sending to avoid double-fire

    const isAnimeContent = req?.isAnime ?? false;

    // ── Subtitle preference ──
    if (hasSubs) {
      if (!settings.autoEnableSubtitles) {
        // User wants subtitles off — disable them.
        setSubtitleTrack(-1);
        setOptimisticSid(-1);
        if (isDev) console.log("[prefs] subtitles disabled (autoEnableSubtitles=false)");
      } else if (settings.subtitleLanguage) {
        const lang = settings.subtitleLanguage.toLowerCase();
        // Find a track whose lang or title matches the preference.
        const best = subtitleTracks.find((t) => {
          const tl = (t.lang ?? "").toLowerCase();
          const tt = (t.title ?? "").toLowerCase();
          return tl.startsWith(lang) || lang.startsWith(tl.slice(0, 2)) || tt.includes(lang);
        });
        if (best) {
          setSubtitleTrack(best.id);
          setOptimisticSid(best.id);
          if (isDev) console.log("[prefs] subtitle track selected:", best.lang, best.id);
        }
        // If no matching track found, leave mpv's default selection.
      }
    }

    // ── Audio preference ──
    if (hasAudio && audioTracks.length > 1) {
      const rawLang = isAnimeContent
        ? (settings.animeAudioLanguage || settings.audioLanguage)
        : settings.audioLanguage;
      const lang = rawLang?.toLowerCase() ?? "";
      if (lang && lang !== "auto" && lang !== "original") {
        const best = audioTracks.find((t) => {
          const tl = (t.lang ?? "").toLowerCase();
          const tt = (t.title ?? "").toLowerCase();
          return tl.startsWith(lang) || lang.startsWith(tl.slice(0, 2)) || tt.includes(lang);
        });
        if (best) {
          setAudioTrack(best.id);
          setOptimisticAid(best.id);
          if (isDev) console.log("[prefs] audio track selected:", best.lang, best.id);
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, subtitleTracks, audioTracks]);

  // ---- E8: Show/hide next episode prompt based on remaining time -----------

  useEffect(() => {
    if (!nextEpisode || !running) {
      setShowNextEpPrompt(false);
      return;
    }
    const timePos = playbackState?.timePos ?? -1;
    const duration = playbackState?.duration ?? -1;
    if (timePos < 0 || duration <= 0) return;
    const remaining = duration - timePos;
    const shouldShow = remaining > 0 && remaining <= NEXT_EP_PROMPT_SECS;
    setShowNextEpPrompt(shouldShow);
    if (isDev && shouldShow) {
      console.log(`[next-ep] prompt shown — ${remaining.toFixed(0)}s remaining`);
    }
  }, [playbackState?.timePos, playbackState?.duration, nextEpisode, running]);

  // ---- In-player source picker fetch ----------------------------------------

  const openSourcePanel = useCallback(async () => {
    setSourcePanelOpen(true);
    if (overlayResults !== null || !req || profileId === null) return;
    setOverlayLoading(true);
    setOverlayFetchError(null);
    try {
      const addons = await window.mediaCenter.addons.list(profileId);
      const eligible = addons.filter((a) =>
        addonSupportsResource(a.manifest, "stream", req.type),
      );
      const collected: StreamSourceResult[] = [];
      const seen = new Set<string>();
      await Promise.allSettled(
        eligible.map((a) =>
          window.mediaCenter.streams
            .fetch({ manifestUrl: a.manifestUrl, type: req.type, id: req.playableId })
            .then((res) => {
              ((res.streams ?? []) as StremioStream[]).forEach((s, i) => {
                const key = streamDedupKey(s, `${a.id}#${i}`);
                if (!seen.has(key)) {
                  seen.add(key);
                  collected.push({
                    stream: s,
                    source: { addonId: a.id, addonName: a.manifest.name },
                    key,
                  });
                }
              });
            })
            .catch(() => {}),
        ),
      );
      setOverlayResults(collected);
    } catch (e) {
      setOverlayFetchError(
        e instanceof Error ? e.message : "Failed to load sources.",
      );
    } finally {
      setOverlayLoading(false);
    }
  }, [req, profileId, overlayResults]);

  const handleOverlaySourceSelect = useCallback(
    (result: StreamSourceResult) => {
      if (!req) return;
      setSourcePanelOpen(false);
      setCurrentSourceKey(result.key);
      const newReq: PlayRequest = {
        ...req,
        streamUrl: result.stream.url ?? "",
        streamTitle: result.stream.title,
        streamName: result.stream.name,
        pendingSourceFetch: false,
      };
      setEmbeddedPlayRequest(newReq);
    },
    [req],
  );

  // ---- E8: Transition to next episode -------------------------------------

  const handleNextEpisode = useCallback(() => {
    if (!nextEpisode || !nextSource || transitioning || profileId === null || !req) return;
    setTransitioning(true);
    if (isDev) {
      console.log("[next-ep] clicked — transitioning to", nextEpLabel(nextEpisode));
    }
    // Build the new PlayRequest for the next episode.
    const nextReq: PlayRequest = {
      backend: "embedded-mpv-experimental",
      type: "series",
      mediaId: req.mediaId,
      playableId: nextEpisode.videoId,
      mediaTitle: req.mediaTitle,
      episodeTitle: nextEpisode.title ?? undefined,
      season: nextEpisode.season ?? undefined,
      episode: nextEpisode.episode ?? undefined,
      poster: req.poster,
      streamUrl: nextSource.stream.url ?? "",
      streamTitle: nextSource.stream.title,
      streamName: nextSource.stream.name,
    };
    // Dispatch to the store — the overlay's lifecycle effect will stop the
    // current session (including progress flush) and start the new one.
    setEmbeddedPlayRequest(nextReq);
    // transitioning is reset by the req-change effect resetting state.
  }, [nextEpisode, nextSource, transitioning, profileId, req]);

  // Reset transitioning flag when req changes (new episode started).
  useEffect(() => {
    setTransitioning(false);
  }, [req]);

  // ---- Fullscreen subscription --------------------------------------------

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
      if (pausedRef.current || draggingRef.current || isInteractingRef.current) return;
      if (!runningRef.current) return;
      setControlsVisible(false);
    }, HIDE_DELAY_MS);
  }, [clearHideTimer]);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    scheduleHideControls();
  }, [scheduleHideControls]);

  const pinControls = useCallback(() => {
    isInteractingRef.current = true;
    clearHideTimer();
    setControlsVisible(true);
  }, [clearHideTimer]);

  const unpinControls = useCallback(() => {
    isInteractingRef.current = false;
    scheduleHideControls();
  }, [scheduleHideControls]);

  const paused = playbackState?.paused ?? true;

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { runningRef.current = running; }, [running]);
  // Mirror current volume into ref without depending on the `volume`
  // const declared later in the render scope.
  useEffect(() => {
    volumeRef.current = playbackState?.volume ?? 100;
  }, [playbackState?.volume]);

  useEffect(() => {
    if (running) showControls();
  }, [running, showControls]);

  useEffect(() => {
    if (paused) {
      clearHideTimer();
      setControlsVisible(true);
    } else if (running) {
      scheduleHideControls();
    }
  }, [paused, running, clearHideTimer, scheduleHideControls]);

  useEffect(() => {
    if (!req) {
      clearHideTimer();
      setControlsVisible(true);
    }
  }, [req, clearHideTimer]);

  useEffect(() => () => clearHideTimer(), [clearHideTimer]);

  const handleMouseActivity = useCallback(() => showControls(), [showControls]);

  // ---- Persist volume per profile ----------------------------------------

  const saveVolume = useCallback((vol: number) => {
    if (profileId === null) return;
    if (saveVolumeTimerRef.current !== null) clearTimeout(saveVolumeTimerRef.current);
    saveVolumeTimerRef.current = setTimeout(() => {
      saveVolumeTimerRef.current = null;
      void window.embeddedMpv?.setVolume(profileId, vol);
    }, 400); // debounce 400 ms so rapid scroll/drag doesn't spam the DB
  }, [profileId]);

  // ---- Volume toast helper ------------------------------------------------

  const showVolumeToast = useCallback((vol: number) => {
    setVolumeToast(`Volume ${Math.round(vol)}%`);
    if (volumeToastTimerRef.current !== null) {
      clearTimeout(volumeToastTimerRef.current);
    }
    volumeToastTimerRef.current = setTimeout(() => {
      setVolumeToast(null);
      volumeToastTimerRef.current = null;
    }, 1200);
  }, []);

  // Cleanup toast timer on unmount.
  useEffect(() => () => {
    if (volumeToastTimerRef.current !== null) clearTimeout(volumeToastTimerRef.current);
    if (saveVolumeTimerRef.current !== null) clearTimeout(saveVolumeTimerRef.current);
    if (dblClickTimerRef.current !== null) clearTimeout(dblClickTimerRef.current);
    if (trackToastTimerRef.current !== null) clearTimeout(trackToastTimerRef.current);
  }, []);

  // ---- Mouse wheel → volume -----------------------------------------------
  // Attached to .emb-overlay__stage so the source panel and control bar
  // capture wheel events before they bubble here (they call stopPropagation).

  const handleWheelVolume = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (!running || !req) return;
      // Skip when the user is interacting with an input control.
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "SELECT") return;
      e.preventDefault(); // suppress page scroll
      // Smooth accumulator: 60px of scroll = 1% volume step, cap 3%/event.
      wheelAccumulatorRef.current += -e.deltaY;
      const rawSteps = Math.trunc(wheelAccumulatorRef.current / 60);
      const steps = Math.max(-3, Math.min(3, rawSteps));
      if (steps === 0) return;
      wheelAccumulatorRef.current -= steps * 60;
      const next = Math.min(100, Math.max(0, volumeRef.current + steps));
      setVolume(next);
      showControls();
      showVolumeToast(next);
      saveVolume(next);
    },
    [running, req, setVolume, showControls, showVolumeToast],
  );

  // ---- Stage click / double-click handlers --------------------------------
  //
  // Single click  → toggle play/pause  (fires after 250 ms to allow dblclick)
  // Double click  → toggle fullscreen  (cancels the pending single-click)
  //
  // Both are suppressed when the click target is inside a control element
  // (control bar, header, source panel, next-ep prompt, or any interactive).

  /** Returns true when the click target is inside a UI control element. */
  const isControlTarget = (e: React.MouseEvent<HTMLDivElement>): boolean => {
    const el = e.target as HTMLElement;
    return !!(
      el.closest(".emb-overlay__controls") ||
      el.closest(".emb-overlay__header") ||
      el.closest(".emb-overlay__source-panel") ||
      el.closest(".emb-overlay__next-ep") ||
      el.closest("button") ||
      el.closest("input") ||
      el.closest("select")
    );
  };

  /** Single click: schedule a play/pause toggle after 250 ms. */
  const handleStageClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isControlTarget(e)) return;
      if (!running || starting) return;
      showControls();
      // Schedule — will be cancelled if a second click arrives in time.
      dblClickTimerRef.current = setTimeout(() => {
        dblClickTimerRef.current = null;
        togglePause();
      }, 250);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [running, starting, togglePause, showControls],
  );

  /** Double click: cancel the pending play/pause timer, toggle fullscreen. */
  const handleStageDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isControlTarget(e)) return;
      // Cancel the single-click play/pause that was scheduled.
      if (dblClickTimerRef.current !== null) {
        clearTimeout(dblClickTimerRef.current);
        dblClickTimerRef.current = null;
      }
      showControls();
      if (fullscreenAvailable) {
        void window.embeddedMpv?.setFullscreen(!isFullscreen);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fullscreenAvailable, isFullscreen, showControls],
  );

  // ---- Fix stuck scrub drag -----------------------------------------------
  // mouseup can fire outside the <input> if the user drags quickly. This
  // window-level handler catches those releases and commits the seek.

  useEffect(() => {
    if (!dragging) return;
    const onGlobalMouseUp = () => {
      if (!draggingRef.current) return;
      const val = dragValue;
      draggingRef.current = false;
      setDragging(false);
      seekTo(val);
      unpinControls();
    };
    window.addEventListener("mouseup", onGlobalMouseUp);
    return () => window.removeEventListener("mouseup", onGlobalMouseUp);
  }, [dragging, dragValue, seekTo, unpinControls]);

  // ---- Keyboard shortcuts --------------------------------------------------

  const handleRetry = useCallback(() => {
    stopPlayback();
    setRetryKey((k) => k + 1);
  }, [stopPlayback]);

  const handleOpenInMpv = useCallback(() => {
    if (!req) return;
    const mpvReq = buildPlayRequest({ ...req, backend: "external-mpv" }, "manual");
    void dispatchPlayRequest(mpvReq, {
      profileId: profileId ?? undefined,
    });
    clearEmbeddedPlayRequest();
  }, [req, profileId]);

  const handleClose = useCallback(() => clearEmbeddedPlayRequest(), []);

  useEffect(() => {
    if (!req) return;
    function onKey(e: KeyboardEvent) {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
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
          const next = vol > 0 ? 0 : (prevVolumeRef.current || 100);
          if (vol > 0) prevVolumeRef.current = vol;
          setVolume(next);
          saveVolume(next);
          break;
        }
        case "f":
        case "F":
          if (fullscreenAvailable) {
            e.preventDefault();
            toggleFullscreen();
          }
          break;
        case "n":
        case "N":
          if (showNextEpPrompt && nextSource && !transitioning) {
            e.preventDefault();
            handleNextEpisode();
          }
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    req, handleClose, togglePause, seekRelative, setVolume,
    playbackState?.volume, fullscreenAvailable, toggleFullscreen, isFullscreen,
    showControls, showNextEpPrompt, nextSource, transitioning, handleNextEpisode,
  ]);

  // ---- Track toast helper -------------------------------------------------

  const showTrackToast = useCallback((msg: string) => {
    setTrackToast(msg);
    if (trackToastTimerRef.current !== null) clearTimeout(trackToastTimerRef.current);
    trackToastTimerRef.current = setTimeout(() => {
      setTrackToast(null);
      trackToastTimerRef.current = null;
    }, 1800);
  }, []);

  // ---- Track select handlers -----------------------------------------------

  const handleSubtitleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const id = Number(e.target.value);
      setOptimisticSid(id);
      setSubtitleTrack(id);
      if (id === -1) {
        showTrackToast("Subtitles off");
      } else {
        const track = subtitleTracks.find((t) => t.id === id);
        const label = track
          ? [track.lang?.toUpperCase(), track.title].filter(Boolean).join(" ") || `Track ${id}`
          : `Track ${id}`;
        showTrackToast(`Subtitles: ${label}`);
      }
    },
    [setSubtitleTrack, subtitleTracks, showTrackToast],
  );
  const handleAudioChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const id = Number(e.target.value);
      setOptimisticAid(id);
      setAudioTrack(id);
      const track = audioTracks.find((t) => t.id === id);
      const label = track
        ? [track.lang?.toUpperCase(), track.title].filter(Boolean).join(" ") || `Track ${id}`
        : `Track ${id}`;
      showTrackToast(`Audio: ${label}`);
    },
    [setAudioTrack, audioTracks, showTrackToast],
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
    const v = Number(e.target.value);
    setVolume(v);
    saveVolume(v);
  };

  // ---- Derived display values ---------------------------------------------

  const polledSid = subtitleTracks.find((t) => t.selected)?.id ?? -1;
  const polledAid = audioTracks.find((t) => t.selected)?.id ?? -1;
  // Use optimistic value immediately; polled value as fallback when no pending change.
  const selectedSid = optimisticSid !== null ? optimisticSid : polledSid;
  const selectedAid = optimisticAid !== null ? optimisticAid : polledAid;

  const title =
    req && req.mediaId !== "experimental"
      ? req.episodeTitle
        ? `${req.mediaTitle} — ${req.episodeTitle}`
        : req.mediaTitle
      : "(experimental URL)";

  // Per-phase loading text shown in the spinner.
  const loadingText =
    fetchStatus === "finding"
      ? "Finding sources…"
      : fetchStatus === "choosing"
        ? "Choosing source…"
        : starting
          ? "Starting player…"
          : !running && !error
            ? "Loading source…"
            : "Loading…";

  // Show spinner whenever we are NOT yet in steady-state (playing / paused / error).
  // Covers: source-resolution phases, native MPV start, and waiting for first frame.
  const showLoadingIndicator =
    fetchStatus === "finding" ||
    fetchStatus === "choosing" ||
    starting ||
    (!running && !error && fetchStatus !== "error-fetch");

  const statusText =
    fetchStatus === "finding"
      ? "Finding sources…"
      : fetchStatus === "choosing"
        ? "Choosing source…"
        : error
          ? "Error"
          : starting
            ? "Starting player…"
            : !running
              ? "Loading source…"
              : paused
                ? "Paused"
                : "Playing";

  // ---- Render --------------------------------------------------------------

  if (!req) return null;

  const rootClass = [
    "emb-overlay",
    isFullscreen ? "is-fullscreen" : "",
    !controlsVisible ? "controls-hidden" : "",
    sourcePanelOpen ? "source-panel-open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Next episode prompt label.
  const nextEpButtonLabel = (() => {
    if (!nextEpisode) return null;
    if (nextSourceLoading) return "Preparing…";
    if (!nextSource) return null;
    const label = nextEpLabel(nextEpisode);
    const epTitle = nextEpisode.title;
    return epTitle ? `${label}: ${epTitle}` : label;
  })();

  // Best source quality label for the source button.
  const bestOverlaySource = overlayResults
    ? chooseBestSource(overlayResults, settings)
    : null;
  const currentOverlaySourceKey = currentSourceKey ?? bestOverlaySource?.key ?? null;

  const qualityBadge = (result: StreamSourceResult | null): string | null => {
    if (!result) return null;
    const text = [result.stream.name, result.stream.title].filter(Boolean).join(" ");
    const tier = detectResolution(text);
    return tier === "unknown" || tier === "cam" ? null : tier;
  };

  // Next-episode skip button: only shown when a next episode is available.
  const hasNextEp = !!nextEpisode;

  return (
    <div
      className={rootClass}
      role="dialog"
      aria-label="Embedded player"
      onMouseMove={handleMouseActivity}
      onMouseEnter={handleMouseActivity}
    >
      <div
        className="emb-overlay__stage"
        onWheel={handleWheelVolume}
        onClick={handleStageClick}
        onDoubleClick={handleStageDoubleClick}
      >
        <canvas ref={canvasRef} className="emb-overlay__canvas" />

        {/* Loading indicator: visible during ALL pre-ready phases
             (source resolution, native start, waiting for first frame). */}
        {showLoadingIndicator && (
          <div className="emb-overlay__loading-indicator">
            <div className="emb-overlay__spinner" />
            <span className="emb-overlay__loading-text">{loadingText}</span>
          </div>
        )}

        {/* ── Error banners + recovery actions ── */}
        {(!available || error || fetchStatus === "error-fetch") && (
          <div className="emb-overlay__errors">
            {/* Fetch error panel (player-first: source resolution failed) */}
            {fetchStatus === "error-fetch" && !error && (
              <div className="emb-overlay__error-panel" role="alert">
                <div className="emb-overlay__error-message">
                  {fetchError ?? "Failed to load sources."}
                </div>
                <div className="emb-overlay__error-actions">
                  <button
                    type="button"
                    className="emb-overlay__err-btn emb-overlay__err-btn--primary"
                    onClick={() => {
                      setFetchStatus(null);
                      setFetchError(null);
                      void openSourcePanel();
                    }}
                  >
                    Choose Source
                  </button>
                  <button
                    type="button"
                    className="emb-overlay__err-btn"
                    onClick={handleRetry}
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    className="emb-overlay__err-btn"
                    onClick={handleClose}
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
            {!available && (
              <div className="emb-overlay__error-panel" role="alert">
                <div className="emb-overlay__error-message">
                  Embedded player addon unavailable —{" "}
                  <code>window.embeddedMpv</code> is missing. Make sure the native
                  addon is built (<code>native/embedded-mpv/</code>) and all DLLs
                  are present in <code>vendor/</code>.
                </div>
                <div className="emb-overlay__error-actions">
                  <button
                    type="button"
                    className="emb-overlay__err-btn emb-overlay__err-btn--primary"
                    onClick={handleOpenInMpv}
                  >
                    Open in MPV
                  </button>
                  <button
                    type="button"
                    className="emb-overlay__err-btn"
                    onClick={handleClose}
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
            {error && (
              <div className="emb-overlay__error-panel" role="alert">
                <div className="emb-overlay__error-message">{error}</div>
                <div className="emb-overlay__error-actions">
                  {/* Try next source when multiple were fetched (player-first) */}
                  {(() => {
                    const nextBest = (overlayResults ?? []).find(
                      (r) => r.key !== currentSourceKey && r.stream.url,
                    );
                    return nextBest ? (
                      <button
                        type="button"
                        className="emb-overlay__err-btn emb-overlay__err-btn--primary"
                        onClick={() => handleOverlaySourceSelect(nextBest)}
                      >
                        Try next source
                      </button>
                    ) : null;
                  })()}
                  <button
                    type="button"
                    className="emb-overlay__err-btn emb-overlay__err-btn--primary"
                    onClick={() => { void openSourcePanel(); }}
                  >
                    Choose Source
                  </button>
                  <button
                    type="button"
                    className="emb-overlay__err-btn"
                    onClick={handleRetry}
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    className="emb-overlay__err-btn"
                    onClick={handleOpenInMpv}
                  >
                    Open in MPV
                  </button>
                  <button
                    type="button"
                    className="emb-overlay__err-btn"
                    onClick={handleClose}
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Header ── */}
        <div className="emb-overlay__header">
          <div className="emb-overlay__title-area">
            <span className="emb-overlay__title" title={title}>
              {title}
            </span>
            <span className="exp-badge">BETA</span>
          </div>
          <div className="emb-overlay__header-actions">
            <button
              type="button"
              className={`emb-overlay__ctrl emb-overlay__ctrl--icon emb-overlay__ctrl--ghost${statsVisible ? " is-active" : ""}`}
              onClick={() => setStatsVisible((v) => !v)}
              title="Toggle performance stats"
              aria-label="Toggle performance stats"
            >
              <InfoIcon size={16} />
            </button>
            <button
              type="button"
              className="emb-overlay__close"
              onClick={handleClose}
              title="Close embedded player (Esc)"
              aria-label="Close embedded player"
              onMouseEnter={pinControls}
              onMouseLeave={unpinControls}
            >
              <XIcon size={18} />
            </button>
          </div>
        </div>

        {/* ── Dev stats HUD ── */}
        {statsVisible && (
          <div className="emb-overlay__stats muted small">
            <span>{stats.fps.toFixed(1)} fps</span>
            <span>· {stats.avgGetMs.toFixed(1)} ms</span>
            <span>· {stats.drawn}d/{stats.skipped}s</span>
          </div>
        )}

        {/* ── Volume toast ── */}
        {volumeToast && (
          <div className="emb-overlay__volume-toast" aria-live="polite">
            {volumeToast}
          </div>
        )}

        {/* ── Track toast (subtitle/audio switch feedback) ── */}
        {trackToast && (
          <div className="emb-overlay__track-toast" aria-live="polite">
            {trackToast}
          </div>
        )}

        {/* ── Next Episode prompt (bottom-right, above controls) ── */}
        {showNextEpPrompt && nextEpButtonLabel && (
          <div
            className="emb-overlay__next-ep"
            onMouseEnter={pinControls}
            onMouseLeave={unpinControls}
          >
            <button
              type="button"
              className="emb-overlay__next-ep-btn"
              onClick={handleNextEpisode}
              disabled={!nextSource || transitioning}
              title={nextSource ? "Play next episode (N)" : "Preparing next episode…"}
            >
              {transitioning ? "Starting…"
                : nextSourceLoading ? "Preparing…"
                : <><SkipForwardIcon size={13} style={{verticalAlign:"middle",marginRight:5}} />{"Up Next: " + nextEpButtonLabel}</>}
            </button>
          </div>
        )}

        {/* ── In-player Source Picker Panel ── */}
        {sourcePanelOpen && (
          <div
            className="emb-overlay__source-panel"
            onMouseEnter={pinControls}
            onMouseLeave={unpinControls}
            onWheel={(e) => e.stopPropagation()}
          >
            <div className="emb-overlay__source-panel-header">
              <span className="emb-overlay__source-panel-title">Sources</span>
              <button
                type="button"
                className="emb-overlay__ctrl emb-overlay__ctrl--icon"
                onClick={() => setSourcePanelOpen(false)}
                aria-label="Close source panel"
              >
                <XIcon size={16} />
              </button>
            </div>
            {overlayLoading && (
              <div className="emb-overlay__source-panel-loading muted small">
                Loading sources…
              </div>
            )}
            {overlayFetchError && (
              <div className="error-banner emb-overlay__banner" role="alert">
                {overlayFetchError}
              </div>
            )}
            {!overlayLoading && overlayResults !== null && (
              overlayResults.length === 0 ? (
                <div className="emb-overlay__source-panel-empty muted small">
                  No sources found for this episode.
                </div>
              ) : (
                <ul className="emb-overlay__source-list">
                  {overlayResults.map((r) => {
                    const isCurrent = r.key === currentOverlaySourceKey;
                    const q = qualityBadge(r);
                    const isPlaying = req?.streamUrl === (r.stream.url ?? "");
                    return (
                      <li
                        key={r.key}
                        className={`emb-overlay__source-item${isCurrent ? " is-current" : ""}${isPlaying ? " is-playing" : ""}`}
                      >
                        <button
                          type="button"
                          className="emb-overlay__source-item-btn"
                          onClick={() => handleOverlaySourceSelect(r)}
                          title={r.stream.url ?? ""}
                        >
                          <span className="emb-overlay__source-name">
                            {r.stream.name ?? r.source.addonName}
                          </span>
                          <span className="emb-overlay__source-meta muted small">
                            {r.stream.title && (
                              <span className="emb-overlay__source-title">
                                {r.stream.title}
                              </span>
                            )}
                            {q && (
                              <span className="emb-overlay__source-quality">{q}</span>
                            )}
                            <span className="emb-overlay__source-addon">
                              {r.source.addonName}
                            </span>
                          </span>
                        </button>
                        {isPlaying && (
                          <span className="emb-overlay__source-badge emb-overlay__source-badge--playing">
                            Playing
                          </span>
                        )}
                        {isCurrent && !isPlaying && (
                          <span className="emb-overlay__source-badge emb-overlay__source-badge--best">
                            Best
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )
            )}
          </div>
        )}

        {/* ── Controls bar ── */}
        {(running || starting) && (
          <div
            className="emb-overlay__controls"
            onMouseEnter={pinControls}
            onMouseLeave={unpinControls}
            onFocus={pinControls}
            onBlur={unpinControls}
          >
            {/* ── Row 1: progress bar ── */}
            <div className="emb-overlay__progress-row">
              <span className="emb-overlay__time">
                {formatTime(dragging ? dragValue : timePos)}
              </span>
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
                title="Seek (← →)"
              />
              <span className="emb-overlay__time emb-overlay__time--dur">
                {formatTime(duration)}
              </span>
            </div>

            {/* ── Row 2: transport ── */}
            <div className="emb-overlay__transport">

              {/* Left group */}
              <div className="emb-overlay__transport-left">
                {/* Play / Pause */}
                <button
                  type="button"
                  className="emb-overlay__ctrl emb-overlay__ctrl--play"
                  onClick={togglePause}
                  title={paused ? "Play (Space)" : "Pause (Space)"}
                  aria-label={paused ? "Play" : "Pause"}
                  disabled={starting}
                >
                  {paused ? <PlayIcon size={20} /> : <PauseIcon size={20} />}
                </button>

                {/* Next Episode (only if available) */}
                {hasNextEp && (
                  <button
                    type="button"
                    className="emb-overlay__ctrl emb-overlay__ctrl--icon"
                    onClick={handleNextEpisode}
                    disabled={!nextSource || transitioning}
                    title="Next episode (N)"
                    aria-label="Next episode"
                  >
                    <SkipForwardIcon size={16} />
                  </button>
                )}

                            {/* Mute toggle */}
                <button
                  type="button"
                  className="emb-overlay__ctrl emb-overlay__ctrl--icon"
                  onClick={() => {
                    const next = volume > 0 ? 0 : (prevVolumeRef.current || 100);
                    if (volume > 0) prevVolumeRef.current = volume;
                    setVolume(next);
                    saveVolume(next);
                  }}
                  title="Mute/unmute (M)"
                  aria-label={volume === 0 ? "Unmute" : "Mute"}
                >
                  {volume === 0
                    ? <VolumeMuteIcon size={18} />
                    : volume < 50
                      ? <VolumeMidIcon size={18} />
                      : <VolumeHighIcon size={18} />}
                </button>

                {/* Volume slider */}
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

                {/* Volume label */}
                <span className="emb-overlay__vol-label">
                  {Math.round(volume)}%
                </span>
              </div>

              {/* Right group */}
              <div className="emb-overlay__transport-right">

                {/* Subtitle track */}
                {subtitleTracks.length > 0 ? (
                  <div className="emb-overlay__track-wrap" title="Subtitles">
                    <span className="emb-overlay__track-icon">
                      <SubtitlesIcon size={14} />
                    </span>
                    <select
                      className="emb-overlay__track-select"
                      value={selectedSid}
                      onChange={handleSubtitleChange}
                      aria-label="Subtitle track"
                    >
                      <option value={-1}>Off</option>
                      {subtitleTracks.map((t, i) => (
                        <option key={t.id} value={t.id}>
                          {trackLabel(t, i)}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                {/* Audio track */}
                {audioTracks.length > 1 ? (
                  <div className="emb-overlay__track-wrap" title="Audio">
                    <span className="emb-overlay__track-icon">
                      <HeadphonesIcon size={14} />
                    </span>
                    <select
                      className="emb-overlay__track-select"
                      value={selectedAid}
                      onChange={handleAudioChange}
                      aria-label="Audio track"
                    >
                      {audioTracks.map((t, i) => (
                        <option key={t.id} value={t.id}>
                          {trackLabel(t, i)}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                {/* Source picker */}
                <button
                  type="button"
                  className={`emb-overlay__ctrl emb-overlay__ctrl--icon${sourcePanelOpen ? " is-active" : ""}`}
                  onClick={() => {
                    if (sourcePanelOpen) setSourcePanelOpen(false);
                    else void openSourcePanel();
                  }}
                  title="Change source"
                  aria-label="Source picker"
                  onMouseEnter={pinControls}
                  onMouseLeave={unpinControls}
                >
                  <SlidersIcon size={16} />
                </button>

                {/* Fullscreen */}
                {fullscreenAvailable && (
                  <button
                    type="button"
                    className="emb-overlay__ctrl emb-overlay__ctrl--icon"
                    onClick={toggleFullscreen}
                    title={isFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen (F)"}
                    aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                  >
                    {isFullscreen ? <MinimizeIcon size={16} /> : <MaximizeIcon size={16} />}
                  </button>
                )}

              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
