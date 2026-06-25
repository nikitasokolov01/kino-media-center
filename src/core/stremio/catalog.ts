// Stremio catalog fetching.
//
// Given an addon's manifest URL (or base URL), a content type, a catalog id,
// and optional extras (skip, genre, search, ...), request the catalog endpoint:
//
//   <base>/catalog/<type>/<id>.json                       (no extras)
//   <base>/catalog/<type>/<id>/<k1>=<v1>&<k2>=<v2>.json   (with extras)
//
// and validate the response shape.

import type {
  StremioCatalog,
  StremioCatalogItem,
  StremioCatalogResponse,
} from "./types.js";

const FETCH_TIMEOUT_MS = 15_000;
const MANIFEST_SUFFIX = "/manifest.json";

export class CatalogFetchError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "CatalogFetchError";
    this.status = status;
  }
}

/** Extras passed to a catalog request (e.g. `{ skip: 25 }`). */
export type CatalogExtras = Record<string, string | number | undefined | null>;

export interface FetchStremioCatalogOptions {
  manifestUrl: string;
  type: string;
  catalogId: string;
  extra?: CatalogExtras;
}

/**
 * Derive the addon's base URL (with a trailing slash) from either a manifest
 * URL or an already-base URL. Strips trailing `/manifest.json` if present.
 */
