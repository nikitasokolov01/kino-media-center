// A single horizontal catalog row on the Home page.
// Acts as a preview only — the user clicks "See all" to open the dedicated
// catalog page. Owns its own loading/error state so one broken addon never
// breaks the rest of the page.
//
// Caching: on first render the row checks homeCatalogCache. If a fresh entry
// exists, items are shown immediately (no loading flash). A background refresh
// is then fired to keep the cache warm. On miss, the normal fetch runs and the
// result is stored in the cache for the next visit.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import CatalogItem from "./CatalogItem.js";
import { useDragScroll } from "../features/ui/useDragScroll.js";
import { useProfile } from "../state/ProfileContext.js";
import {
  getHomeCatalogCache,
  makeHomeCacheKey,
  setHomeCatalogCache,
} from "../core/catalog/homeCatalogCache.js";
import type { StremioCatalogItem } from "../core/stremio/types.js";

interface Props {
  addonId: string;
  addonName: string;
  catalogName: string;
  type: string;
  catalogId: string;
  manifestUrl: string;
}

const PREVIEW_LIMIT = 25;

export default function CatalogRow({
  addonId,
  addonName,
  catalogName,
  type,
  catalogId,
  manifestUrl,
}: Props) {
  const { profile } = useProfile();
  const stripRef = useDragScroll<HTMLDivElement>();

  // Seed state from cache so returning to Home is instant.
  const cacheKey = profile
    ? makeHomeCacheKey(profile.id, addonId, type, catalogId)
    : null;

  const [items, setItems] = useState<StremioCatalogItem[]>(() => {
    if (!cacheKey) return [];
    return getHomeCatalogCache(cacheKey) ?? [];
  });
  // If we seeded from cache, skip the loading shimmer on first paint.
  const [loading, setLoading] = useState(() => {
    if (!cacheKey) return true;
    return getHomeCatalogCache(cacheKey) === null;
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cacheKey) return;

    let cancelled = false;

    // If cache already had items, do a silent background refresh so data stays
    // fresh without blocking the UI. If cache was empty, show loading shimmer.
    const cached = getHomeCatalogCache(cacheKey);
    const isBackgroundRefresh = cached !== null;

    if (!isBackgroundRefresh) {
      setLoading(true);
      setError(null);
    }

    window.mediaCenter.catalog
      .fetch({ manifestUrl, type, catalogId })
      .then((res) => {
        if (cancelled) return;
        const fetched = (res.metas ?? []).slice(0, PREVIEW_LIMIT);
        setItems(fetched);
        setHomeCatalogCache(cacheKey, fetched);
        // Clear any prior error on successful refresh.
        if (isBackgroundRefresh) setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // Only show error if we have nothing cached to display.
        if (!isBackgroundRefresh) {
          setError(e instanceof Error ? e.message : String(e));
        }
        // If background refresh fails, keep showing the cached data silently.
      })
      .finally(() => {
        if (!cancelled && !isBackgroundRefresh) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // Re-run when the addon config or profile changes (cacheKey encodes both).
  }, [cacheKey, manifestUrl, type, catalogId]);

  // Dev-only diagnostic: log this catalog's identity + a sample item so the
  // exact runtime shape (incl. Collections catalogs) can be verified.
  useEffect(() => {
    if (import.meta.env?.DEV && items.length > 0) {
      const s = items[0];
      // eslint-disable-next-line no-console
      console.debug("[catalog-row]", {
        addonId, addonName, catalogId, catalogName, type,
        count: items.length,
        sample: { id: s.id, type: s.type, name: s.name },
      });
    }
  }, [items, addonId, addonName, catalogId, catalogName, type]);

  const seeAllHref = `/catalog/${encodeURIComponent(addonId)}/${encodeURIComponent(type)}/${encodeURIComponent(catalogId)}`;

  return (
    <section className="catalog-row">
      <header className="catalog-row__header">
        <Link to={seeAllHref} className="catalog-row__title-link">
          <h2 className="catalog-row__title">{catalogName}</h2>
        </Link>
        <span className="catalog-row__addon">{type}</span>
        <span className="catalog-row__spacer" />
        <Link to={seeAllHref} className="catalog-row__see-all">
          See all
        </Link>
      </header>

      {loading && (
        <div className="catalog-row__strip">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="catalog-item catalog-item--skeleton" aria-hidden>
              <div className="catalog-item__poster catalog-item__poster--skeleton" />
              <div className="skeleton-line" />
              <div className="skeleton-line skeleton-line--short" />
            </div>
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="catalog-row__error" role="alert">
          Couldn't load this catalog: {error}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="catalog-row__empty">No items.</div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="catalog-row__strip" ref={stripRef}>
          {items.map((it) => (
            <CatalogItem
              key={`${it.type}:${it.id}`}
              item={it}
              catalog={{ addonId, catalogId, catalogName }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
