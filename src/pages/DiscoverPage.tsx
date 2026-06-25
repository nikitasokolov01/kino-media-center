// /discover — browse + filter addon-provided catalogs.
//
// Strategy:
//   1. Load installed addons for the active profile.
//   2. Build a descriptor for every browsable catalog (anything that doesn't
//      *require* a search query). Capture each catalog's genre options, year
//      support, and skip (pagination) support straight from the manifest.
//   3. Filter bar: Type (movie/series/anime/...), Catalog/source, Genre, Year.
//      Options come entirely from what the installed addons advertise — nothing
//      is hardcoded. AIO Metadata (aiometadata) catalogs work like any other.
//   4. Results grid uses skip-based pagination (same approach as the expanded
//      catalog page). No streams are ever fetched here.
//   5. Last-used filters persist in localStorage.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useProfile } from "../state/ProfileContext.js";
import { useSettings } from "../state/SettingsContext.js";
import CatalogItem from "../components/CatalogItem.js";
import { resolveCatalogDisplayNames } from "../core/catalog/catalogNames.js";
import {
  catalogRequiresExtra,
  catalogSupportsExtra,
  catalogSupportsSearch,
  catalogSupportsSkip,
  getCatalogExtraOptions,
} from "../core/stremio/catalog.js";
import type {
  StremioCatalog,
  StremioCatalogItem,
} from "../core/stremio/types.js";
import type { AddonRow } from "../types/preload.js";

const LS_KEY = "kino.discover.filters";

interface CatalogDescriptor {
  key: string;
  addonId: string;
  addonName: string;
  manifestUrl: string;
  type: string;
  catalogId: string;
  catalogName: string;
  genreOptions: string[];
  genreRequired: boolean;
  yearOptions: string[];
  supportsYear: boolean;
  supportsSkip: boolean;
}

interface SavedFilters {
  type?: string;
  catalogKey?: string;
  genre?: string;
  year?: string;
}

function buildDescriptors(addons: AddonRow[]): CatalogDescriptor[] {
  const out: CatalogDescriptor[] = [];
  for (const a of addons) {
    const catalogs = (a.manifest.catalogs ?? []) as StremioCatalog[];
    if (!Array.isArray(catalogs)) continue;
    for (const c of catalogs) {
      if (!c || typeof c.type !== "string" || typeof c.id !== "string") continue;
      // A catalog that *requires* a search query is not browsable here.
      if (catalogRequiresExtra(c, "search")) continue;
      // A search-only catalog (search supported + no other browse path) is also
      // skipped when it has no genre/skip browse affordance and requires search.
      const onlySearch =
        catalogSupportsSearch(c) &&
        catalogRequiresExtra(c, "search");
      if (onlySearch) continue;
      out.push({
        key: `${a.id}::${c.type}::${c.id}`,
        addonId: a.id,
        addonName: a.manifest.name,
        manifestUrl: a.manifestUrl,
        type: c.type,
        catalogId: c.id,
        catalogName: c.name ?? `${c.type} / ${c.id}`,
        genreOptions: getCatalogExtraOptions(c, "genre"),
        genreRequired: catalogRequiresExtra(c, "genre"),
        yearOptions: getCatalogExtraOptions(c, "year"),
        supportsYear: catalogSupportsExtra(c, "year"),
        supportsSkip: catalogSupportsSkip(c),
      });
    }
  }
  return out;
}

function loadSaved(): SavedFilters {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as SavedFilters) : {};
  } catch {
    return {};
  }
}

