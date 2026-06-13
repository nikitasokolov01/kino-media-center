import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useProfile } from "../state/ProfileContext.js";
import CatalogRow from "../components/CatalogRow.js";
import ContinueWatchingRow from "../components/ContinueWatchingRow.js";
import HomeHero from "../components/HomeHero.js";
import type { AddonRow } from "../types/preload.js";
import { catalogRequiresExtras } from "../core/stremio/catalog.js";
import type { StremioCatalog } from "../core/stremio/types.js";

interface CatalogDescriptor {
  key: string;
  addonId: string;
  addonName: string;
  manifestUrl: string;
  type: string;
  catalogId: string;
  catalogName: string;
}

function descriptorsFromAddons(addons: AddonRow[]): CatalogDescriptor[] {
  const out: CatalogDescriptor[] = [];
  for (const a of addons) {
    const catalogs = (a.manifest.catalogs ?? []) as StremioCatalog[];
    if (!Array.isArray(catalogs)) continue;
    for (const c of catalogs) {
      if (!c || typeof c.type !== "string" || typeof c.id !== "string") continue;
      if (catalogRequiresExtras(c)) continue;
      out.push({
        key: `${a.id}:${c.type}:${c.id}`,
        addonId: a.id,
        addonName: a.manifest.name,
        manifestUrl: a.manifestUrl,
        type: c.type,
        catalogId: c.id,
        catalogName: c.name ?? `${c.type} - ${c.id}`,
      });
    }
  }
  return out;
}

export default function HomePage() {
  const { profile, loading: profileLoading, error: profileError } = useProfile();
  const [addons, setAddons] = useState<AddonRow[]>([]);
  const [addonsLoading, setAddonsLoading] = useState(true);
  const [addonsError, setAddonsError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const navigate = useNavigate();
  const searchInputRef = useRef<HTMLInputElement>(null);

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    void navigate(`/search?q=${encodeURIComponent(q)}`);
  }

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    setAddonsLoading(true);
    setAddonsError(null);
    window.mediaCenter.addons
      .list(profile.id)
      .then((rows) => {
        if (!cancelled) setAddons(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) setAddonsError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setAddonsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  const descriptors = useMemo(() => descriptorsFromAddons(addons), [addons]);

  // Explicit boolean to avoid a truthy Profile object leaking into JSX children.
  const showHero: boolean =
    profile != null && !addonsLoading && descriptors.length > 0;

  return (
    <div className="page">
      {showHero ? null : <h1>Home</h1>}

      {showHero ? <HomeHero descriptors={descriptors} /> : null}

      {/* Inline search bar */}
      {profile != null ? (
        <form className="home-search" onSubmit={handleSearch} role="search">
          <div className="home-search__inner">
            <svg
              className="home-search__icon"
              width="18"
              height="18"
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
              ref={searchInputRef}
              className="home-search__input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search movies, shows, anime..."
              autoComplete="off"
              spellCheck={false}
            />
            {searchQuery ? (
              <button
                type="button"
                className="home-search__clear"
                onClick={() => {
                  setSearchQuery("");
                  searchInputRef.current?.focus();
                }}
                aria-label="Clear search"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            ) : null}
          </div>
        </form>
      ) : null}

      {profile != null ? <ContinueWatchingRow /> : null}

      {profileLoading && <p className="muted">Loading profile...</p>}
      {profileError && (
        <div className="error-banner">Could not load profile: {profileError}</div>
      )}

      {profile && addonsLoading && <p className="muted">Loading addons...</p>}
      {profile && addonsError && (
        <div className="error-banner">Could not load addons: {addonsError}</div>
      )}

      {profile && !addonsLoading && addons.length === 0 && (
        <div className="empty">
          You have not installed any addons yet.{" "}
          <Link to="/addons">Go to Addons</Link> to add one.
        </div>
      )}

      {profile && !addonsLoading && addons.length > 0 && descriptors.length === 0 && (
        <div className="empty">
          None of your installed addons expose a browsable catalog.
        </div>
      )}

      <div className="catalog-rows">
        {descriptors.map((d) => (
          <CatalogRow
            key={d.key}
            addonId={d.addonId}
            addonName={d.addonName}
            catalogName={d.catalogName}
            type={d.type}
            catalogId={d.catalogId}
            manifestUrl={d.manifestUrl}
          />
        ))}
      </div>
    </div>
  );
}
