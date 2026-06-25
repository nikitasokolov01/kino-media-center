// Episode picker for series. Renders season tabs and an episode list, calls
// `onSelect(video)` when the user picks one. The parent component is
// responsible for translating the chosen video into a SelectedPlayableItem.
//
// Behavior:
//   - Groups videos by season. Season 0 (or undefined) is grouped under
//     "Specials" / "Other".
//   - If there is exactly one video across all seasons, auto-selects it.
//   - When the active season changes (or on first render), defaults the
//     selected episode to the first one in that season unless the parent has
//     a different selection.
//   - The currently-selected episode is highlighted.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { StremioVideo } from "../core/stremio/types.js";
import { useSettings } from "../state/SettingsContext.js";
import { pickEpisodeStill } from "../core/stremio/episodeImage.js";

interface Props {
  videos: StremioVideo[];
  selectedVideoId: string | null;
  onSelect: (video: StremioVideo) => void;
  /**
   * Optional render slot for the selected episode's sources. When provided,
   * the returned node is rendered inline inside the selected episode card
   * (instead of at the bottom of the page). Only one episode is ever expanded
   * since only one can be selected at a time.
   */
  renderSelectedSources?: () => ReactNode;
  /** Episode ids that are marked watched/completed. */
  watchedIds?: Set<string>;
  /** The next-up episode id (first unwatched) -- gets a "Next Up" badge. */
  nextUpVideoId?: string | null;
  onToggleEpisodeWatched?: (video: StremioVideo, completed: boolean) => void;
  onMarkSeasonWatched?: (videos: StremioVideo[], completed: boolean) => void;
  /**
   * When provided, each episode card gets a Play button. Called with the
   * episode video when the user clicks Play directly (bypasses expand/select).
   */
  onPlayEpisode?: (video: StremioVideo) => void;
  /**
   * Id of the episode currently being loaded via onPlayEpisode. Shows a
   * spinner/disabled state on that card's Play button to prevent double-tap.
   */
  playingEpisodeId?: string | null;
  /**
   * When set, the sources section is rendered inside this episode card (instead
   * of auto-expanding on selection). Controlled by the parent so Play-button
   * and Choose-Source paths both work.
   */
  openSourcesForVideoId?: string | null;
  /**
   * Called when the user clicks "Choose Source" / "Hide Sources" on a card.
   * Parent updates openSourcesForVideoId accordingly.
   */
  onToggleSources?: (videoId: string | null) => void;
  /** Show backdrop/poster, used as a last-resort episode still fallback. */
  showBackdrop?: string;
  /**
   * Initial season to select (e.g. from a Continue Watching deep-link). Used
   * only as the default active season on first render when no episode is
   * already selected. Falls back to the first season if it doesn't exist.
   */
  initialSeason?: number;
  /** When set, a "New Episode" badge label to show in the header. */
  newEpisodeLabel?: string;
}

type SeasonKey = number | "specials" | "other";

interface SeasonGroup {
  key: SeasonKey;
  label: string;
  videos: StremioVideo[];
}

function seasonKeyOf(v: StremioVideo): SeasonKey {
  if (typeof v.season === "number") {
    return v.season === 0 ? "specials" : v.season;
  }
  return "other";
}

function seasonScore(k: SeasonKey): number {
  if (typeof k === "number") return k;
  if (k === "specials") return 9_998;
  return 9_999;
}

function groupBySeason(videos: StremioVideo[]): SeasonGroup[] {
  const map = new Map<string, SeasonGroup>();
  for (const v of videos) {
    const k = seasonKeyOf(v);
    const id = String(k);
    let g = map.get(id);
    if (!g) {
      g = {
        key: k,
        label:
          typeof k === "number"
            ? `Season ${k}`
            : k === "specials"
              ? "Specials"
              : "Other",
        videos: [],
      };
      map.set(id, g);
    }
    g.videos.push(v);
  }
  const groups = Array.from(map.values());
  groups.sort((a, b) => seasonScore(a.key) - seasonScore(b.key));
  for (const g of groups) {
    g.videos.sort((a, b) => {
      const aEp = typeof a.episode === "number" ? a.episode : 9999;
      const bEp = typeof b.episode === "number" ? b.episode : 9999;
      return aEp - bEp;
    });
  }
  return groups;
}

