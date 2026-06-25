// Dedicated catalog page: /catalog/:addonId/:type/:catalogId
//
// Behavior:
//   - Loads the addon from SQLite via addons.get.
//   - Finds the matching catalog entry in the manifest to detect skip support.
//   - Fetches the first page; renders items in a responsive poster grid.
//   - If the catalog supports the `skip` extra, supports loading more pages —
//     either by clicking the Load More button or by scrolling near the bottom
//     (IntersectionObserver). Otherwise the initial page is final.
//   - Deduplicates items by `${type}:${id}`.
//   - Stops paginating when a page returns no new items.
//   - Per-page errors surface inline with a Retry button; the page never
//     unmounts on a failed load.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useParams } from "react-router-dom";
import { useProfile } from "../state/ProfileContext.js";
import { useSettings } from "../state/SettingsContext.js";
import CatalogItem from "../components/CatalogItem.js";
import { catalogSupportsSkip } from "../core/stremio/catalog.js";
import { resolveCatalogName, parseCatalogOverrides } from "../core/catalog/catalogNames.js";
import type {
  StremioCatalog,
  StremioCatalogItem,
} from "../core/stremio/types.js";
import type { AddonRow } from "../types/preload.js";

interface RouteParams {
  addonId: string;
  type: string;
  catalogId: string;
  [key: string]: string | undefined;
}

interface LoadState {
  loading: boolean;
  error: string | null;
}

function findCatalogInManifest(
  addon: AddonRow,
  type: string,
  catalogId: string,
): StremioCatalog | null {
  const catalogs = (addon.manifest.catalogs ?? []) as StremioCatalog[];
  if (!Array.isArray(catalogs)) return null;
  return (
    catalogs.find(
      (c) => c && c.type === type && c.id === catalogId,
    ) ?? null
  );
}

