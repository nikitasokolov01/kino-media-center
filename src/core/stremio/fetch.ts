// Fetch a manifest from a normalized URL.
// Uses global fetch (Node 18+, Electron's main process is on Node 20+).

import type { StremioManifest } from "./types.js";
import { validateManifest } from "./validate.js";

const FETCH_TIMEOUT_MS = 15_000;

export class ManifestFetchError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ManifestFetchError";
    this.status = status;
  }
}

/**
 * Fetch and validate a Stremio manifest. The URL must already be normalized
 * (use normalizeAddonUrl first).
 */
export async function fetchManifest(manifestUrl: string): Promise<StremioManifest> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(manifestUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
      redirect: "follow",
    });
  } catch (err) {
    clearTimeout(timeout);
    const msg = err instanceof Error ? err.message : String(err);
    throw new ManifestFetchError(`Failed to fetch manifest: ${msg}`);
  }
  clearTimeout(timeout);

  if (!res.ok) {
    throw new ManifestFetchError(
      `Manifest request failed: ${res.status} ${res.statusText}`,
      res.status,
    );
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ManifestFetchError(`Manifest is not valid JSON: ${msg}`);
  }

  return validateManifest(json);
}