function videoTitle(v: StremioVideo): string {
  return v.title ?? v.name ?? `Episode ${v.episode ?? "?"}`;
}

function videoDate(v: StremioVideo): string | null {
  const raw = v.released ?? v.releaseDate;
  if (!raw) return null;
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return String(raw);
}

function episodeLabel(v: StremioVideo): string {
  const s = typeof v.season === "number" ? `S${String(v.season).padStart(2, "0")}` : "";
  const e = typeof v.episode === "number" ? `E${String(v.episode).padStart(2, "0")}` : "";
  return s + e || "—";
}

export default function EpisodeSelector({
  videos,
  selectedVideoId,
  onSelect,
  renderSelectedSources,
  watchedIds,
  nextUpVideoId,
  onToggleEpisodeWatched,
  onMarkSeasonWatched,
  onPlayEpisode,
  playingEpisodeId,
  openSourcesForVideoId,
  onToggleSources,
  showBackdrop,
  initialSeason,
  newEpisodeLabel,
}: Props) {
  const { settings } = useSettings();
  // Spoiler blur applies to UNWATCHED episode thumbnails ONLY in episodes/all.
  const spoilerBlur =
    settings.spoilerBlurMode === "episodes" || settings.spoilerBlurMode === "all";
  const dbgLoggedRef = useRef(0);
  const groups = useMemo(() => groupBySeason(videos), [videos]);
  const watched = watchedIds ?? new Set<string>();
  const watchedCount = videos.filter((v) => watched.has(v.id)).length;

  // Auto-select when there's exactly one video across all seasons.
  useEffect(() => {
    if (videos.length === 1 && !selectedVideoId) {
      onSelect(videos[0]);
    }
    // We only want this on mount / when the video list itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videos]);

  // Active season: prefer the season containing the selected video; otherwise
  // first season group.
  const initialSeasonId = useMemo(() => {
    if (selectedVideoId) {
      for (const g of groups) {
        if (g.videos.some((v) => v.id === selectedVideoId)) {
          return String(g.key);
        }
      }
    }
    // Deep-link default: open on the requested season when it exists.
    if (typeof initialSeason === "number") {
      const g = groups.find((grp) => grp.key === initialSeason);
      if (g) return String(g.key);
    }
    return groups.length > 0 ? String(groups[0].key) : null;
  }, [groups, selectedVideoId, initialSeason]);

  const [activeSeasonId, setActiveSeasonId] = useState<string | null>(
    initialSeasonId,
  );

  // Keep activeSeasonId in sync when the underlying groups change or when the
  // selection moves into a different season (e.g. parent restored it).
  useEffect(() => {
    if (
      !activeSeasonId ||
      !groups.some((g) => String(g.key) === activeSeasonId)
    ) {
      setActiveSeasonId(initialSeasonId);
    } else if (selectedVideoId) {
      const containing = groups.find((g) =>
        g.videos.some((v) => v.id === selectedVideoId),
      );
      if (containing && String(containing.key) !== activeSeasonId) {
        setActiveSeasonId(String(containing.key));
      }
    }
  }, [groups, initialSeasonId, selectedVideoId, activeSeasonId]);

  const activeGroup = useMemo(
    () => groups.find((g) => String(g.key) === activeSeasonId) ?? null,
    [groups, activeSeasonId],
  );

  if (groups.length === 0) {
    return (
      <section className="episode-selector">
        <h2 className="episode-selector__title">Episodes</h2>
        <div className="empty">This series doesn't list any episodes yet.</div>
      </section>
    );
  }

  const activeAllWatched =
    !!activeGroup &&
    activeGroup.videos.length > 0 &&
    activeGroup.videos.every((v) => watched.has(v.id));

  return (
    <section className="episode-selector">
      <header className="episode-selector__header">
        <div className="episode-selector__title-row">
          <h2 className="episode-selector__title">Episodes</h2>
          {newEpisodeLabel && (
            <span className="episode-selector__new-badge" title="A new episode is available">
              {newEpisodeLabel}
            </span>
          )}
          {videos.length > 0 && (
            <span
              className={`episode-selector__watched-count ${
                watchedCount === videos.length ? "is-complete" : ""
              }`}
            >
              {watchedCount === videos.length
                ? "All watched"
                : `${watchedCount} / ${videos.length} watched`}
            </span>
          )}
          {activeGroup && onMarkSeasonWatched && (
            <button
              type="button"
              className="ghost-button ghost-button--xs"
              onClick={() =>
                onMarkSeasonWatched(activeGroup.videos, !activeAllWatched)
              }
            >
              {activeAllWatched ? "Mark Season Unwatched" : "Mark Season Watched"}
            </button>
          )}
        </div>
        {groups.length > 1 && (
          <div className="season-tabs" role="tablist" aria-label="Seasons">
            {groups.map((g) => {
              const id = String(g.key);
              const isActive = id === activeSeasonId;
              const seasonWatched =
                g.videos.length > 0 && g.videos.every((v) => watched.has(v.id));
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`season-tab ${isActive ? "season-tab--active" : ""}`}
                  onClick={() => setActiveSeasonId(id)}
                >
                  {seasonWatched && <span className="season-tab__check">✓</span>}
                  {g.label}
                  <span className="season-tab__count">{g.videos.length}</span>
                </button>
              );
            })}
          </div>
        )}
      </header>

      {activeGroup && (
        <ul className="episode-list">
          {activeGroup.videos.map((v) => {
            const isSelected = v.id === selectedVideoId;
            const isWatched = watched.has(v.id);
            const date = videoDate(v);
            const desc = v.description ?? v.overview;
            return (
              <li
                key={v.id}
                className={`episode-item ${isWatched ? "episode-item--watched" : ""}`}
              >
                {/* Two-column layout: thumbnail (play button) + body (select) */}
                <div className="episode-item__row">
                  {/* Thumbnail — click plays the episode */}
                  <button
                    type="button"
                    className="episode-item__thumb-btn"
                    onClick={(e) => { e.stopPropagation(); onPlayEpisode ? onPlayEpisode(v) : onSelect(v); }}
                    disabled={playingEpisodeId === v.id}
                    aria-label={`Play ${videoTitle(v)}`}
                    title={`Play ${videoTitle(v)}`}
                  >
                    <div className="episode-item__thumb">
                      {(() => {
                        const pick = pickEpisodeStill(v, { showBackdrop });
                        if (import.meta.env?.DEV && dbgLoggedRef.current < 3) {
                          dbgLoggedRef.current += 1;
                          const anyV = v as Record<string, unknown>;
                          // eslint-disable-next-line no-console
                          console.debug("[episode-still]", {
                            id: v.id, season: v.season, episode: v.episode,
                            title: v.title ?? v.name,
                            fields: {
                              thumbnail: anyV.thumbnail, still: anyV.still,
                              image: anyV.image, screenshot: anyV.screenshot,
                              poster: anyV.poster, background: anyV.background,
                            },
                            oldChosen: v.thumbnail,
                            newChosen: pick.url,
                            chosenField: pick.field,
                            wasBlurredVariant: pick.wasBlurredVariant,
                            spoilerBlurMode: settings.spoilerBlurMode,
                            cssBlurApplied: spoilerBlur && !isWatched,
                          });
                        }
                        return pick.url ? (
                          <img
                            src={pick.url}
                            alt=""
                            loading="lazy"
                            className={spoilerBlur && !isWatched ? "poster--spoiler-blurred" : undefined}
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = "none";
                            }}
                          />
                        ) : (
                          <div className="episode-item__thumb-placeholder" aria-hidden>
                            {episodeLabel(v)}
                          </div>
                        );
                      })()}
                      {/* Hover play overlay */}
                      <div className="episode-item__thumb-play" aria-hidden>
                        {playingEpisodeId === v.id ? (
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="white" stroke="none" className="episode-item__thumb-spinner">
                            <circle cx="12" cy="12" r="10" fill="none" stroke="white" strokeWidth="2.5" strokeDasharray="31.4" strokeDashoffset="10"/>
                          </svg>
                        ) : (
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="white" stroke="none">
                            <polygon points="6 4 20 12 6 20 6 4"/>
                          </svg>
                        )}
                      </div>
                    </div>
                  </button>

                  {/* Body — click selects (shows info/sources below) */}
                  <button
                    type="button"
                    className="episode-item__body-btn"
                    onClick={() => onSelect(v)}
                  >
                    <div className="episode-item__body">
                      <div className="episode-item__title-row">
                        {isWatched && (
                          <span className="episode-item__watched-check" title="Watched">
                            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <polyline points="1.5 6 4.5 9 10.5 3"/>
                            </svg>
                          </span>
                        )}
                        <span className="episode-item__num">{episodeLabel(v)}</span>
                        <span className="episode-item__title">{videoTitle(v)}</span>
                        {v.id === nextUpVideoId && (
                          <span className="episode-item__nextup-badge">Next Up</span>
                        )}
                      </div>
                      <div className="episode-item__meta muted small">
                        {date && <span>{date}</span>}
                        {v.runtime && (
                          <>
                            {date && <span className="dot">·</span>}
                            <span>{v.runtime}</span>
                          </>
                        )}
                      </div>
                      {desc && (
                        <div className="episode-item__desc muted small">
                          {String(desc)}
                        </div>
                      )}
                    </div>
                  </button>

                  {/* Compact icon action buttons — right-aligned */}
                  <div className="episode-item__actions">
                    {renderSelectedSources && onToggleSources && (
                      <button
                        type="button"
                        className={`episode-item__icon-btn${openSourcesForVideoId === v.id ? " episode-item__icon-btn--active" : ""}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelect(v);
                          onToggleSources(openSourcesForVideoId === v.id ? null : v.id);
                        }}
                        aria-label={openSourcesForVideoId === v.id ? "Hide source list" : "Choose source"}
                        title={openSourcesForVideoId === v.id ? "Hide source list" : "Choose source"}
                      >
                        {/* Stacked-layers / source-list icon */}
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polygon points="12 2 2 7 12 12 22 7 12 2"/>
                          <polyline points="2 17 12 22 22 17"/>
                          <polyline points="2 12 12 17 22 12"/>
                        </svg>
                      </button>
                    )}
                    {onToggleEpisodeWatched && (
                      <button
                        type="button"
                        className={`episode-item__icon-btn${isWatched ? " episode-item__icon-btn--watched" : ""}`}
                        onClick={(e) => { e.stopPropagation(); onToggleEpisodeWatched(v, !isWatched); }}
                        aria-label={isWatched ? "Mark as unwatched" : "Mark as watched"}
                        title={isWatched ? "Mark as unwatched" : "Mark as watched"}
                      >
                        {isWatched ? (
                          /* Filled check-circle */
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <circle cx="12" cy="12" r="10" fill="currentColor" fillOpacity="0.15"/>
                            <polyline points="9 12 11 14 15 10" strokeWidth="2.2"/>
                            <circle cx="12" cy="12" r="10"/>
                          </svg>
                        ) : (
                          /* Empty circle */
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <circle cx="12" cy="12" r="10"/>
                          </svg>
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {openSourcesForVideoId === v.id && renderSelectedSources && (
                  <div className="episode-item__sources">
                    {renderSelectedSources()}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
