// /collection/:type/:id
//
// Renders a metadata "collection" (e.g. "The Matrix Collection") as a grid of
// the movies it contains, instead of treating it as a playable movie. Member
// titles come from the addon's meta (`meta.videos`). For posters we prefer a
// member's real `poster`; when a member only exposes a low-res thumbnail (or
// nothing), we fetch that member's full movie meta and use its `meta.poster`
// so the grid matches the normal movie pages. No stream/source fetch happens.

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import BackButton from "../components/BackButton.js";
import { useProfile } from "../state/ProfileContext.js";
import CatalogItem from "../components/CatalogItem.js";
import { addonSupportsResource } from "../core/stremio/meta.js";
import { collectionMembers, type CollectionMember } from "../core/stremio/collection.js";
import { unwrapAioBlurImageUrl } from "../core/stremio/episodeImage.js";
import type { StremioCatalogItem, StremioMeta } from "../core/stremio/types.js";
import type { AddonRow } from "../types/preload.js";

// Module-level cache of resolved member posters, keyed by "type:id". Survives
// navigation so revisiting a collection doesn't refetch. null = looked up, none.
const memberPosterCache = new Map<string, string | null>();
const MEMBER_FETCH_CONCURRENCY = 5;

export default function CollectionPage() {
  const { type: rawType, id: rawId } = useParams<{ type: string; id: string }>();
  const type = decodeURIComponent(rawType ?? "");
  const id = decodeURIComponent(rawId ?? "");

  const { profile, loading: profileLoading } = useProfile();
  const [searchParams] = useSearchParams();
  const preferredAddonId = searchParams.get("addon") ?? "";

  const [addons, setAddons] = useState<AddonRow[] | null>(null);
  const [meta, setMeta] = useState<StremioMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Posters resolved by fetching member meta (keyed by "type:id").
  const [resolvedPosters, setResolvedPosters] = useState<Record<string, string>>({});
  const loggedRef = useRef(false);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    window.mediaCenter.addons
      .list(profile.id)
      .then((rows) => { if (!cancelled) setAddons(rows); })
      .catch(() => { if (!cancelled) setAddons([]); });
    return () => { cancelled = true; };
  }, [profile]);

  const eligible = useMemo(() => {
    const list = (addons ?? []).filter((a) => addonSupportsResource(a.manifest, "meta", type));
    if (preferredAddonId) {
      list.sort((a, b) => (a.id === preferredAddonId ? -1 : b.id === preferredAddonId ? 1 : 0));
    }
    return list;
  }, [addons, type, preferredAddonId]);

  // Fetch the collection meta itself.
  useEffect(() => {
    if (!profile || addons === null) return;
    let cancelled = false;
    setLoading(true);
    setMeta(null);
    setError(null);
    setResolvedPosters({});
    loggedRef.current = false;
    (async () => {
      for (const a of eligible) {
        if (cancelled) return;
        try {
          const res = await window.mediaCenter.meta.fetch({ manifestUrl: a.manifestUrl, type, id });
          if (cancelled) return;
          if (res?.meta) {
            setMeta(res.meta);
            setLoading(false);
            return;
          }
        } catch {
          /* try next addon */
        }
      }
      if (!cancelled) {
        setLoading(false);
        if (eligible.length === 0) {
          setError("None of your installed addons can describe this collection.");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [profile, addons, eligible, type, id]);

  const members: CollectionMember[] = useMemo(() => collectionMembers(meta), [meta]);

  // Resolve real posters for members that lack one: fetch the member's full
  // movie meta (limited concurrency, cached) and use meta.poster.
  useEffect(() => {
    if (members.length === 0 || eligible.length === 0) return;
    let cancelled = false;

    const needing = members.filter((m) => !m.poster);
    if (needing.length === 0) return;

    // Seed from cache first.
    const seeded: Record<string, string> = {};
    const toFetch: CollectionMember[] = [];
    for (const m of needing) {
      const key = `${m.type}:${m.id}`;
      const cached = memberPosterCache.get(key);
      if (cached === undefined) toFetch.push(m);
      else if (cached) seeded[key] = cached;
    }
    if (Object.keys(seeded).length > 0) {
      setResolvedPosters((prev) => ({ ...prev, ...seeded }));
    }

    const fetchOne = async (m: CollectionMember): Promise<void> => {
      const key = `${m.type}:${m.id}`;
      for (const a of eligible.filter((ad) => addonSupportsResource(ad.manifest, "meta", m.type))) {
        if (cancelled) return;
        try {
          const res = await window.mediaCenter.meta.fetch({ manifestUrl: a.manifestUrl, type: m.type, id: m.id });
          const rawP = res?.meta?.poster;
          if (typeof rawP === "string" && rawP.length > 0) {
            const p = unwrapAioBlurImageUrl(rawP);
            memberPosterCache.set(key, p);
            if (!cancelled) setResolvedPosters((prev) => ({ ...prev, [key]: p }));
            return;
          }
        } catch {
          /* try next addon */
        }
      }
      memberPosterCache.set(key, null); // looked up, nothing found
    };

    // Simple concurrency-limited runner.
    (async () => {
      let i = 0;
      const workers = Array.from({ length: Math.min(MEMBER_FETCH_CONCURRENCY, toFetch.length) }, async () => {
        while (!cancelled && i < toFetch.length) {
          const m = toFetch[i++];
          await fetchOne(m);
        }
      });
      await Promise.all(workers);
    })();

    return () => { cancelled = true; };
  }, [members, eligible]);

  // Build the catalog items for the grid with the best available poster:
  //   member.poster (real) -> fetched member-meta poster -> thumbnail (last).
  const items: StremioCatalogItem[] = useMemo(() => {
    return members.map((m) => {
      const key = `${m.type}:${m.id}`;
      const poster = m.poster ?? resolvedPosters[key] ?? m.thumbnail;
      return {
        id: m.id,
        type: m.type,
        name: m.name,
        poster,
        background: m.background,
        releaseInfo: m.releaseInfo,
      } as StremioCatalogItem;
    });
  }, [members, resolvedPosters]);

  // Dev-only: log one member's image fields + final chosen image source.
  useEffect(() => {
    if (!import.meta.env?.DEV || loggedRef.current || members.length === 0) return;
    loggedRef.current = true;
    const m = members[0];
    const key = `${m.type}:${m.id}`;
    // eslint-disable-next-line no-console
    console.debug("[collection-member]", {
      id: m.id, type: m.type, name: m.name,
      memberPoster: m.poster, memberThumbnail: m.thumbnail, memberBackground: m.background,
      fetchedMetaPoster: resolvedPosters[key],
      chosenImage: m.poster ?? resolvedPosters[key] ?? m.thumbnail,
      usedFullMemberMeta: !m.poster && !!resolvedPosters[key],
    });
  }, [members, resolvedPosters]);

  const title = meta?.name ?? "Collection";

  return (
    <div className="page collection-page">
      <div className="media-back">
        <BackButton />
      </div>

      <header className="collection-page__header">
        <h1 className="collection-page__title">{title}</h1>
        {meta?.description && (
          <p className="collection-page__desc">{meta.description}</p>
        )}
      </header>

      {profileLoading && <p className="muted">Loading profile...</p>}
      {profile && (addons === null || loading) && <p className="muted">Loading collection...</p>}
      {error && <div className="error-banner">{error}</div>}

      {!loading && !error && members.length === 0 && (
        <div className="empty">
          This collection does not expose individual titles through the addon.
        </div>
      )}

      {items.length > 0 && (
        <div className="poster-grid">
          {items.map((m) => (
            <CatalogItem key={`${m.type}:${m.id}`} item={m} />
          ))}
        </div>
      )}
    </div>
  );
}
