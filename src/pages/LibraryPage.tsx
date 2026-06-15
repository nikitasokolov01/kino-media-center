// /library -- the active profile's saved movies & series.
//
// Library rows are stored locally (title/poster/releaseInfo) so the grid
// renders without re-fetching metadata. Badges:
//   - Movies: Watched / In Progress / Unwatched from watch_progress.
//   - Series: WATCHED only when every NORMAL episode (season > 0) is watched,
//     else WATCHING (with a "Next: SxEy" label), else Not Started. Computed by
//     the main process via getSeriesLibraryStatus using the cached episode
//     list -- a series is never "watched" without that data. Specials ignored.
//
// Filters: All / Movies / Series / Watched / Unwatched / In Progress
// Sort:    Recently Added / Alphabetical / Release Year

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useProfile } from "../state/ProfileContext.js";
import { useLibrary } from "../state/LibraryContext.js";
import { useContextMenu } from "../state/ContextMenuContext.js";
import { useToast } from "../state/ToastContext.js";
import type { LibraryItem, WatchProgress } from "../types/preload.js";

type BadgeClass = "watched" | "in-progress" | "unwatched";

interface ItemBadge {
  className: BadgeClass;
  label: string;
  nextLabel?: string;
}

type FilterId =
  | "all"
  | "movies"
  | "series"
  | "watched"
  | "unwatched"
  | "in-progress";

type SortId = "added" | "alpha" | "year";

const FILTERS: { id: FilterId; label: string }[] = [
  { id: "all",         label: "All" },
  { id: "movies",      label: "Movies" },
  { id: "series",      label: "Series" },
  { id: "watched",     label: "Watched" },
  { id: "in-progress", label: "In Progress" },
  { id: "unwatched",   label: "Unwatched" },
];

const SORTS: { id: SortId; label: string }[] = [
  { id: "added", label: "Recently Added" },
  { id: "alpha", label: "A-Z" },
  { id: "year",  label: "Release Year" },
];

function movieBadge(rows: WatchProgress[]): ItemBadge {
  const r = rows[0];
  if (r?.completed) return { className: "watched", label: "Watched" };
  if (r && r.progressSeconds >= 30)
    return { className: "in-progress", label: "In Progress" };
  return { className: "unwatched", label: "Unwatched" };
}

function epLabel(ep?: {
  season?: number | null;
  episode?: number | null;
}): string | undefined {
  if (!ep) return undefined;
  if (typeof ep.season === "number" && typeof ep.episode === "number") {
    return `S${ep.season}E${ep.episode}`;
  }
  return undefined;
}

function releaseYear(item: LibraryItem): number {
  if (!item.releaseInfo) return 0;
  const m = item.releaseInfo.match(/\d{4}/);
  return m ? parseInt(m[0], 10) : 0;
}

