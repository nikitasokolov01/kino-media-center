// Catalog display-name overrides + clean-name resolution.
//
// Users can rename addon-provided catalogs/categories. Overrides are stored as
// a JSON map keyed by a stable "addonId::type::catalogId" key so renames survive
// addon reinstalls and never touch the addon manifest or the IDs used for
// requests.
//
// This module is also the single place that produces the CLEAN display name for
// normal browsing UI (Home rows, Discover, expanded catalog): addon/provider
// names are never appended here. When two visible catalogs would collapse to the
// same clean name, callers can opt into minimal disambiguation via
// resolveCatalogDisplayNames().
//
// Pure module: no React/Electron imports.

/** Stable override key. Identity only -- never used for addon requests. */
export function catalogOverrideKey(
  addonId: string,
  type: string,
  catalogId: string,
): string {
  return `${addonId}::${type}::${catalogId}`;
}

/** Parse the JSON overrides map defensively (never throws). */
export function parseCatalogOverrides(json: string | undefined | null): Record<string, string> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string" && v.trim().length > 0) out[k] = v;
      }
      return out;
    }
  } catch {
    /* malformed -- ignore */
  }
  return {};
}

export function serializeCatalogOverrides(map: Record<string, string>): string {
  return JSON.stringify(map);
}

export interface CatalogIdentity {
  addonId: string;
  type: string;
  catalogId: string;
  /** The addon-provided (original) catalog name. */
  originalName: string;
}

/** Resolve a single catalog's display name: override if set, else original. */
export function resolveCatalogName(
  identity: CatalogIdentity,
  overrides: Record<string, string>,
): string {
  const key = catalogOverrideKey(identity.addonId, identity.type, identity.catalogId);
  const override = overrides[key];
  return override && override.trim().length > 0 ? override : identity.originalName;
}

/**
 * Resolve clean display names for a list of catalogs, applying overrides and
 * minimal disambiguation: a name is left clean unless two+ visible catalogs
 * collapse to the same name, in which case only the conflicting ones get a
 * subtle " (addonName)" suffix. Returns a Map keyed by the caller's `key`.
 */
export function resolveCatalogDisplayNames<
  T extends { key: string; addonId: string; addonName: string; type: string; catalogId: string; catalogName: string },
>(items: T[], overridesJson: string | undefined | null): Map<string, string> {
  const overrides = parseCatalogOverrides(overridesJson);

  // First pass: clean name per item.
  const clean = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const it of items) {
    const name = resolveCatalogName(
      { addonId: it.addonId, type: it.type, catalogId: it.catalogId, originalName: it.catalogName },
      overrides,
    );
    clean.set(it.key, name);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  // Second pass: disambiguate only the names that collide.
  const out = new Map<string, string>();
  for (const it of items) {
    const name = clean.get(it.key) ?? it.catalogName;
    if ((counts.get(name) ?? 0) > 1) {
      out.set(it.key, `${name} (${it.addonName})`);
    } else {
      out.set(it.key, name);
    }
  }
  return out;
}
