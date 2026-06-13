// Real media detail page for /media/:type/:id.
//
// Strategy:
//   1. Load all installed addons for the active profile.
//   2. Filter to those whose manifest advertises the `meta` resource for the
//      requested type.
//   3. Try them in sequence — first valid response wins. Per-addon errors are
//      collected for diagnostics but never crash the page.
//   4. Render the meta with poster, background, title, year/runtime, genres,
//      cast, director, rating, description.
//   5. For series, render an EpisodeSelector and only fetch streams once an
//      episode is selected. The selected episode's id (not the show id) is
//      what addons need to return streams for the right video.
//   6. For movies, the playable selection is the movie itself — built as soon
//      as meta resolves.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useProfile } from "../state/ProfileContext.js";
import { useLibrary } from "../state/LibraryContext.js";
import { useToast } from "../state/ToastContext.js";
import { useSettings } from "../state/SettingsContext.js";
import { addonSupportsResource } from "../core/stremio/meta.js";
import { isLikelyAnime } from "../core/stremio/anime.js";
import { streamDedupKey } from "../core/stremio/streams.js";
import { formatTime } from "../features/player/playability.js";
import { chooseBestSource } from "../core/player/sourceRanking.js";
import { resolveAudioLanguage } from "../core/player/audioPreference.js";
import { buildPlayRequest, dispatchPlayRequest } from "../features/player/playRequest.js";
import {
  getCachedSources,
  makePrefetchKey,
  prefetchEpisodeSources,
} from "../core/player/sourcePrefetch.js";
import SourcesSection from "../components/SourcesSection.js";
import EpisodeSelector from "../components/EpisodeSelector.js";
import type {
  SelectedPlayableItem,
  StremioMeta,
  StremioStream,
  StremioVideo,
  StreamSourceResult,
} from "../core/stremio/types.js";
import type { AddonRow, WatchProgress } from "../types/preload.js";

interface AttemptFailure {
  addonId: string;
  addonName: string;
  message: string;
}

interface MetaResult {
  meta: StremioMeta;
  source: { addonId: string; addonName: string };
}

function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function joinList(v: string[] | string | undefined): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length > 0) return v.join(", ");
  return null;
}