export default function LibraryPage() {
  const { profile } = useProfile();
  const { items, loading, remove } = useLibrary();
  const { openContextMenu } = useContextMenu();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [badges, setBadges] = useState<Record<string, ItemBadge>>({});
  const [filter, setFilter] = useState<FilterId>("all");
  const [sort, setSort] = useState<SortId>("added");
  const [search, setSearch] = useState("");

  const itemsKey = useMemo(
    () => items.map((i) => `${i.type}:${i.mediaId}`).join("|"),
    [items],
  );

  // Derive a badge per item.
  useEffect(() => {
    if (!profile || items.length === 0) {
      setBadges({});
      return;
    }
    let cancelled = false;
    Promise.all(
      items.map(async (it) => {
        const key = `${it.type}:${it.mediaId}`;
        try {
          if (it.type === "series") {
            const st = await window.mediaCenter.series.libraryStatus({
              profileId: profile.id,
              mediaId: it.mediaId,
            });
            let badge: ItemBadge;
            if (st.status === "watched") {
              badge = { className: "watched", label: "Watched" };
            } else if (st.status === "watching") {
              const next = epLabel(st.nextEpisode);
              const up = epLabel(st.lastWatchedEpisode);
              badge = {
                className: "in-progress",
                label: "Watching",
                nextLabel: next
                  ? `Next: ${next}`
                  : up
                    ? `Up to: ${up}`
                    : undefined,
              };
            } else {
              badge = { className: "unwatched", label: "Not Started" };
            }
            return [key, badge] as const;
          }
          // Movie
          const rows = await window.mediaCenter.watched.listForMedia({
            profileId: profile.id,
            mediaId: it.mediaId,
          });
          return [key, movieBadge(rows)] as const;
        } catch {
          return [key, { className: "unwatched", label: "Unwatched" } as ItemBadge] as const;
        }
      }),
    ).then((pairs) => {
      if (cancelled) return;
      setBadges(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [profile, itemsKey, items]);

  function openMenu(e: React.MouseEvent, it: LibraryItem) {
    e.preventDefault();
    e.stopPropagation();
    const to = `/media/${encodeURIComponent(it.type)}/${encodeURIComponent(it.mediaId)}`;
    openContextMenu(e.clientX, e.clientY, [
      { label: "Open Details", onSelect: () => navigate(to) },
      {
        label: "Remove from Library",
        danger: true,
        onSelect: async () => {
          await remove(it.type, it.mediaId);
          toast("Removed from Library");
        },
      },
    ]);
  }

  // Apply filter, search, and sort.
  const visible = useMemo(() => {
    let list = [...items];

    // Type filter
    if (filter === "movies") list = list.filter((i) => i.type === "movie");
    else if (filter === "series") list = list.filter((i) => i.type === "series");

    // Watch-state filter (uses derived badges)
    if (filter === "watched") {
      list = list.filter((i) => badges[`${i.type}:${i.mediaId}`]?.className === "watched");
    } else if (filter === "unwatched") {
      list = list.filter((i) => badges[`${i.type}:${i.mediaId}`]?.className === "unwatched");
    } else if (filter === "in-progress") {
      list = list.filter((i) => badges[`${i.type}:${i.mediaId}`]?.className === "in-progress");
    }

    // Search
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((i) => i.title.toLowerCase().includes(q));
    }

    // Sort
    if (sort === "added") {
      list.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    } else if (sort === "alpha") {
      list.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sort === "year") {
      list.sort((a, b) => releaseYear(b) - releaseYear(a));
    }

    return list;
  }, [items, badges, filter, sort, search]);

  const activeFilterCount =
    filter !== "all" ? visible.length : items.length;

  return (
    <div className="page">
      <div className="library-page-header">
        <h1 className="library-page-header__title">
          Library
          {items.length > 0 && (
            <span className="library-page-header__count">{activeFilterCount}</span>
          )}
        </h1>
      </div>

      {loading && <p className="muted">Loading...</p>}

      {!loading && items.length === 0 && (
        <div className="empty">Your library is empty.</div>
      )}

      {items.length > 0 && (
        <>
          {/* Filter + search bar */}
          <div className="library-controls">
            <div className="library-filter-tabs" role="tablist" aria-label="Filter library">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === f.id}
                  className={"library-filter-tab" + (filter === f.id ? " library-filter-tab--active" : "")}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="library-controls-right">
              <input
                type="search"
                className="library-search-input"
                placeholder="Search library..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search library"
              />
              <select
                className="library-sort-select"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortId)}
                aria-label="Sort library"
              >
                {SORTS.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="empty">
              {search.trim()
                ? `No results for "${search}".`
                : `No ${filter === "all" ? "items" : filter} found.`}
            </div>
          ) : (
            <div className="poster-grid">
              {visible.map((it) => {
                const to = `/media/${encodeURIComponent(it.type)}/${encodeURIComponent(it.mediaId)}`;
                const badge: ItemBadge =
                  badges[`${it.type}:${it.mediaId}`] ?? {
                    className: "unwatched",
                    label: it.type === "series" ? "Not Started" : "Unwatched",
                  };
                return (
                  <div
                    key={`${it.type}:${it.mediaId}`}
                    className="catalog-item"
                    title={it.title}
                    onClick={() => navigate(to)}
                    onContextMenu={(e) => openMenu(e, it)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") navigate(to);
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <div className="catalog-item__poster-wrap">
                      {it.poster ? (
                        <img
                          className="catalog-item__poster"
                          src={it.poster}
                          alt=""
                          loading="lazy"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = "none";
                          }}
                        />
                      ) : (
                        <div className="catalog-item__poster catalog-item__poster--placeholder" aria-hidden>
                          {it.title.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div className={`lib-badge lib-badge--${badge.className}`}>
                        {badge.label}
                      </div>
                    </div>
                    <div className="catalog-item__title">{it.title}</div>
                    <div className="catalog-item__year">
                      <span className="lib-type">{it.type}</span>
                      {it.releaseInfo && <> {it.releaseInfo}</>}
                    </div>
                    {badge.nextLabel && (
                      <div className="lib-next">{badge.nextLabel}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
