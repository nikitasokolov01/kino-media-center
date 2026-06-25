// HomeHero — rotating widescreen banner for the Home page.
//
// Fetches items from the first few installed addon catalogs, prefers those with
// a backdrop/background image, and rotates every 10 seconds. Pauses on hover.
// Left/right arrows and dot indicators let the user navigate manually.
// Clicking "More Info" navigates to /media/:type/:id (the existing media detail
// page). Falls back to poster + a gradient when no backdrop is available.
//
// Props:
//   descriptors — the CatalogDescriptor list already computed by HomePage.
//   The hero fetches its own data from the first MAX_CATALOGS descriptors so it
//   does not need to duplicate state from CatalogRow components.
//
// Rules:
//   - No playback, debrid, or stream fetching.
//   - All CSS uses var(--color-*) tokens.
//   - Empty / error states return null silently (hero is decorative).

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { StremioCatalogItem } from "../core/stremio/types.js";

// Minimal duplicate of the descriptor shape (defined in HomePage) so we avoid
// a circular import. The fields used here match exactly.
interface CatalogDescriptor {
  key: string;
  manifestUrl: string;
  type: string;
  catalogId: string;
}

interface HeroItem extends StremioCatalogItem {
  /** Deduplicated key used as React key: "type:id" */
  _heroKey: string;
}

const MAX_HERO_ITEMS = 8;
const MAX_CATALOGS_TO_FETCH = 3; // avoids hammering every installed addon
const ROTATE_MS = 10_000;        // 10-second rotation interval
const FADE_MS = 180;             // fade-out duration before swapping item

interface Props {
  descriptors: CatalogDescriptor[];
  /**
   * When provided, the hero fetches ONLY from this catalog instead of
   * auto-picking from the first MAX_CATALOGS_TO_FETCH. Falls back to auto
   * mode if the catalog returns no items.
   */
  forcedDescriptor?: CatalogDescriptor | null;
}

