// "Recently Added" strip for the Home page: shows the last N items the user
// added to their library, ordered newest-first. Hides itself when the library
// is empty so the Home page doesn't look broken on a fresh install.

import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useLibrary } from "../state/LibraryContext.js";
import type { LibraryItem } from "../types/preload.js";

const MAX_ITEMS = 20;

function sortedRecent(items: LibraryItem[]): LibraryItem[] {
  return [...items]
    .sort((a, b) => {
      // addedAt is an ISO timestamp string from SQLite — lexicographic sort works.
      return b.addedAt.localeCompare(a.addedAt);
    })
    .slice(0, MAX_ITEMS);
}

export default function LibraryRecentRow() {
  const { items, loading } = useLibrary();
  const navigate = useNavigate();

  const recent = useMemo(() => sortedRecent(items), [items]);

  // Nothing to show.
  if (loading || recent.length === 0) return null;

  return (
    <section className="catalog-row library-recent-row">
      <header className="catalog-row__header">
        <h2 className="catalog-row__title">Recently Added</h2>
        <button
          type="button"
          className="catalog-row__see-all"
          onClick={() => navigate("/library")}
        >
          See all in Library
        </button>
      </header>
      <div className="catalog-row__strip">
        {recent.map((it) => {
          const to = `/media/${encodeURIComponent(it.type)}/${encodeURIComponent(it.mediaId)}`;
          return (
            <div
              key={`${it.type}:${it.mediaId}`}
              className="catalog-item"
              title={it.title}
              role="button"
              tabIndex={0}
              onClick={() => navigate(to)}
              onKeyDown={(e) => { if (e.key === "Enter") navigate(to); }}
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
                  <div
                    className="catalog-item__poster catalog-item__poster--placeholder"
                    aria-hidden
                  >
                    {it.title.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <span className="lib-recent__type-badge">{it.type}</span>
              </div>
              <div className="catalog-item__title">{it.title}</div>
              {it.releaseInfo && (
                <div className="catalog-item__year">{it.releaseInfo}</div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
