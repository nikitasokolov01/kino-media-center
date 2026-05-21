// Stremio meta fetching.
//
// Endpoint: `<base>/meta/<type>/<id>.json`
// The response is `{ meta: {...} }`.

import type {
  StremioManifest,
  StremioMeta,
  StremioMetaResponse,
  StremioResource,
} from "./types.js";
import { baseUrlFromManifestUrl } from "./catalog.js";

const FETCH_TIMEOUT_MS = 15_000;

export class MetaFetchError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "MetaFetchError";
    this.status = status;
  }
}

export interface FetchStremioMetaOptions {
  manifestUrl: string;
  type: string;
  id: string;
}

export function buildMetaUrl(opts: FetchStremioMetaOptions): string {
  if (!opts.type) throw new MetaFetchError("type is required");
  if (!opts.id) throw new MetaFetchError("id is required");
  const base = baseUrlFromManifestUrl(opts.manifestUrl);
  const encType = encodeURIComponent(opts.type);
  const encId = encodeURIComponent(opts.id);
  return `${base}meta/${encType}/${encId}.json`;
}

function validateMetaResponse(raw: unknown): StremioMetaResponse {
  if (!raw || typeof raw !== "object") {
    throw new MetaFetchError("Meta response is not an object");
  }
  const obj = raw as Record<string, unknown>;
  const meta = obj.meta as unknown;
  if (!meta || typeof meta !== "object") {
    throw new MetaFetchError("Meta response is missing a `meta` object");
  }
  const m = meta as Record<string, unknown>;
  if (typeof m.id !== "string" || typeof m.type !== "string" || typeof m.name !== "string") {
    throw new MetaFetchError("Meta object is missing required id/type/name fields");
  }
  return { ...obj, meta: m as unknown as StremioMeta };
}

/**
 * Fetch and validate a single meta object from a Stremio addon.
 */
export async function fetchStremioMeta(
  opts: FetchStremioMetaOptions,
): Promise<StremioMetaResponse> {
  const url = buildMetaUrl(opts);

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
    throw new MetaFetchError(`Failed to fetch meta: ${msg}`);
  }
  clearTimeout(timeout);

  if (!res.ok) {
    throw new MetaFetchError(
      `Meta request failed: ${res.status} ${res.statusText}`,
      res.status,
    );
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new MetaFetchError(`Meta is not valid JSON: ${msg}`);
  }

  return validateMetaResponse(json);
}

/**
 * True if the manifest declares support for `resourceName` for the given
 * content type.
 *
 * Stremio's `resources` array is heterogeneous: it can contain bare strings
 * (which apply to all of the manifest's `types`) or objects like
 * `{ name: "meta", types: ["movie"] }` that restrict the resource to specific
 * types.
 */
export function addonSupportsResource(
  manifest: StremioManifest,
  resourceName: string,
  type: string,
): boolean {
  const resources = manifest.resources;
  if (!Array.isArray(resources)) return false;
  const manifestTypes = Array.isArray(manifest.types) ? manifest.types : [];

  for (const r of resources as StremioResource[]) {
    if (typeof r === "string") {
      if (r === resourceName && manifestTypes.includes(type)) return true;
    } else if (r && typeof r === "object" && r.name === resourceName) {
      const types = Array.isArray(r.types) ? r.types : manifestTypes;
      if (types.includes(type)) return true;
    }
  }
  return false;
}
