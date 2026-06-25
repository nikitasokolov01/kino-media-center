// Shared addon search helper used by the full Search page and the live navbar
// search-suggestions dropdown. Pure logic: given installed addons and a query,
// it fans out to every searchable movie/series catalog and returns deduped
// catalog items in first-seen order.

import { catalogSupportsSearch } from "../stremio/catalog.js";
import type {
  StremioCatalog,
  StremioCatalogItem,
} from "../stremio/types.js";
import type { AddonRow } from "../../types/preload.js";

export type SearchableType = "movie" | "series";

export interface SearchTarget {
  addonId: string;
  addonName: string;
  manifestUrl: string;
  type: SearchableType;
  catalogId: string;
  catalogName: string;
}

function isSearchableType(t: unknown): t is SearchableType {
  return t === "movie" || t === "series";
}

/** Every (addon, catalog) pair that can answer a movie/series search query. */
export function searchTargetsForAddons(addons: AddonRow[]): SearchTarget[] {
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
        catalogName: c.name ?? `${c.type} ${c.id}`,
      });
    }
  }
  return out;
}

export interface RunSearchOptions {
  /** Stop early / drop results when this returns true (race-safe). */
  isCancelled?: () => boolean;
  /** Cap the number of results returned (0/undefined = no cap). */
  limit?: number;
}

/**
 * Fan out a search across the given targets, dedup by `${type}:${id}`,
 * preserve first-seen order. Per-target failures are swallowed (best-effort);
 * whatever comes back from the rest is returned.
 */
export async function runAddonSearch(
  targets: SearchTarget[],
  query: string,
  opts: RunSearchOptions = {},
): Promise<StremioCatalogItem[]> {
  const q = query.trim();
  if (!q || targets.length === 0) return [];

  const seen = new Set<string>();
  const collected: StremioCatalogItem[] = [];

  const tasks = targets.map((t) =>
    window.mediaCenter.catalog
      .fetch({
        manifestUrl: t.manifestUrl,
        type: t.type,
        catalogId: t.catalogId,
        extra: { search: q },
      })
      .then((res) => {
        if (opts.isCancelled?.()) return;
        for (const m of res.metas ?? []) {
          const key = `${m.type}:${m.id}`;
          if (!seen.has(key)) {
            seen.add(key);
            collected.push(m);
          }
        }
      })
      .catch(() => {
        /* per-addon failure is non-fatal */
      }),
  );

  await Promise.allSettled(tasks);
  if (opts.isCancelled?.()) return [];
  return opts.limit && opts.limit > 0 ? collected.slice(0, opts.limit) : collected;
}
