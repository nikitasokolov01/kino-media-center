// Public surface of the Stremio core module.
// All addon fetching/normalization/validation logic is contained here and is
// independent of Electron and the UI.

export * from "./types.js";
export { normalizeAddonUrl } from "./url.js";
export type { NormalizedAddonUrl } from "./url.js";
export { validateManifest, InvalidManifestError } from "./validate.js";
export type { ManifestValidationError } from "./validate.js";
export { fetchManifest, ManifestFetchError } from "./fetch.js";
export {
  fetchStremioCatalog,
  fetchStremioSearch,
  buildCatalogUrl,
  baseUrlFromManifestUrl,
  catalogRequiresExtras,
  catalogSupportsSkip,
  catalogSupportsSearch,
  CatalogFetchError,
} from "./catalog.js";
export type {
  FetchStremioCatalogOptions,
  FetchStremioSearchOptions,
  CatalogExtras,
} from "./catalog.js";
export {
  fetchStremioMeta,
  buildMetaUrl,
  addonSupportsResource,
  MetaFetchError,
} from "./meta.js";
export type { FetchStremioMetaOptions } from "./meta.js";
export {
  fetchStremioStreams,
  buildStreamUrl,
  streamKind,
  streamDedupKey,
  detectQuality,
  detectSize,
  detectHdr,
  detectCodec,
  StreamFetchError,
} from "./streams.js";
export type {
  FetchStremioStreamsOptions,
  StreamKind,
} from "./streams.js";
export {
  fetchStremioSubtitles,
  buildSubtitlesUrl,
  detectSubtitleFormat,
  subtitleLanguageLabel,
  subtitleDedupKey,
  SubtitleFetchError,
} from "./subtitles.js";
export type { FetchStremioSubtitlesOptions } from "./subtitles.js";

import { normalizeAddonUrl } from "./url.js";
import { fetchManifest } from "./fetch.js";
import type { StremioManifest } from "./types.js";

export interface InstallAddonResult {
  manifestUrl: string;
  baseUrl: string;
  manifest: StremioManifest;
}

/**
 * Convenience: take a user-pasted URL, normalize it, fetch + validate the
 * manifest, and return everything the storage layer needs.
 */
export async function resolveAddonFromUrl(input: string): Promise<InstallAddonResult> {
  const { manifestUrl, baseUrl } = normalizeAddonUrl(input);
  const manifest = await fetchManifest(manifestUrl);
  return { manifestUrl, baseUrl, manifest };
}
