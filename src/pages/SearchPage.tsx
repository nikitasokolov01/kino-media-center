// /search?q=<query>
//
// Strategy:
//   1. Load installed addons for the active profile.
//   2. Collect every (addon, catalog) pair where the catalog's type is
//      `movie` or `series` and its manifest declares the `search` extra.
//   3. Fire all searches in parallel via the existing catalog.fetch IPC with
//      `extra: { search: query }` (the catalog URL builder handles encoding).
//   4. Combine + dedupe results by `${type}:${id}`. Preserve first-seen order
//      across the fan-out (best-effort relevance ordering — addons that return
//      a strong match first end up ranked higher).
//   5. Track per-addon failures and surface them as a small warning while
//      still rendering whatever results came back from the other addons.

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useProfile } from "../state/ProfileContext.js";
import CatalogItem from "../components/CatalogItem.js";
import { catalogSupportsSearch } from "../core/stremio/catalog.js";
import type {
  StremioCatalog,
  StremioCatalogItem,
} from "../core/stremio/types.js";
import type { AddonRow } from "../types/preload.js";

const SEARCHABLE_TYPES = ["movie", "series"] as const;
type SearchableType = (typeof SEARCHABLE_TYPES)[number];

interface SearchTarget {
  addonId: string;
  addonName: string;
  manifestUrl: string;
  type: SearchableType;
  catalogId: string;
  catalogName: string;
}

interface AddonFailure {
  addonId: string;
  addonName: string;
  catalogId: string;
  message: string;
}

function isSearchableType(t: unknown): t is SearchableType {
  return t === "movie" || t === "series";
}

function targetsForAddons(addons: AddonRow[]): SearchTarget[] {
  const out: SearchTarget[] = [];
  for (const a of addons) {
    const catalogs = (a.manifest.catalogs ?? []) as StremioCatalog[];
    if (!Array.isArray(catalogs)) continue;
    for (const c of catalogs) {
      if (!c || typeof c.type !== "string" || typeof c.id !== "string") continue;
      if (!isSearchableType(c.type)) continue;
      if (!catalogSupportsSearch(c)) continue;
      out.push({
        addonId: a.id,
        addonName: a.manifest.name,
        manifestUrl: a.manifestUrl,
        type: c.type,
        catalogId: c.id,
        catalogName: c.name ?? `${c.type} · ${c.id}`,
      });
    }
  }
  return out;
}

export default function SearchPage() {
  const [params] = useSearchParams();
  const rawQuery = params.get("q") ?? "";
  const query = rawQuery.trim();

  const { profile, loading: profileLoading } = useProfile();

  const [addons, setAddons] = useState<AddonRow[] | null>(null);
  const [addonsError, setAddonsError] = useState<string | null>(null);

  // Load addons for the active profile (once per profile change).
  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    setAddonsError(null);
    window.mediaCenter.addons
      .list(profile.id)
      .then((rows) => {
        if (!cancelled) setAddons(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setAddons([]);
          setAddonsError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  const targets = useMemo<SearchTarget[]>(
    () => (addons ? targetsForAddons(addons) : []),
    [addons],
  );

  // ----- Search state ----------------------------------------------------
  const [items, setItems] = useState<StremioCatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [failures, setFailures] = useState<AddonFailure[]>([]);
  const [completed, setCompleted] = useState(false);

  // Fan out search whenever query or targets change.
  useEffect(() => {
    if (!profile) return;
    if (addons === null) return; // wait for addons to load
    if (!query) {
      setItems([]);
      setFailures([]);
      setLoading(false);
      setCompleted(false);
      return;
    }
    if (targets.length === 0) {
      setItems([]);
      setFailures([]);
      setLoading(false);
      setCompleted(true);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setItems([]);
    setFailures([]);
    setCompleted(false);

    const seen = new Set<string>();
    const collected: StremioCatalogItem[] = [];
    const fails: AddonFailure[] = [];

    const tasks = targets.map((t) =>
      window.mediaCenter.catalog
        .fetch({
          manifestUrl: t.manifestUrl,
          type: t.type,
          catalogId: t.catalogId,
          extra: { search: query },
        })
        .then((res) => {
          if (cancelled) return;
          for (const m of res.metas ?? []) {
            const key = `${m.type}:${m.id}`;
            if (!seen.has(key)) {
              seen.add(key);
              collected.push(m);
            }
          }
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          fails.push({
            addonId: t.addonId,
            addonName: t.addonName,
            catalogId: t.catalogId,
            message: e instanceof Error ? e.message : String(e),
          });
        }),
    );

    Promise.allSettled(tasks).then(() => {
      if (cancelled) return;
      // Single batched update so the grid renders once per query, not per
      // returning addon.
      setItems(collected);
      setFailures(fails);
      setLoading(false);
      setCompleted(true);
    });

    return () => {
      cancelled = true;
    };
  }, [profile, addons, targets, query]);

  // ----- Render ----------------------------------------------------------

  return (
    <div className="page">
      <h1>Search</h1>

      {profileLoading && <p className="muted">Loading profile…</p>}

      {profile && addonsError && (
        <div className="error-banner">Could not load addons: {addonsError}</div>
      )}

      {!query && (
        <p className="muted">
          Type a query in the sidebar and press Enter to search your installed
          addons.
        </p>
      )}

      {query && (
        <p className="muted">
          Showing results for <strong>“{query}”</strong>
          {targets.length > 0 && (
            <> · searched {targets.length} catalog{targets.length === 1 ? "" : "s"} across {new Set(targets.map((t) => t.addonId)).size} addon{new Set(targets.map((t) => t.addonId)).size === 1 ? "" : "s"}</>
          )}
        </p>
      )}

      {/* Empty addons / no compatible catalogs */}
      {profile && addons !== null && query && targets.length === 0 && (
        <div className="empty">
          None of your installed addons declare a searchable movie or series
          catalog.
        </div>
      )}

      {loading && (
        <div className="poster-grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="catalog-item catalog-item--skeleton" aria-hidden>
              <div className="catalog-item__poster-wrap">
                <div className="catalog-item__poster catalog-item__poster--skeleton" />
              </div>
              <div className="skeleton-line" />
              <div className="skeleton-line skeleton-line--short" />
            </div>
          ))}
        </div>
      )}

      {!loading && failures.length > 0 && (
        <div className="warning-banner" role="alert">
          {failures.length} addon{failures.length === 1 ? "" : "s"} failed to
          respond — showing results from the rest.
          <details>
            <summary>Details</summary>
            <ul className="failure-list">
              {failures.map((f, i) => (
                <li key={i}>
                  <strong>{f.addonName}</strong> ({f.catalogId}): {f.message}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}

      {!loading && completed && query && items.length === 0 && targets.length > 0 && (
        <div className="empty">
          No results for <strong>“{query}”</strong>.
        </div>
      )}

      {items.length > 0 && (
        <div className="poster-grid">
          {items.map((it) => (
            <CatalogItem key={`${it.type}:${it.id}`} item={it} />
          ))}
        </div>
      )}
    </div>
  );
}
