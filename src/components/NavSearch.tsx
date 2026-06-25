// Navbar search box with a live suggestions dropdown.
//
// - Debounced live results (via useSearchSuggestions) appear under the input.
// - Enter opens the highlighted result, or navigates to the full /search page.
// - Arrow up/down move the highlight; Esc closes; clicking outside closes.
// - Clicking a result opens its media detail page.
// The full /search route is unchanged and still works.

import { type FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSearchSuggestions } from "../features/search/useSearchSuggestions.js";
import type { StremioCatalogItem } from "../core/stremio/types.js";

function typeLabel(item: StremioCatalogItem): string {
  const genres = Array.isArray(item.genres) ? item.genres : [];
  if (genres.some((g) => typeof g === "string" && g.toLowerCase() === "anime")) {
    return "anime";
  }
  return item.type === "series" ? "series" : item.type === "movie" ? "movie" : item.type;
}

function yearLabel(item: StremioCatalogItem): string | null {
  if (item.releaseInfo) return String(item.releaseInfo);
  if (typeof item.year === "number") return String(item.year);
  return null;
}

export default function NavSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const { items, loading, done } = useSearchSuggestions(open ? query : "");

  // Reset highlight whenever the result set changes.
  useEffect(() => {
    setActiveIndex(-1);
  }, [items]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function goToFullSearch() {
    const q = query.trim();
    if (!q) return;
    setOpen(false);
    void navigate(`/search?q=${encodeURIComponent(q)}`);
  }

  function openItem(item: StremioCatalogItem) {
    setOpen(false);
    setQuery("");
    void navigate(
      `/media/${encodeURIComponent(item.type)}/${encodeURIComponent(item.id)}`,
    );
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (activeIndex >= 0 && activeIndex < items.length) {
      openItem(items[activeIndex]);
    } else {
      goToFullSearch();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (items.length > 0) {
        setOpen(true);
        setActiveIndex((i) => (i + 1) % items.length);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length > 0) {
        setActiveIndex((i) => (i <= 0 ? items.length - 1 : i - 1));
      }
    }
  }

  const showDropdown = open && query.trim().length >= 2;

  return (
    <div className="top-nav__search-wrap" ref={rootRef}>
      <form className="top-nav__search" onSubmit={handleSubmit} role="search">
        <svg
          className="top-nav__search-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          className="top-nav__search-input"
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search movies, shows, anime..."
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={showDropdown}
          aria-autocomplete="list"
        />
      </form>

      {showDropdown && (
        <div className="search-suggest" role="listbox">
          {loading && items.length === 0 && (
            <div className="search-suggest__status">
              <span className="search-suggest__spinner" aria-hidden /> Searching...
            </div>
          )}

          {!loading && done && items.length === 0 && (
            <div className="search-suggest__status">No results</div>
          )}

          {items.map((item, i) => {
            const year = yearLabel(item);
            return (
              <button
                key={`${item.type}:${item.id}`}
                type="button"
                role="option"
                aria-selected={i === activeIndex}
                className={
                  "search-suggest__row" +
                  (i === activeIndex ? " search-suggest__row--active" : "")
                }
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => openItem(item)}
              >
                <div className="search-suggest__thumb">
                  {item.poster ? (
                    <img src={item.poster} alt="" loading="lazy" />
                  ) : (
                    <span aria-hidden>{item.name.slice(0, 1).toUpperCase()}</span>
                  )}
                </div>
                <div className="search-suggest__info">
                  <div className="search-suggest__title" title={item.name}>
                    {item.name}
                  </div>
                  <div className="search-suggest__meta">
                    <span className="search-suggest__type">{typeLabel(item)}</span>
                    {year && <span className="search-suggest__year">{year}</span>}
                  </div>
                </div>
              </button>
            );
          })}

          {items.length > 0 && (
            <button
              type="button"
              className="search-suggest__all"
              onClick={goToFullSearch}
            >
              See all results for "{query.trim()}"
            </button>
          )}
        </div>
      )}
    </div>
  );
}