export default function DiscoverPage() {
  const { profile, loading: profileLoading } = useProfile();
  const { settings } = useSettings();

  const [addons, setAddons] = useState<AddonRow[] | null>(null);
  const [addonsError, setAddonsError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    setAddonsError(null);
    window.mediaCenter.addons
      .list(profile.id)
      .then((rows) => { if (!cancelled) setAddons(rows); })
      .catch((e: unknown) => {
        if (!cancelled) {
          setAddons([]);
          setAddonsError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => { cancelled = true; };
  }, [profile]);

  const descriptors = useMemo(
    () => (addons ? buildDescriptors(addons) : []),
    [addons],
  );

  // Clean display names (rename overrides applied; addon/provider names hidden,
  // disambiguated only on duplicate-name conflicts).
  const displayNames = useMemo(
    () => resolveCatalogDisplayNames(descriptors, settings.catalogNameOverrides),
    [descriptors, settings.catalogNameOverrides],
  );

  // Distinct content types across browsable catalogs.
  const types = useMemo(() => {
    const s = new Set<string>();
    descriptors.forEach((d) => s.add(d.type));
    return Array.from(s);
  }, [descriptors]);

  const saved = useRef<SavedFilters>(loadSaved());

  const [typeFilter, setTypeFilter] = useState<string>(saved.current.type ?? "all");
  const [catalogKey, setCatalogKey] = useState<string>(saved.current.catalogKey ?? "");
  const [genre, setGenre] = useState<string>(saved.current.genre ?? "");
  const [year, setYear] = useState<string>(saved.current.year ?? "");

  // Catalogs matching the current type filter.
  const visibleCatalogs = useMemo(
    () =>
      descriptors.filter((d) => typeFilter === "all" || d.type === typeFilter),
    [descriptors, typeFilter],
  );

  // Resolve the selected descriptor; default to the first visible catalog.
  const selected = useMemo<CatalogDescriptor | null>(() => {
    if (visibleCatalogs.length === 0) return null;
    return (
      visibleCatalogs.find((d) => d.key === catalogKey) ?? visibleCatalogs[0]
    );
  }, [visibleCatalogs, catalogKey]);

  // Keep catalogKey valid when the type filter changes the visible set.
  useEffect(() => {
    if (selected && selected.key !== catalogKey) {
      setCatalogKey(selected.key);
    }
  }, [selected, catalogKey]);

  // When the catalog changes, ensure genre/year are valid for it.
  useEffect(() => {
    if (!selected) return;
    if (selected.genreRequired && selected.genreOptions.length > 0) {
      if (!selected.genreOptions.includes(genre)) setGenre(selected.genreOptions[0]);
    } else if (genre && !selected.genreOptions.includes(genre)) {
      setGenre("");
    }
    if (year && !selected.supportsYear) setYear("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.key]);

  // Year choices: declared options, else a generated recent-years range.
  const yearChoices = useMemo(() => {
    if (!selected || !selected.supportsYear) return [];
    if (selected.yearOptions.length > 0) return selected.yearOptions;
    const now = new Date().getFullYear();
    const arr: string[] = [];
    for (let y = now; y >= 1950; y--) arr.push(String(y));
    return arr;
  }, [selected]);

  // Persist filters.
  useEffect(() => {
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({ type: typeFilter, catalogKey, genre, year }),
      );
    } catch { /* ignore */ }
  }, [typeFilter, catalogKey, genre, year]);

  // ----- Results + pagination -----------------------------------------------
  const [items, setItems] = useState<StremioCatalogItem[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const skipRef = useRef(0);
  const loadingRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [done, setDone] = useState(false);

  // The "query signature" that, when changed, resets the result list.
  const sig = selected ? `${selected.key}|${genre}|${year}` : "";

  const loadNextPage = useCallback(async () => {
    if (!selected) return;
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);

    const skip = skipRef.current;
    const extra: Record<string, string | number> = {};
    if (genre) extra.genre = genre;
    if (year) extra.year = year;
    if (skip > 0) extra.skip = skip;

    try {
      const res = await window.mediaCenter.catalog.fetch({
        manifestUrl: selected.manifestUrl,
        type: selected.type,
        catalogId: selected.catalogId,
        extra: Object.keys(extra).length > 0 ? extra : undefined,
      });
      const fresh: StremioCatalogItem[] = [];
      for (const m of res.metas ?? []) {
        const key = `${m.type}:${m.id}`;
        if (!seenRef.current.has(key)) {
          seenRef.current.add(key);
          fresh.push(m);
        }
      }
      if (fresh.length === 0) {
        setHasMore(false);
      } else {
        setItems((prev) => [...prev, ...fresh]);
        skipRef.current += fresh.length;
        if (!selected.supportsSkip) setHasMore(false);
      }
      setLoading(false);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    } finally {
      loadingRef.current = false;
    }
  }, [selected, genre, year]);

  // Reset + fetch first page whenever the query signature changes.
  useEffect(() => {
    setItems([]);
    seenRef.current = new Set();
    skipRef.current = 0;
    loadingRef.current = false;
    setHasMore(true);
    setError(null);
    setDone(false);
    if (selected) void loadNextPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  // Auto-load on scroll.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    if (!hasMore || loading || error) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) void loadNextPage();
      },
      { rootMargin: "400px 0px" },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [hasMore, loading, error, loadNextPage, items.length]);

  // ----- Render --------------------------------------------------------------
  return (
    <div className="page discover-page">
      <h1>Discover</h1>

      {profileLoading && <p className="muted">Loading profile...</p>}
      {profile && addonsError && (
        <div className="error-banner">Could not load addons: {addonsError}</div>
      )}

      {profile && addons !== null && descriptors.length === 0 && (
        <div className="empty">
          None of your installed addons expose a browsable catalog. Install a
          metadata/catalog addon from the Addons page.
        </div>
      )}

      {descriptors.length > 0 && (
        <div className="discover-filters">
          <label className="discover-filter">
            <span className="discover-filter__label">Type</span>
            <select
              className="select-input"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="all">All</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
          </label>

          <label className="discover-filter">
            <span className="discover-filter__label">Catalog</span>
            <select
              className="select-input"
              value={selected?.key ?? ""}
              onChange={(e) => setCatalogKey(e.target.value)}
            >
              {visibleCatalogs.map((d) => (
                <option key={d.key} value={d.key}>
                  {displayNames.get(d.key) ?? d.catalogName}
                </option>
              ))}
            </select>
          </label>

          {selected && selected.genreOptions.length > 0 && (
            <label className="discover-filter">
              <span className="discover-filter__label">Genre</span>
              <select
                className="select-input"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
              >
                {!selected.genreRequired && <option value="">All genres</option>}
                {selected.genreOptions.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </label>
          )}

          {selected && selected.supportsYear && (
            <label className="discover-filter">
              <span className="discover-filter__label">Year</span>
              <select
                className="select-input"
                value={year}
                onChange={(e) => setYear(e.target.value)}
              >
                <option value="">Any year</option>
                {yearChoices.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {/* Results */}
      {items.length > 0 && (
        <div className="poster-grid">
          {items.map((it) => (
            <CatalogItem key={`${it.type}:${it.id}`} item={it} />
          ))}
        </div>
      )}

      {loading && items.length === 0 && (
        <div className="poster-grid">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="catalog-item catalog-item--skeleton" aria-hidden>
              <div className="catalog-item__poster-wrap">
                <div className="catalog-item__poster catalog-item__poster--skeleton" />
              </div>
              <div className="skeleton-line" />
            </div>
          ))}
        </div>
      )}

      {!loading && done && items.length === 0 && !error && selected && (
        <div className="empty">No items match these filters.</div>
      )}

      {selected && (
        <div className="catalog-page__footer">
          {loading && items.length > 0 && <div className="muted">Loading...</div>}
          {error && (
            <div className="error-banner" role="alert">
              Failed to load: {error}
              <div style={{ marginTop: 8 }}>
                <button type="button" className="primary-button" onClick={() => void loadNextPage()}>
                  Retry
                </button>
              </div>
            </div>
          )}
          {!loading && !error && hasMore && items.length > 0 && (
            <button type="button" className="primary-button" onClick={() => void loadNextPage()}>
              Load more
            </button>
          )}
          {!hasMore && items.length > 0 && (
            <div className="muted small">End of catalog - {items.length} items</div>
          )}
          {hasMore && !error && (
            <div ref={sentinelRef} className="catalog-page__sentinel" aria-hidden />
          )}
        </div>
      )}
    </div>
  );
}
