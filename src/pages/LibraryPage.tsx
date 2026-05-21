// /library — the active profile's saved movies & series.
//
// Library rows are stored locally (title/poster/releaseInfo) so the grid
// renders without re-fetching metadata. Badges:
//   - Movies: Watched / In Progress / Unwatched from watch_progress.
//   - Series: WATCHED only when every NORMAL episode (season > 0) is watched,
//     else WATCHING (with a "Next: SxEy" label), else Not Started. Computed by
//     the main process via getSeriesLibraryStatus using the cached episode
//     list — a series is never "watched" without that data. Specials ignored.

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

export default function LibraryPage() {
  const { profile } = useProfile();
  const { items, loading, remove } = useLibrary();
  const { openContextMenu } = useContextMenu();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [badges, setBadges] = useState<Record<string, ItemBadge>>({});

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

  return (
    <div className="page">
      <h1>Library</h1>

      {loading && <p className="muted">Loading…</p>}

      {!loading && items.length === 0 && (
        <div className="empty">Your library is empty.</div>
      )}

      {items.length > 0 && (
        <div className="poster-grid">
          {items.map((it) => {
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
                  {it.releaseInfo && <> · {it.releaseInfo}</>}
                </div>
                {badge.nextLabel && (
                  <div className="lib-next">{badge.nextLabel}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