export default function HomeHero({ descriptors, forcedDescriptor }: Props) {
  const [items, setItems] = useState<HeroItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIdx, setActiveIdx] = useState(0);
  const [visible, setVisible] = useState(true); // drives the opacity transition

  // Refs avoid stale closures in the interval callback
  const activeIdxRef = useRef(0);
  const hoveredRef = useRef(false);

  const navigate = useNavigate();

  // ── Fetch hero items from the first few catalogs ───────────────────────────

  useEffect(() => {
    if (descriptors.length === 0 && !forcedDescriptor) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    // In catalog mode, fetch ONLY the chosen descriptor (falling back to auto
    // if it returns nothing). In auto mode, pick the first few descriptors.
    const toFetch = forcedDescriptor
      ? [forcedDescriptor]
      : descriptors.slice(0, MAX_CATALOGS_TO_FETCH);

    if (toFetch.length === 0) {
      setLoading(false);
      return;
    }

    const pickItems = (results: PromiseSettledResult<StremioCatalogItem[]>[]): HeroItem[] => {
      const seen = new Set<string>();
      const out: HeroItem[] = [];

      // First pass — prefer items with a wide/landscape backdrop image
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        for (const item of r.value) {
          if (!item.background) continue;
          const k = `${item.type}:${item.id}`;
          if (seen.has(k)) continue;
          seen.add(k);
          out.push({ ...item, _heroKey: k });
          if (out.length >= MAX_HERO_ITEMS) break;
        }
        if (out.length >= MAX_HERO_ITEMS) break;
      }

      // Second pass — fill remaining slots with poster-only items
      if (out.length < MAX_HERO_ITEMS) {
        for (const r of results) {
          if (r.status !== "fulfilled") continue;
          for (const item of r.value) {
            if (!item.poster) continue;
            const k = `${item.type}:${item.id}`;
            if (seen.has(k)) continue;
            seen.add(k);
            out.push({ ...item, _heroKey: k });
            if (out.length >= MAX_HERO_ITEMS) break;
          }
          if (out.length >= MAX_HERO_ITEMS) break;
        }
      }
      return out;
    };

    Promise.allSettled(
      toFetch.map((d) =>
        window.mediaCenter.catalog
          .fetch({ manifestUrl: d.manifestUrl, type: d.type, catalogId: d.catalogId })
          .then((res) => res.metas ?? [])
          .catch(() => [] as StremioCatalogItem[])
      )
    ).then(async (results) => {
      if (cancelled) return;

      let out = pickItems(results);

      // Catalog mode fallback: if the chosen catalog returned nothing, fall
      // back to auto mode using the first few descriptors.
      if (out.length === 0 && forcedDescriptor && descriptors.length > 0) {
        const autoFetch = descriptors
          .filter((d) => d.key !== forcedDescriptor.key)
          .slice(0, MAX_CATALOGS_TO_FETCH);
        if (autoFetch.length > 0) {
          const fallbackResults = await Promise.allSettled(
            autoFetch.map((d) =>
              window.mediaCenter.catalog
                .fetch({ manifestUrl: d.manifestUrl, type: d.type, catalogId: d.catalogId })
                .then((res) => res.metas ?? [])
                .catch(() => [] as StremioCatalogItem[])
            )
          );
          if (!cancelled) out = pickItems(fallbackResults);
        }
      }

      if (!cancelled) {
        setItems(out);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [descriptors, forcedDescriptor]);

  // ── Transition helper: fade out → swap item → fade in ─────────────────────

  const goTo = useCallback((idx: number) => {
    setVisible(false);
    setTimeout(() => {
      setActiveIdx(idx);
      activeIdxRef.current = idx;
      setVisible(true);
    }, FADE_MS);
  }, []);

  // ── Auto-rotate (pauses while the mouse is over the hero) ─────────────────

  useEffect(() => {
    if (items.length <= 1) return;
    const id = setInterval(() => {
      if (!hoveredRef.current) {
        const next = (activeIdxRef.current + 1) % items.length;
        goTo(next);
      }
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [items.length, goTo]);

  // ── Early returns ──────────────────────────────────────────────────────────

  if (loading) {
    return <div className="home-hero home-hero--skeleton" aria-hidden="true" />;
  }
  if (items.length === 0) return null;

  // ── Derived display values ─────────────────────────────────────────────────

  const item = items[activeIdx];
  // Prefer landscape background; fall back to portrait poster
  const bgUrl = item.background ?? item.poster;
  // Logo/clearlogo art when the addon provides it; falls back to text title.
  const logoUrl = typeof item.logo === "string" && item.logo.length > 0 ? item.logo : null;
  const genres = item.genres?.slice(0, 3).join(" · ") ?? null;
  const yearInfo = item.releaseInfo ?? (item.year != null ? String(item.year) : null);

  const goPrev = () => {
    goTo((activeIdx - 1 + items.length) % items.length);
  };
  const goNext = () => {
    goTo((activeIdx + 1) % items.length);
  };

  const transitionClass = visible ? " home-hero--visible" : "";

  return (
    <div
      className="home-hero"
      onMouseEnter={() => { hoveredRef.current = true; }}
      onMouseLeave={() => { hoveredRef.current = false; }}
    >
      {/* Visual backdrop layer: image + vignette, wrapped together so the
           CSS mask-image on .home-hero__visual fades both to transparent
           at the bottom. pointer-events:none so clicks pass through. */}
      <div className="home-hero__visual" aria-hidden="true">
        {bgUrl && (
          <div
            className={`home-hero__bg${transitionClass}`}
            style={{ backgroundImage: `url("${bgUrl}")` }}
          />
        )}
        <div className="home-hero__gradient" />
      </div>

      {/* Text content */}
      <div className={`home-hero__content${transitionClass}`}>
        {genres && <p className="home-hero__genres">{genres}</p>}
        {logoUrl ? (
          <img
            className="home-hero__logo"
            src={logoUrl}
            alt={item.name}
            draggable={false}
            onError={(e) => {
              // If the logo fails, swap to a text title so the hero never looks empty.
              const img = e.currentTarget as HTMLImageElement;
              img.style.display = "none";
              const h = img.nextElementSibling as HTMLElement | null;
              if (h) h.style.display = "";
            }}
          />
        ) : null}
        <h2 className="home-hero__title" style={logoUrl ? { display: "none" } : undefined}>
          {item.name}
        </h2>
        {yearInfo && <p className="home-hero__meta">{yearInfo}</p>}
        {item.description && (
          <p className="home-hero__desc">{item.description}</p>
        )}
        <button
          type="button"
          className="home-hero__btn"
          onClick={() =>
            navigate(
              `/media/${encodeURIComponent(item.type)}/${encodeURIComponent(item.id)}`
            )
          }
        >
          More Info
        </button>
      </div>

      {/* Navigation (only rendered when there is more than one item) */}
      {items.length > 1 && (
        <>
          <button
            type="button"
            className="home-hero__arrow home-hero__arrow--left"
            onClick={goPrev}
            aria-label="Previous"
          >
            ‹
          </button>
          <button
            type="button"
            className="home-hero__arrow home-hero__arrow--right"
            onClick={goNext}
            aria-label="Next"
          >
            ›
          </button>

          <div className="home-hero__dots" role="tablist" aria-label="Hero slides">
            {items.map((it, i) => (
              <button
                key={it._heroKey}
                type="button"
                role="tab"
                aria-selected={i === activeIdx}
                aria-label={`Slide ${i + 1}: ${it.name}`}
                className={`home-hero__dot${i === activeIdx ? " home-hero__dot--active" : ""}`}
                onClick={() => goTo(i)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
