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
}: Props) {
  const groups = useMemo(() => groupBySeason(videos), [videos]);
  const watched = watchedIds ?? new Set<string>();
  const watchedCount = videos.filter((v) => watched.has(v.id)).length;

  // The selected episode's <li>, so we can keep its expanded sources visible
  // without jumping to the bottom of the page.
  const selectedRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (!selectedVideoId) return;
    // Wait a tick so the expanded sources area has been laid out, then nudge
    // the episode into view with block:"nearest" (scrolls the minimum amount).
    const id = window.setTimeout(() => {
      selectedRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
    return () => window.clearTimeout(id);
  }, [selectedVideoId]);

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
    return groups.length > 0 ? String(groups[0].key) : null;
  }, [groups, selectedVideoId]);

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
                ref={isSelected ? selectedRef : null}
                className={`episode-item ${isSelected ? "episode-item--selected" : ""} ${isWatched ? "episode-item--watched" : ""}`}
              >
                <button
                  type="button"
                  className="episode-item__btn"
                  onClick={() => onSelect(v)}
                  aria-pressed={isSelected}
                >
                  <div className="episode-item__thumb">
                    {v.thumbnail ? (
                      <img
                        src={v.thumbnail}
                        alt=""
                        loading="lazy"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display =
                            "none";
                        }}
                      />
                    ) : (
                      <div className="episode-item__thumb-placeholder" aria-hidden>
                        {episodeLabel(v)}
                      </div>
                    )}
                  </div>
                  <div className="episode-item__body">
                    <div className="episode-item__title-row">
                      {isWatched && (
                        <span className="episode-item__watched-check" title="Watched">
                          ✓
                        </span>
                      )}
                      <span className="episode-item__num">{episodeLabel(v)}</span>
                      <span className="episode-item__title">{videoTitle(v)}</span>
                      {v.id === nextUpVideoId && !isSelected && (
                        <span className="episode-item__nextup-badge">Next Up</span>
                      )}
                      {isSelected && (
                        <span className="episode-item__selected-badge">
                          Selected
                        </span>
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

                <div className="episode-item__actions">
                  {onPlayEpisode && (
                    <button
                      type="button"
                      className={`episode-item__play-btn${playingEpisodeId === v.id ? " episode-item__play-btn--loading" : ""}`}
                      onClick={(e) => { e.stopPropagation(); onPlayEpisode(v); }}
                      disabled={playingEpisodeId === v.id}
                      title={`Play ${videoTitle(v)}`}
                      aria-label={`Play ${videoTitle(v)}`}
                    >
                      {playingEpisodeId === v.id ? (
                        <span className="episode-item__play-spinner" aria-hidden>...</span>
                      ) : (
                        <span aria-hidden>&#9654;</span>
                      )}
                      {playingEpisodeId === v.id ? "Loading" : "Play"}
                    </button>
                  )}
                  {onToggleEpisodeWatched && (
                    <button
                      type="button"
                      className="ghost-button ghost-button--xs"
                      onClick={() => onToggleEpisodeWatched(v, !isWatched)}
                    >
                      {isWatched ? "Mark Episode Unwatched" : "Mark Episode Watched"}
                    </button>
                  )}
                </div>

                {isSelected && renderSelectedSources && (
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