export function baseUrlFromManifestUrl(manifestUrl: string): string {
  if (!manifestUrl || typeof manifestUrl !== "string") {
    throw new CatalogFetchError("manifestUrl is required");
  }
  let url: URL;
  try {
    url = new URL(manifestUrl);
  } catch {
    throw new CatalogFetchError(`Invalid URL: ${manifestUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CatalogFetchError(`Unsupported protocol: ${url.protocol}`);
  }
  url.search = "";
  url.hash = "";
  if (url.pathname.endsWith(MANIFEST_SUFFIX)) {
    url.pathname = url.pathname.slice(0, url.pathname.length - MANIFEST_SUFFIX.length);
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.toString();
}

function encodeExtras(extra: CatalogExtras | undefined): string {
  if (!extra) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined || v === null || v === "") continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.join("&");
}

/**
 * Build the canonical Stremio catalog endpoint URL, including extras when
 * provided.
 */
export function buildCatalogUrl(opts: FetchStremioCatalogOptions): string {
  if (!opts.type) throw new CatalogFetchError("type is required");
  if (!opts.catalogId) throw new CatalogFetchError("catalogId is required");
  const base = baseUrlFromManifestUrl(opts.manifestUrl);
  const encType = encodeURIComponent(opts.type);
  const encId = encodeURIComponent(opts.catalogId);
  const extraStr = encodeExtras(opts.extra);
  if (extraStr.length > 0) {
    return `${base}catalog/${encType}/${encId}/${extraStr}.json`;
  }
  return `${base}catalog/${encType}/${encId}.json`;
}

function isCatalogItem(v: unknown): v is StremioCatalogItem {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.type === "string" &&
    typeof o.name === "string"
  );
}

function validateCatalogResponse(raw: unknown): StremioCatalogResponse {
  if (!raw || typeof raw !== "object") {
    throw new CatalogFetchError("Catalog response is not an object");
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.metas)) {
    throw new CatalogFetchError("Catalog response is missing a metas array");
  }
  const metas = (obj.metas as unknown[]).filter(isCatalogItem) as StremioCatalogItem[];
  return { ...obj, metas };
}

/**
 * Fetch and validate a catalog from a Stremio addon.
 *
 * The MVP also supports a legacy 3-arg positional call for backward
 * compatibility, but new code should pass an options object.
 */
export async function fetchStremioCatalog(
  opts: FetchStremioCatalogOptions,
): Promise<StremioCatalogResponse>;
export async function fetchStremioCatalog(
  manifestUrl: string,
  type: string,
  catalogId: string,
): Promise<StremioCatalogResponse>;
export async function fetchStremioCatalog(
  optsOrUrl: FetchStremioCatalogOptions | string,
  type?: string,
  catalogId?: string,
): Promise<StremioCatalogResponse> {
  const opts: FetchStremioCatalogOptions =
    typeof optsOrUrl === "string"
      ? { manifestUrl: optsOrUrl, type: type!, catalogId: catalogId! }
      : optsOrUrl;

  const url = buildCatalogUrl(opts);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
      redirect: "follow",
    });
  } catch (err) {
    clearTimeout(timeout);
    const msg = err instanceof Error ? err.message : String(err);
    throw new CatalogFetchError(`Failed to fetch catalog: ${msg}`);
  }
  clearTimeout(timeout);

  if (!res.ok) {
    throw new CatalogFetchError(
      `Catalog request failed: ${res.status} ${res.statusText}`,
      res.status,
    );
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CatalogFetchError(`Catalog is not valid JSON: ${msg}`);
  }

  return validateCatalogResponse(json);
}

/**
 * True if this catalog declares any required extras (search, genre, ...) we
 * don't supply by default. Used by the Home page to skip non-browsable rows.
 */
export function catalogRequiresExtras(catalog: StremioCatalog): boolean {
  if (Array.isArray(catalog.extra)) {
    if (catalog.extra.some((e) => e && e.isRequired)) return true;
  }
  if (Array.isArray(catalog.extraRequired) && catalog.extraRequired.length > 0) {
    return true;
  }
  return false;
}

/**
 * True if this catalog advertises support for the `search` extra — i.e. it
 * can be queried with a user-typed string.
 *
 * Stremio addons can declare extras either via `extra: [{ name, isRequired }]`
 * (modern) or via the older `extraSupported: string[]`. We accept both.
 */
export function catalogSupportsSearch(catalog: StremioCatalog): boolean {
  if (Array.isArray(catalog.extra)) {
    if (catalog.extra.some((e) => e && e.name === "search")) return true;
  }
  if (Array.isArray(catalog.extraSupported)) {
    if (catalog.extraSupported.includes("search")) return true;
  }
  return false;
}

/**
 * True if this catalog advertises support for a named extra (e.g. "genre",
 * "year"). Accepts the modern `extra: [{ name }]` shape and the older
 * `extraSupported` / `extraRequired` string arrays.
 */
export function catalogSupportsExtra(catalog: StremioCatalog, name: string): boolean {
  if (Array.isArray(catalog.extra)) {
    if (catalog.extra.some((e) => e && e.name === name)) return true;
  }
  if (Array.isArray(catalog.extraSupported) && catalog.extraSupported.includes(name)) {
    return true;
  }
  if (Array.isArray(catalog.extraRequired) && catalog.extraRequired.includes(name)) {
    return true;
  }
  return false;
}

/**
 * Return the declared `options` for a named extra (e.g. the genre list), or an
 * empty array if the catalog declares the extra without options (or not at all).
 */
export function getCatalogExtraOptions(catalog: StremioCatalog, name: string): string[] {
  if (Array.isArray(catalog.extra)) {
    const entry = catalog.extra.find((e) => e && e.name === name);
    if (entry && Array.isArray(entry.options)) {
      return entry.options.filter((o): o is string => typeof o === "string");
    }
  }
  return [];
}

/**
 * True if this catalog requires a named extra to be supplied (e.g. some genre
 * catalogs require `genre`). Used by Discover to know it must pick a default.
 */
export function catalogRequiresExtra(catalog: StremioCatalog, name: string): boolean {
  if (Array.isArray(catalog.extra)) {
    if (catalog.extra.some((e) => e && e.name === name && e.isRequired)) return true;
  }
  if (Array.isArray(catalog.extraRequired) && catalog.extraRequired.includes(name)) {
    return true;
  }
  return false;
}

/**
 * True if this catalog advertises support for the `skip` extra — i.e. the
 * addon supports pagination by skipping the first N items.
 */
export function catalogSupportsSkip(catalog: StremioCatalog): boolean {
  if (Array.isArray(catalog.extra)) {
    if (catalog.extra.some((e) => e && e.name === "skip")) return true;
  }
  if (Array.isArray(catalog.extraSupported)) {
    if (catalog.extraSupported.includes("skip")) return true;
  }
  // Some older manifests document supported extras in `extraRequired` even when
  // they aren't required — be permissive.
  if (Array.isArray(catalog.extraRequired)) {
    if (catalog.extraRequired.includes("skip")) return true;
  }
  return false;
}

// ----- Search ---------------------------------------------------------------
// Search is just a catalog request with the `search` extra populated. We keep
// a dedicated function so callers don't have to know about extras and so we
// can validate the query separately.

export interface FetchStremioSearchOptions {
  manifestUrl: string;
  type: string;
  catalogId: string;
  query: string;
}

/**
 * Run a search against a single Stremio addon catalog.
 *
 * Builds: `<base>/catalog/<type>/<catalogId>/search=<encoded-query>.json`
 *
 * The query is URL-encoded by `buildCatalogUrl` via `encodeURIComponent`, so
 * callers should pass the raw user-typed string (no manual encoding).
 */
export function fetchStremioSearch(
  opts: FetchStremioSearchOptions,
): Promise<StremioCatalogResponse> {
  if (typeof opts.query !== "string" || opts.query.trim().length === 0) {
    throw new CatalogFetchError("query is required");
  }
  return fetchStremioCatalog({
    manifestUrl: opts.manifestUrl,
    type: opts.type,
    catalogId: opts.catalogId,
    extra: { search: opts.query.trim() },
  });
}
