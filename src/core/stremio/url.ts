// URL handling for Stremio addons.
// The MVP accepts either a base URL or a direct manifest.json URL and normalizes
// to a canonical manifest.json URL plus a base URL.

const MANIFEST_FILENAME = "manifest.json";

export interface NormalizedAddonUrl {
  manifestUrl: string;
  baseUrl: string;
}

/**
 * Normalize a user-pasted addon URL.
 *
 * Accepts:
 *   - https://example.com/                       -> https://example.com/manifest.json
 *   - https://example.com/path                   -> https://example.com/path/manifest.json
 *   - https://example.com/path/manifest.json     -> unchanged
 *   - stremio://example.com/manifest.json        -> rewritten to https://
 *
 * Throws if the URL is malformed.
 */
export function normalizeAddonUrl(input: string): NormalizedAddonUrl {
  if (!input || typeof input !== "string") {
    throw new Error("Addon URL is required");
  }

  let raw = input.trim();
  if (raw.length === 0) {
    throw new Error("Addon URL is required");
  }

  // The Stremio ecosystem uses a `stremio://` protocol for one-click installs.
  // Treat it as HTTPS for fetching.
  if (raw.startsWith("stremio://")) {
    raw = "https://" + raw.slice("stremio://".length);
  }

  // If the user pasted a host without a scheme, assume HTTPS.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    raw = "https://" + raw;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${input}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported protocol: ${url.protocol}`);
  }

  // Strip query and hash — Stremio addon manifests don't take them.
  url.search = "";
  url.hash = "";

  // Normalize the pathname: ensure it ends with /manifest.json.
  let pathname = url.pathname || "/";
  if (pathname.endsWith("/" + MANIFEST_FILENAME)) {
    // Already a manifest URL — leave it.
  } else if (pathname.endsWith(MANIFEST_FILENAME)) {
    // Edge case: "/somethingmanifest.json" (no slash). Treat as base URL.
    pathname = pathname + "/" + MANIFEST_FILENAME;
  } else {
    if (!pathname.endsWith("/")) pathname += "/";
    pathname += MANIFEST_FILENAME;
  }

  url.pathname = pathname;
  const manifestUrl = url.toString();

  // Derive baseUrl by removing the trailing manifest.json (keep the trailing slash).
  const baseUrl = manifestUrl.slice(0, manifestUrl.length - MANIFEST_FILENAME.length);

  return { manifestUrl, baseUrl };
}
