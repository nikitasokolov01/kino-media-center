import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useProfile } from "../state/ProfileContext.js";
import CatalogRow from "../components/CatalogRow.js";
import ContinueWatchingRow from "../components/ContinueWatchingRow.js";
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
      // Skip catalogs that require parameters we don't supply (search, etc.)
      if (catalogRequiresExtras(c)) continue;
      out.push({
        key: `${a.id}:${c.type}:${c.id}`,
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

export default function HomePage() {
  const { profile, loading: profileLoading, error: profileError } = useProfile();
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

  return (
    <div className="page">
      <h1>Home</h1>

      {profile && <ContinueWatchingRow />}

      {profileLoading && <p className="muted">Loading profile…</p>}
      {profileError && (
        <div className="error-banner">Could not load profile: {profileError}</div>
      )}

      {profile && addonsLoading && <p className="muted">Loading addons…</p>}
      {profile && addonsError && (
        <div className="error-banner">Could not load addons: {addonsError}</div>
      )}

      {profile && !addonsLoading && addons.length === 0 && (
        <div className="empty">
          You haven't installed any addons yet.{" "}
          <Link to="/addons">Go to Addons</Link> to add one.
        </div>
      )}

      {profile && !addonsLoading && addons.length > 0 && descriptors.length === 0 && (
        <div className="empty">
          None of your installed addons expose a browsable catalog (catalogs
          that require search or other parameters are skipped).
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
