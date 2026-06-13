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
}

export default function HomeHero({ descriptors }: Props) {
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
    if (descriptors.length === 0) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const toFetch = descriptors.slice(0, MAX_CATALOGS_TO_FETCH);

    Promise.allSettled(
      toFetch.map((d) =>
        window.mediaCenter.catalog
          .fetch({ manifestUrl: d.manifestUrl, type: d.type, catalogId: d.catalogId })
          .then((res) => res.metas ?? [])
          .catch(() => [] as StremioCatalogItem[])
      )
    ).then((results) => {
      if (cancelled) return;

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

      setItems(out);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [descriptors]);

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
      {/* ── Background image ── */}
      {bgUrl && (
        <div
          className={`home-hero__bg${transitionClass}`}
          style={{ backgroundImage: `url("${bgUrl}")` }}
          aria-hidden="true"
        />
      )}

      {/* ── Vignette gradient for text legibility ── */}
      <div className="home-hero__gradient" aria-hidden="true" />

      {/* ── Text content ── */}
      <div className={`home-hero__content${transitionClass}`}>
        {genres && <p className="home-hero__genres">{genres}</p>}
        <h2 className="home-hero__title">{item.name}</h2>
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

      {/* ── Navigation (only rendered when there is more than one item) ── */}
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
