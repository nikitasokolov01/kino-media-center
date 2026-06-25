// "Continue Watching" row for the Home page. Lists recent in-progress items
// (from watch_progress, populated by the MPV IPC tracker). Clicking a card
// opens the media detail page so the user can pick a fresh source — we never
// reuse old stream URLs because they may have expired.
//
// Right-click adds Continue-Watching-specific actions on top of the standard
// Open Details / Library options.

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useProfile } from "../state/ProfileContext.js";
import { useLibrary } from "../state/LibraryContext.js";
import { useContextMenu } from "../state/ContextMenuContext.js";
import { useToast } from "../state/ToastContext.js";
import { useDragScroll } from "../features/ui/useDragScroll.js";
import { formatTime } from "../features/player/playability.js";
import type { WatchProgress, NewEpisodeBadge } from "../types/preload.js";

function pct(p: WatchProgress): number {
  if (!p.durationSeconds || p.durationSeconds <= 0) return 0;
  return Math.min(100, Math.max(0, (p.progressSeconds / p.durationSeconds) * 100));
}

function episodeLabel(p: WatchProgress): string | null {
  if (p.type !== "series") return null;
  if (typeof p.season === "number" && typeof p.episode === "number") {
    return `S${String(p.season).padStart(2, "0")}E${String(p.episode).padStart(2, "0")}`;
  }
  return null;
}

export default function ContinueWatchingRow() {
  const { profile } = useProfile();
  const { isInLibrary, add, remove } = useLibrary();
  const { openContextMenu } = useContextMenu();
  const { toast } = useToast();
  const navigate = useNavigate();
  const stripRef = useDragScroll<HTMLDivElement>();
  const [newEpBadges, setNewEpBadges] = useState<Record<string, NewEpisodeBadge>>({});
  const [items, setItems] = useState<WatchProgress[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(() => {
    if (!profile) return;
    window.mediaCenter.progress
      .list({ profileId: profile.id, limit: 20 })
      .then((rows) => setItems(rows))
      .catch(() => setItems([]))
      .finally(() => setLoaded(true));
  }, [profile]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function openMenu(e: React.MouseEvent, p: WatchProgress) {
    e.preventDefault();
    e.stopPropagation();
    if (!profile) return;
    const to = `/media/${encodeURIComponent(p.type)}/${encodeURIComponent(p.mediaId)}`;
    const inLib = isInLibrary(p.type, p.mediaId);
    openContextMenu(e.clientX, e.clientY, [
      { label: "Open Details", onSelect: () => navigate(to) },
      inLib
        ? {
            label: "Remove from Library",
            danger: true,
            onSelect: async () => {
              await remove(p.type, p.mediaId);
              toast("Removed from Library");
            },
          }
        : {
            label: "Add to Library",
            onSelect: async () => {
              await add({
                type: p.type,
                mediaId: p.mediaId,
                title: p.title,
                poster: p.poster ?? null,
                releaseInfo: null,
              });
              toast("Added to Library");
            },
          },
      {
        label: "Remove from Continue Watching",
        danger: true,
        onSelect: async () => {
          // Dismiss ALL rows for this mediaId (covers every episode for series,
          // or the single row for movies). listContinueWatching filters
          // cw_dismissed=0 so the item will not reappear until the user watches again.
          await window.mediaCenter.progress.dismiss({
            profileId: profile.id,
            mediaId: p.mediaId,
          });
          setItems((prev) => prev.filter((x) => x.mediaId !== p.mediaId));
          toast("Removed from Continue Watching");
        },
      },
    ]);
  }

  // New Episode badges for series items (caught-up shows with a newer episode).
  useEffect(() => {
    if (!profile) { setNewEpBadges({}); return; }
    const ids = Array.from(
      new Set(items.filter((p) => p.type === "series").map((p) => p.mediaId)),
    );
    if (ids.length === 0) { setNewEpBadges({}); return; }
    let cancelled = false;
    window.mediaCenter.caughtUp
      .badges({ profileId: profile.id, mediaIds: ids })
      .then((m) => { if (!cancelled) setNewEpBadges(m); })
      .catch(() => { if (!cancelled) setNewEpBadges({}); });
    return () => { cancelled = true; };
  }, [profile, items]);

  // Nothing to show — render nothing (no empty-state clutter on Home).
  if (!loaded || items.length === 0) return null;

  return (
    <section className="catalog-row continue-watching">
      <header className="catalog-row__header">
        <h2 className="catalog-row__title">Continue Watching</h2>
      </header>
      <div className="catalog-row__strip" ref={stripRef}>
        {items.map((p) => {
          // For series, carry the in-progress season/episode so the media page
          // opens on the right season (not Season 1).
          const seasonQ =
            p.type === "series" && typeof p.season === "number"
              ? `?season=${p.season}${typeof p.episode === "number" ? `&episode=${p.episode}` : ""}`
              : "";
          const to = `/media/${encodeURIComponent(p.type)}/${encodeURIComponent(p.mediaId)}${seasonQ}`;
          const label = episodeLabel(p);
          return (
            <Link
              key={`${p.type}:${p.mediaId}:${p.playableId}`}
              to={to}
              className="cw-card"
              title={p.title}
              draggable={false}
              onContextMenu={(e) => openMenu(e, p)}
            >
              <div className="cw-card__poster-wrap">
                {p.poster ? (
                  <img
                    className="cw-card__poster"
                    src={p.poster}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                    }}
                  />
                ) : (
                  <div className="cw-card__poster cw-card__poster--placeholder" aria-hidden>
                    {p.title.slice(0, 1).toUpperCase()}
                  </div>
                )}
                {newEpBadges[p.mediaId]?.hasNew && (
                  <span className="new-ep-badge" title={newEpBadges[p.mediaId].label}>New</span>
                )}
                <div className="cw-card__resume" aria-hidden>▶ Resume</div>
                <div className="cw-card__progress">
                  <div
                    className="cw-card__progress-fill"
                    style={{ width: `${pct(p)}%` }}
                  />
                </div>
              </div>
              <div className="cw-card__title">{p.title}</div>
              <div className="cw-card__sub muted">
                {label && <span>{label}</span>}
                {label && (p.episodeTitle || true) && " · "}
                {p.type === "series" && p.episodeTitle
                  ? p.episodeTitle
                  : `${formatTime(p.progressSeconds)}${p.durationSeconds > 0 ? ` / ${formatTime(p.durationSeconds)}` : ""}`}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
