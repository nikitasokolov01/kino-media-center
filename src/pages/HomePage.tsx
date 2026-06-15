import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useProfile } from "../state/ProfileContext.js";
import { useSettings } from "../state/SettingsContext.js";
import CatalogRow from "../components/CatalogRow.js";
import ContinueWatchingRow from "../components/ContinueWatchingRow.js";
import LibraryRecentRow from "../components/LibraryRecentRow.js";
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
  const { settings } = useSettings();
  const [addons, setAddons] = useState<AddonRow[]>([]);
  const [addonsLoading, setAddonsLoading] = useState(true);
  const [addonsError, setAddonsError] = useState<string | null>(null);

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

  // In catalog mode, find the matching descriptor by addonId + type + catalogId.
  // Pass it to HomeHero so it fetches only that catalog for the hero.
  const heroForcedDescriptor = useMemo(() => {
    if (settings.heroSourceMode !== "catalog") return null;
    if (!settings.heroAddonId || !settings.heroCatalogType || !settings.heroCatalogId) return null;
    return (
      descriptors.find(
        (d) =>
          d.addonId === settings.heroAddonId &&
          d.type === settings.heroCatalogType &&
          d.catalogId === settings.heroCatalogId
      ) ?? null
    );
  }, [
    settings.heroSourceMode,
    settings.heroAddonId,
    settings.heroCatalogType,
    settings.heroCatalogId,
    descriptors,
  ]);

  // Explicit boolean to avoid a truthy Profile object leaking into JSX children.
  const showHero: boolean =
    profile != null && !addonsLoading && descriptors.length > 0;

  return (
    <div className="page home-page">
      {/* Hero backdrop: full-bleed background image that fades to transparent */}
      {showHero ? (
        <HomeHero descriptors={descriptors} forcedDescriptor={heroForcedDescriptor} />
      ) : null}

      {/* Shelves wrapper: sits above the hero backdrop via z-index.
           Contains all foreground content: title, rows, errors, etc. */}
      <div className="home-shelves">
        {showHero ? null : <h1>Home</h1>}

        {profile != null ? <ContinueWatchingRow /> : null}
        {profile != null ? <LibraryRecentRow /> : null}

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
    </div>
  );
}