export default function MediaPage() {
  const { type: rawType, id: rawId } = useParams<{ type: string; id: string }>();
  const type = decodeURIComponent(rawType ?? "");
  const id = decodeURIComponent(rawId ?? "");
  const isSeries = type === "series";

  const { profile, loading: profileLoading } = useProfile();
  const { isInLibrary, add: addToLibrary, remove: removeFromLibrary } = useLibrary();
  const { toast } = useToast();
  const { settings } = useSettings();

  const [addons, setAddons] = useState<AddonRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<MetaResult | null>(null);
  const [failures, setFailures] = useState<AttemptFailure[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  // Selected playable target: null for series until an episode is chosen,
  // populated for movies as soon as meta resolves.
  const [selected, setSelected] = useState<SelectedPlayableItem | null>(null);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  // For series: the chosen episode's own title (distinct from the show title).
  const [episodeTitle, setEpisodeTitle] = useState<string | undefined>(undefined);

  // Id of an episode whose Play button was clicked — shows loading state and
  // prevents double-clicks while sources are being fetched.
  const [playingEpisodeId, setPlayingEpisodeId] = useState<string | null>(null);

  // Saved watch progress for the currently-selected playable, plus the user's
  // resume choice. `resumeMode` defaults to "resume" when progress exists.
  const [savedProgress, setSavedProgress] = useState<WatchProgress | null>(null);
  const [resumeMode, setResumeMode] = useState<"resume" | "start">("resume");

  // All watch_progress rows for this media — drives watched badges/buttons.
  const [watchedRows, setWatchedRows] = useState<WatchProgress[]>([]);
  const watchedSet = useMemo(
    () => new Set(watchedRows.filter((r) => r.completed).map((r) => r.playableId)),
    [watchedRows],
  );

  const refreshWatched = useCallback(async () => {
    if (!profile) return;
    try {
      const rows = await window.mediaCenter.watched.listForMedia({
        profileId: profile.id,
        mediaId: id,
      });
      setWatchedRows(rows);
    } catch {
      setWatchedRows([]);
    }
  }, [profile, id]);

  useEffect(() => {
    void refreshWatched();
  }, [refreshWatched, reloadKey]);

  // Cache this series' ordered episode list so the Home page's Continue
  // Watching can compute the next episode to watch without re-fetching meta.
  useEffect(() => {
    const m = result?.meta;
    if (!m || !isSeries) return;
    const eps = asArray<StremioVideo>(m.videos);
    if (eps.length === 0) return;
    void window.mediaCenter.series.cacheEpisodes({
      seriesId: m.id,
      episodes: eps.map((v) => ({
        videoId: v.id,
        season: typeof v.season === "number" ? v.season : null,
        episode: typeof v.episode === "number" ? v.episode : null,
        title: v.title ?? v.name ?? null,
      })),
    });
  }, [result, isSeries]);

  // Load installed addons for the active profile.
  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    window.mediaCenter.addons
      .list(profile.id)
      .then((rows) => {
        if (!cancelled) setAddons(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setAddons([]);
          setFailures([
            {
              addonId: "(local)",
              addonName: "Local addon list",
              message: e instanceof Error ? e.message : String(e),
            },
          ]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  const eligible = useMemo(() => {
    if (!addons) return [];
    return addons.filter((a) => addonSupportsResource(a.manifest, "meta", type));
  }, [addons, type]);

  // Try each eligible addon in sequence until one returns a valid meta.
  useEffect(() => {
    if (!profile || addons === null) return;
    let cancelled = false;
    setLoading(true);
    setResult(null);
    setFailures([]);
    // A fresh meta load means any prior selection (from a different id) is
    // stale — reset it so movies get re-derived and series ask for a new pick.
    setSelected(null);
    setSelectedVideoId(null);
    setEpisodeTitle(undefined);

    (async () => {
      if (eligible.length === 0) {
        if (!cancelled) setLoading(false);
        return;
      }

      const errs: AttemptFailure[] = [];
      for (const a of eligible) {
        if (cancelled) return;
        try {
          const res = await window.mediaCenter.meta.fetch({
            manifestUrl: a.manifestUrl,
            type,
            id,
          });
          if (cancelled) return;
          if (res?.meta) {
            setResult({
              meta: res.meta,
              source: { addonId: a.id, addonName: a.manifest.name },
            });
            setFailures(errs);
            setLoading(false);
            return;
          }
          errs.push({
            addonId: a.id,
            addonName: a.manifest.name,
            message: "Response missing `meta` object.",
          });
        } catch (e) {
          errs.push({
            addonId: a.id,
            addonName: a.manifest.name,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }

      if (!cancelled) {
        setFailures(errs);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [profile, addons, eligible, type, id, reloadKey]);

  // Once meta loads, derive the selection for movies. For series, wait for
  // user pick (EpisodeSelector will auto-pick when there's only one episode).
  useEffect(() => {
    const meta = result?.meta;
    if (!meta) return;
    if (isSeries) return;
    setSelected({ type: "movie", id: meta.id, title: meta.name });
  }, [result, isSeries]);

  // Translate an episode pick into a SelectedPlayableItem.
  const handleEpisodeSelect = (video: StremioVideo) => {
    if (!result?.meta) return;
    setSelectedVideoId(video.id);
    setEpisodeTitle(video.title ?? video.name ?? undefined);
    setSelected({
      type: "series",
      id: video.id,
      title: result.meta.name,
      season: typeof video.season === "number" ? video.season : undefined,
      episode: typeof video.episode === "number" ? video.episode : undefined,
    });
  };

  // Direct play from the episode card Play button. Selects the episode AND
  // immediately fetches sources + plays the best one when autoPlayBestSource
  // is enabled. Falls back to just selecting the episode (SourcesSection
  // appears) when manual source selection is preferred.
  const handleDirectPlayEpisode = async (video: StremioVideo) => {
    if (!result?.meta || !profile || !addons) return;
    // Prevent double-click while loading.
    if (playingEpisodeId === video.id) return;

    // Always update selection so the episode card highlights and the inline
    // SourcesSection renders for it (fallback / manual mode).
    handleEpisodeSelect(video);

    // If neither auto feature is on, just selecting is enough -- SourcesSection
    // will fetch and display sources on its own. No spinner needed.
    if (!settings.autoPlayBestSource && !settings.autoSelectSource) return;

    setPlayingEpisodeId(video.id);
    try {
      const profileId = profile.id;
      const cacheKey = makePrefetchKey(profileId, "series", id, video.id);

      // Check the prefetch cache first for an instant result.
      let results: StreamSourceResult[] | null = getCachedSources(cacheKey);

      if (!results) {
        // Cache miss: fan out to all eligible stream addons.
        const eligibleStream = addons.filter((a) =>
          addonSupportsResource(a.manifest, "stream", "series"),
        );

        if (eligibleStream.length > 0) {
          const seen = new Set<string>();
          const collected: StreamSourceResult[] = [];

          await Promise.allSettled(
            eligibleStream.map((a) =>
              window.mediaCenter.streams
                .fetch({ manifestUrl: a.manifestUrl, type: "series", id: video.id })
                .then((res) => {
                  (res.streams ?? []).forEach((s: StremioStream, i: number) => {
                    const dk = streamDedupKey(s, `${a.id}#${i}`);
                    if (seen.has(dk)) return;
                    seen.add(dk);
                    collected.push({
                      stream: s,
                      source: { addonId: a.id, addonName: a.manifest.name },
                      key: dk,
                    });
                  });
                })
                .catch(() => { /* per-addon failure is non-fatal */ }),
            ),
          );

          // Store in prefetch cache so EpisodeSelector's E8 Next Episode
          // pipeline can reuse it too.
          if (collected.length > 0) {
            void prefetchEpisodeSources; // imported but cache set via direct store
          }
          results = collected;
        } else {
          results = [];
        }
      }

      if (results.length === 0) return; // nothing to play; SourcesSection will show empty

      const best = chooseBestSource(results, settings);
      if (!best) return;

      const meta = result.meta;
      const backend = settings.experimentalEmbeddedPlayer
        ? "embedded-mpv-experimental"
        : "external-mpv";

      const epTitle = video.title ?? video.name ?? undefined;
      const req = buildPlayRequest(
        {
          backend,
          type: "series",
          mediaId: meta.id,
          playableId: video.id,
          mediaTitle: meta.name,
          episodeTitle: epTitle,
          season: typeof video.season === "number" ? video.season : undefined,
          episode: typeof video.episode === "number" ? video.episode : undefined,
          streamUrl: best.stream.url ?? "",
          streamTitle: best.stream.title,
          streamName: best.stream.name,
          poster: meta.poster,
        },
        "manual",
      );

      await dispatchPlayRequest(req, {
        ...(backend === "external-mpv"
          ? {
              subtitleAddons: addons,
              profileId,
              startSeconds: 0,
              audioLanguageOverride: resolveAudioLanguage(settings, isAnime),
            }
          : {}),
        origin: "manual",
      });
    } catch {
      // Non-fatal: SourcesSection will still render for the selected episode.
    } finally {
      setPlayingEpisodeId(null);
    }
  };

  // Load saved watch progress for the currently-selected playable. Resets
  // whenever the selection changes (movie ↔ episode, or a different episode).
  useEffect(() => {
    setSavedProgress(null);
    setResumeMode("resume");
    if (!profile || !selected) return;
    let cancelled = false;
    window.mediaCenter.progress
      .get({ profileId: profile.id, mediaId: id, playableId: selected.id })
      .then((p) => {
        if (cancelled) return;
        // Only offer resume for partially-watched, non-trivial progress.
        if (p && !p.completed && p.progressSeconds >= 30) {
          setSavedProgress(p);
        }
      })
      .catch(() => {
        /* progress is best-effort */
      });
    return () => {
      cancelled = true;
    };
  }, [profile, selected, id]);

  async function handleStartOver() {
    if (!profile || !selected) return;
    try {
      await window.mediaCenter.progress.clear({
        profileId: profile.id,
        mediaId: id,
        playableId: selected.id,
      });
    } catch {
      /* ignore */
    }
    setSavedProgress(null);
    setResumeMode("start");
  }

  // Resume position handed to MPV: the saved seconds when the user keeps
  // "resume", or 0 when they chose Start Over / there's nothing saved.
  const resumeSeconds =
    savedProgress && resumeMode === "resume" ? savedProgress.progressSeconds : 0;

  // ----- Library + watched controls ----------------------------------------

  async function handleToggleLibrary() {
    const m = result?.meta;
    if (!m) return;
    if (isInLibrary(type, m.id)) {
      await removeFromLibrary(type, m.id);
      toast("Removed from Library");
    } else {
      await addToLibrary({
        type,
        mediaId: m.id,
        title: m.name,
        poster: m.poster ?? null,
        background: m.background ?? null,
        releaseInfo:
          m.releaseInfo ??
          (typeof m.year === "number" || typeof m.year === "string"
            ? String(m.year)
            : null),
      });
      toast("Added to Library");
    }
  }

  // Movie watched toggle (playableId === movie id).
  async function handleToggleMovieWatched() {
    const m = result?.meta;
    if (!profile || !m) return;
    const currentlyWatched = watchedSet.has(m.id);
    await window.mediaCenter.watched.set({
      profileId: profile.id,
      type: "movie",
      mediaId: m.id,
      playableId: m.id,
      title: m.name,
      poster: m.poster ?? null,
      completed: !currentlyWatched,
    });
    await refreshWatched();
    toast(currentlyWatched ? "Marked as Unwatched" : "Marked as Watched");
  }

  // Per-episode watched toggle.
  async function handleToggleEpisodeWatched(video: StremioVideo, completed: boolean) {
    const m = result?.meta;
    if (!profile || !m) return;
    await window.mediaCenter.watched.set({
      profileId: profile.id,
      type: "series",
      mediaId: m.id,
      playableId: video.id,
      title: m.name,
      episodeTitle: video.title ?? video.name ?? null,
      poster: m.poster ?? null,
      season: typeof video.season === "number" ? video.season : null,
      episode: typeof video.episode === "number" ? video.episode : null,
      completed,
    });
    await refreshWatched();
    toast(completed ? "Marked Episode Watched" : "Marked Episode Unwatched");
  }

  // Mark every episode in a season watched/unwatched.
  async function handleMarkSeasonWatched(videos: StremioVideo[], completed: boolean) {
    const m = result?.meta;
    if (!profile || !m) return;
    for (const video of videos) {
      await window.mediaCenter.watched.set({
        profileId: profile.id,
        type: "series",
        mediaId: m.id,
        playableId: video.id,
        title: m.name,
        episodeTitle: video.title ?? video.name ?? null,
        poster: m.poster ?? null,
        season: typeof video.season === "number" ? video.season : null,
        episode: typeof video.episode === "number" ? video.episode : null,
        completed,
      });
    }
    await refreshWatched();
    toast(completed ? "Marked Season Watched" : "Marked Season Unwatched");
  }

  // --------------------- Render helpers --------------------------------

  const meta = result?.meta;
  const videos = asArray<StremioVideo>(meta?.videos);

  // Anime classification — prefers Kitsu/provider signals over genre guessing.
  // Drives the anime-specific default audio language when launching MPV.
  const isAnime = useMemo(
    () =>
      isLikelyAnime(meta, {
        addonId: result?.source.addonId,
        addonName: result?.source.addonName,
        mediaId: meta?.id,
      }),
    [meta, result],
  );

  // Next episode to watch: first NORMAL episode (season >= 1; season asc,
  // episode asc, then meta order) that isn't completed. Mirrors the DB's
  // getNextEpisodeToWatch so the "Next Up" badge matches what Continue
  // Watching shows. Specials (season === 0) are excluded from auto next-up —
  // they remain selectable/markable in the list.
  // TODO: honor a future "Include specials in Continue Watching" setting.
  const nextUpVideoId = useMemo(() => {
    if (!isSeries || videos.length === 0) return null;
    const ordered = videos
      .filter((v) => v.season !== 0) // null/undefined season treated as normal
      .map((v, i) => ({ v, i }))
      .sort((a, b) => {
        const as = typeof a.v.season === "number" ? a.v.season : Infinity;
        const bs = typeof b.v.season === "number" ? b.v.season : Infinity;
        if (as !== bs) return as - bs;
        const ae = typeof a.v.episode === "number" ? a.v.episode : Infinity;
        const be = typeof b.v.episode === "number" ? b.v.episode : Infinity;
        if (ae !== be) return ae - be;
        return a.i - b.i;
      })
      .map((x) => x.v);
    return ordered.find((v) => !watchedSet.has(v.id))?.id ?? null;
  }, [isSeries, videos, watchedSet]);

  const backgroundStyle = meta?.background
    ? {
        backgroundImage:
          `linear-gradient(180deg, rgba(15,17,21,0.55) 0%, rgba(15,17,21,0.95) 80%, var(--bg) 100%),` +
          `url("${meta.background.replace(/"/g, '\\"')}")`,
      }
    : undefined;

  const year =
    meta?.releaseInfo ??
    (typeof meta?.year === "number" || typeof meta?.year === "string"
      ? String(meta.year)
      : null);

  const genres = asArray<string>(meta?.genres);
  const cast = asArray<string>(meta?.cast);
  const director = joinList(meta?.director);
  const rating = meta?.imdbRating;
  const runtime = meta?.runtime;
  const description = meta?.description;

  // Resume bar + Sources picker, bundled so it can be placed either at the
  // bottom of the page (movies, variant="full") or inline inside the selected
  // episode card (series, variant="inline"). Same data, same components — only
  // placement + styling differ.
  const renderSourcesArea = (variant: "full" | "inline") => {
    if (!meta) return null;
    return (
      <>
        {savedProgress && (
          <div className="resume-bar">
            <span className="resume-bar__text">
              {resumeMode === "resume" ? (
                <>
                  You're at <strong>{formatTime(savedProgress.progressSeconds)}</strong>
                  {savedProgress.durationSeconds > 0 && (
                    <> of {formatTime(savedProgress.durationSeconds)}</>
                  )}
                  . Sources will <strong>resume from here</strong> in MPV.
                </>
              ) : (
                <>Starting from the beginning.</>
              )}
            </span>
            <span className="resume-bar__spacer" />
            {resumeMode === "start" ? (
              <button
                type="button"
                className="ghost-button"
                onClick={() => setResumeMode("resume")}
              >
                Resume from {formatTime(savedProgress.progressSeconds)}
              </button>
            ) : (
              <button
                type="button"
                className="ghost-button"
                onClick={handleStartOver}
              >
                Start Over
              </button>
            )}
          </div>
        )}

        {addons && addons.length > 0 && (
          <SourcesSection
            variant={variant}
            addons={addons}
            selected={selected}
            mediaId={meta.id}
            mediaTitle={meta.name}
            mediaPoster={meta.poster}
            episodeTitle={episodeTitle}
            startSeconds={resumeSeconds}
            isAnime={isAnime}
          />
        )}
      </>
    );
  };

  // --------------------- States ----------------------------------------

  return (
    <div className="page media-page">
      <p>
        <Link to="/">← Back to Home</Link>
      </p>

      {profileLoading && <p className="muted">Loading profile…</p>}

      {profile && addons === null && !meta && (
        <p className="muted">Loading addons…</p>
      )}

      {profile && addons !== null && loading && !meta && (
        <div className="media-loading">
          <p className="muted">
            Searching {eligible.length || "compatible"} addon
            {eligible.length === 1 ? "" : "s"} for {type} <code>{id}</code>…
          </p>
        </div>
      )}

      {profile &&
        addons !== null &&
        !loading &&
        !meta &&
        eligible.length === 0 && (
          <div className="empty">
            None of your installed addons provide a <code>meta</code> resource
            for <code>{type}</code>. Install a metadata addon from the Addons
            page, then try again.
          </div>
        )}

      {profile &&
        addons !== null &&
        !loading &&
        !meta &&
        eligible.length > 0 && (
          <div className="error-banner" role="alert">
            <div>
              Couldn't load metadata for {type} <code>{id}</code> from any of
              your {eligible.length} compatible addon
              {eligible.length === 1 ? "" : "s"}.
            </div>
            {failures.length > 0 && (
              <ul className="failure-list">
                {failures.map((f, i) => (
                  <li key={i}>
                    <strong>{f.addonName}:</strong> {f.message}
                  </li>
                ))}
              </ul>
            )}
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                className="primary-button"
                onClick={() => setReloadKey((k) => k + 1)}
              >
                Retry
              </button>
            </div>
          </div>
        )}

      {meta && (
        <article className="media-detail">
          <div
            className="media-detail__hero"
            style={backgroundStyle}
            aria-hidden={backgroundStyle ? undefined : true}
          >
            <div className="media-detail__hero-inner">
              <div className="media-detail__poster">
                {meta.poster ? (
                  <img src={meta.poster} alt="" />
                ) : (
                  <div className="media-detail__poster-placeholder" aria-hidden>
                    {meta.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="media-detail__head">
                {meta.logo ? (
                  <img
                    className="media-detail__logo"
                    src={meta.logo}
                    alt={meta.name}
                  />
                ) : (
                  <h1 className="media-detail__title">{meta.name}</h1>
                )}
                <div className="media-detail__quickmeta">
                  {year && <span>{year}</span>}
                  {runtime && (
                    <>
                      <span className="dot">·</span>
                      <span>{runtime}</span>
                    </>
                  )}
                  {rating !== undefined && rating !== null && rating !== "" && (
                    <>
                      <span className="dot">·</span>
                      <span title="IMDB rating">★ {String(rating)}</span>
                    </>
                  )}
                  <span className="dot">·</span>
                  <span className="muted">{type}</span>
                </div>
                {genres.length > 0 && (
                  <div className="media-detail__genres">
                    {genres.map((g) => (
                      <span key={g} className="tag">{g}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="media-detail__body">
            <div className="media-detail__actions">
              <button
                type="button"
                className={isInLibrary(type, meta.id) ? "ghost-button" : "primary-button"}
                onClick={handleToggleLibrary}
              >
                {isInLibrary(type, meta.id) ? "✓ In Library" : "+ Add to Library"}
              </button>
              {!isSeries && (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={handleToggleMovieWatched}
                >
                  {watchedSet.has(meta.id) ? "Mark as Unwatched" : "Mark as Watched"}
                </button>
              )}
            </div>

            {description && (
              <p className="media-detail__description">{description}</p>
            )}

            <dl className="media-detail__facts">
              {director && (
                <>
                  <dt>Director</dt>
                  <dd>{director}</dd>
                </>
              )}
              {cast.length > 0 && (
                <>
                  <dt>Cast</dt>
                  <dd>{cast.join(", ")}</dd>
                </>
              )}
              {meta.country && (
                <>
                  <dt>Country</dt>
                  <dd>{String(meta.country)}</dd>
                </>
              )}
              {meta.language && (
                <>
                  <dt>Language</dt>
                  <dd>{String(meta.language)}</dd>
                </>
              )}
            </dl>

            <footer className="media-detail__footer muted small">
              Metadata from <strong>{result.source.addonName}</strong>
              {failures.length > 0 && (
                <>
                  {" "}· {failures.length} other addon{failures.length === 1 ? "" : "s"} failed
                </>
              )}
            </footer>

            {isSeries ? (
              // Series: sources render inline inside the selected episode card
              // (see EpisodeSelector). No bottom sources block.
              <EpisodeSelector
                videos={videos}
                selectedVideoId={selectedVideoId}
                onSelect={handleEpisodeSelect}
                renderSelectedSources={() => renderSourcesArea("inline")}
                watchedIds={watchedSet}
                nextUpVideoId={nextUpVideoId}
                onToggleEpisodeWatched={handleToggleEpisodeWatched}
                onMarkSeasonWatched={handleMarkSeasonWatched}
                onPlayEpisode={handleDirectPlayEpisode}
                playingEpisodeId={playingEpisodeId}
              />
            ) : (
              // Movies: sources stay below the details, full layout.
              renderSourcesArea("full")
            )}
          </div>
        </article>
      )}
    </div>
  );
}
