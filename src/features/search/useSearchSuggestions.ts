// Live search-suggestions hook for the navbar dropdown.
//
// - Debounces the raw query (default 250ms).
// - Loads installed addons for the active profile once (cached per profile).
// - Fans out via the shared runAddonSearch helper; latest query always wins
//   (a request-id ref discards stale responses).
// - Caps results for a compact dropdown.

import { useEffect, useMemo, useRef, useState } from "react";
import { useProfile } from "../../state/ProfileContext.js";
import {
  runAddonSearch,
  searchTargetsForAddons,
} from "../../core/catalog/search.js";
import type { StremioCatalogItem } from "../../core/stremio/types.js";
import type { AddonRow } from "../../types/preload.js";

const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;
const MAX_RESULTS = 8;

export interface SearchSuggestionsState {
  items: StremioCatalogItem[];
  loading: boolean;
  /** True once a search for the current (debounced) query has completed. */
  done: boolean;
  /** The debounced query that the current items correspond to. */
  query: string;
}

export function useSearchSuggestions(rawQuery: string): SearchSuggestionsState {
  const { profile } = useProfile();
  const [addons, setAddons] = useState<AddonRow[]>([]);
  const [debounced, setDebounced] = useState("");
  const [items, setItems] = useState<StremioCatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const reqIdRef = useRef(0);

  // Load addons once per profile.
  useEffect(() => {
    if (!profile) {
      setAddons([]);
      return;
    }
    let cancelled = false;
    window.mediaCenter.addons
      .list(profile.id)
      .then((rows) => {
        if (!cancelled) setAddons(rows);
      })
      .catch(() => {
        if (!cancelled) setAddons([]);
      });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  const targets = useMemo(() => searchTargetsForAddons(addons), [addons]);

  // Debounce the raw query.
  useEffect(() => {
    const q = rawQuery.trim();
    const t = setTimeout(() => setDebounced(q), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [rawQuery]);

  // Run the search when the debounced query (or targets) changes.
  useEffect(() => {
    const q = debounced;
    if (q.length < MIN_CHARS || targets.length === 0) {
      setItems([]);
      setLoading(false);
      setDone(q.length >= MIN_CHARS); // "done with no results" when no targets
      return;
    }
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setDone(false);
    void runAddonSearch(targets, q, {
      isCancelled: () => myReq !== reqIdRef.current,
      limit: MAX_RESULTS,
    }).then((results) => {
      if (myReq !== reqIdRef.current) return; // stale
      setItems(results);
      setLoading(false);
      setDone(true);
    });
  }, [debounced, targets]);

  return { items, loading, done, query: debounced };
}