export default function ExpandedCatalogPage() {
  const params = useParams<RouteParams>();
  const addonId = decodeURIComponent(params.addonId ?? "");
  const type = decodeURIComponent(params.type ?? "");
  const catalogId = decodeURIComponent(params.catalogId ?? "");

  const { profile, loading: profileLoading } = useProfile();
  const { settings } = useSettings();

  // ----- Addon resolution ---------------------------------------------------
  const [addon, setAddon] = useState<AddonRow | null>(null);
  const [addonState, setAddonState] = useState<LoadState>({
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    setAddonState({ loading: true, error: null });
    window.mediaCenter.addons
      .get(profile.id, addonId)
      .then((row) => {
        if (cancelled) return;
        setAddon(row);
        setAddonState({
          loading: false,
          error: row ? null : "Addon not found for this profile.",
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setAddonState({
          loading: false,
          error: e instanceof Error ? e.message : String(e),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [profile, addonId]);

  const catalogDef = useMemo(
    () => (addon ? findCatalogInManifest(addon, type, catalogId) : null),
    [addon, type, catalogId],
  );

  const supportsSkip = useMemo(
    () => (catalogDef ? catalogSupportsSkip(catalogDef) : false),
    [catalogDef],
  );

  const catalogName = resolveCatalogName(
    { addonId, type, catalogId, originalName: catalogDef?.name ?? `${type} · ${catalogId}` },
    parseCatalogOverrides(settings.catalogNameOverrides),
  );

  // ----- Pagination state ---------------------------------------------------
  const [items, setItems] = useState<StremioCatalogItem[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const [pageState, setPageState] = useState<LoadState>({
    loading: false,
    error: null,
  });
  // Once a page returns no new items (or skip isn't supported after page 1),
  // there's nothing more to fetch.
  const [hasMore, setHasMore] = useState(true);
  // Skip value to use for the *next* request. Always equals items.length
  // after a successful fetch.
  const skipRef = useRef(0);
  // Synchronous loading guard. React state updates are async, so two
  // triggers in the same tick (button click + IO callback) would both see
  // loading=false. This ref blocks the second one before any fetch is issued.
  const loadingRef = useRef(false);

  // Reset pagination state whenever the route or addon changes.
  useEffect(() => {
    setItems([]);
    seenRef.current = new Set();
    setPageState({ loading: false, error: null });
    setHasMore(true);
    skipRef.current = 0;
    loadingRef.current = false;
  }, [addonId, type, catalogId]);

  const loadNextPage = useCallback(async () => {
    if (!addon) return;
    if (loadingRef.current) return;
    loadingRef.current = true;
    setPageState({ loading: true, error: null });

    const skip = skipRef.current;
    const extra =
      skip > 0 || supportsSkip ? (skip > 0 ? { skip } : undefined) : undefined;

    try {
      const res = await window.mediaCenter.catalog.fetch({
        manifestUrl: addon.manifestUrl,
        type,
        catalogId,
        extra,
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
        // Either the addon ran out, doesn't honor skip, or every item is a
        // duplicate — stop paginating in all three cases.
        setHasMore(false);
      } else {
        setItems((prev) => [...prev, ...fresh]);
        skipRef.current += fresh.length;
        // If the catalog doesn't advertise skip support, the first response
        // is everything we're going to get.
        if (!supportsSkip) setHasMore(false);
      }

      setPageState({ loading: false, error: null });
    } catch (e) {
      setPageState({
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      loadingRef.current = false;
    }
  }, [addon, type, catalogId, supportsSkip]);

  // Kick off the first page once the addon is loaded.
  useEffect(() => {
    if (!addon) return;
    if (items.length === 0 && !pageState.loading && !pageState.error && hasMore) {
      void loadNextPage();
    }
    // We intentionally only depend on `addon` here — loadNextPage handles its
    // own guards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addon]);

  // ----- IntersectionObserver auto-load -------------------------------------
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    if (!hasMore || pageState.loading || pageState.error) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            void loadNextPage();
          }
        }
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, pageState.loading, pageState.error, loadNextPage, items.length]);

  // ----- Render -------------------------------------------------------------

  return (
    <div className="page">
      <p>
        <Link to="/">← Back to Home</Link>
      </p>

      <header className="catalog-page__header">
        <h1 className="catalog-page__title">{catalogName}</h1>
        <div className="catalog-page__meta">
          <span>{type}</span>
          {addon && !supportsSkip && (
            <>
              <span className="dot">·</span>
              <span className="muted">single page (skip not supported)</span>
            </>
          )}
        </div>
      </header>

      {profileLoading && <p className="muted">Loading profile…</p>}
      {addonState.loading && <p className="muted">Loading addon…</p>}
      {addonState.error && (
        <div className="error-banner">{addonState.error}</div>
      )}

      {addon && !catalogDef && (
        <div className="error-banner">
          Couldn't find a catalog called <code>{catalogId}</code> of type{" "}
          <code>{type}</code> in this addon's manifest. It may have been removed
          or renamed by the addon.
        </div>
      )}

      {addon && items.length > 0 && (
        <div className="poster-grid">
          {items.map((it) => (
            <CatalogItem key={`${it.type}:${it.id}`} item={it} />
          ))}
        </div>
      )}

      {addon && items.length === 0 && !pageState.loading && !pageState.error && (
        <div className="empty">No items in this catalog.</div>
      )}

      {/* Load-more / error / sentinel area */}
      {addon && (
        <div className="catalog-page__footer">
          {pageState.loading && (
            <div className="muted">Loading…</div>
          )}

          {pageState.error && (
            <div className="error-banner" role="alert">
              Failed to load this page: {pageState.error}
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void loadNextPage()}
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          {!pageState.loading && !pageState.error && hasMore && items.length > 0 && (
            <button
              type="button"
              className="primary-button"
              onClick={() => void loadNextPage()}
            >
              Load more
            </button>
          )}

          {!hasMore && items.length > 0 && (
            <div className="muted small">End of catalog · {items.length} items</div>
          )}

          {/* Sentinel for IntersectionObserver auto-load. Always rendered when
              more pages may exist so the observer can fire as the user nears
              the bottom of the grid. */}
          {hasMore && !pageState.error && (
            <div ref={sentinelRef} className="catalog-page__sentinel" aria-hidden />
          )}
        </div>
      )}
    </div>
  );
}
