// Stremio addon manifest types.
// Reference: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/manifest.md
// Only the fields the MVP cares about are typed strictly; unknown extras are preserved as `unknown`.

export type StremioResource =
  | string
  | {
      name: string;
      types?: string[];
      idPrefixes?: string[];
    };

export interface StremioManifest {
  id: string;
  name: string;
  version?: string;
  description?: string;
  logo?: string;
  background?: string;
  resources: StremioResource[];
  types: string[];
  idPrefixes?: string[];
  catalogs?: unknown[];
  behaviorHints?: Record<string, unknown>;
  // Allow any other fields a manifest may carry without losing them.
  [key: string]: unknown;
}

export interface InstalledAddon {
  id: string;            // addon manifest id
  profileId: number;
  manifestUrl: string;   // normalized URL ending in /manifest.json
  baseUrl: string;       // origin + path without manifest.json
  manifest: StremioManifest;
  installedAt: string;   // ISO timestamp
}

// ----- Catalogs -----
// Reference: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/manifest.md#catalog-format
// and       https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/meta.md

export interface StremioCatalogExtra {
  name: string;
  isRequired?: boolean;
  options?: string[];
  optionsLimit?: number;
}

export interface StremioCatalog {
  type: string;
  id: string;
  name?: string;
  // Modern manifests use `extra: [{ name, isRequired }]`. Older ones may use
  // `extraRequired: string[]` and `extraSupported: string[]`.
  extra?: StremioCatalogExtra[];
  extraRequired?: string[];
  extraSupported?: string[];
  [key: string]: unknown;
}

export interface StremioCatalogItem {
  id: string;
  type: string;
  name: string;
  poster?: string;
  posterShape?: "square" | "regular" | "landscape" | string;
  background?: string;
  logo?: string;
  description?: string;
  releaseInfo?: string;     // e.g. "2020" or "2018-2022"
  year?: number;
  imdbRating?: string | number;
  runtime?: string;
  genres?: string[];
  [key: string]: unknown;
}

export interface StremioCatalogResponse {
  metas: StremioCatalogItem[];
  // Some addons attach extra fields (cacheMaxAge, etc.) — preserve them.
  [key: string]: unknown;
}

// ----- Meta -----
// Reference: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/meta.md

export interface StremioMetaVideo {
  id: string;
  title?: string;
  name?: string;             // some addons use `name` instead of `title`
  season?: number;
  episode?: number;
  released?: string;         // ISO date
  releaseDate?: string;      // legacy/alternate name
  overview?: string;         // legacy summary field
  description?: string;
  thumbnail?: string;
  runtime?: string;          // some addons include a per-episode runtime
  available?: boolean;
  [key: string]: unknown;
}

/**
 * Alias kept for parity with the Stremio addon SDK terminology — `videos` in a
 * meta response are documented as "videos" but in practice represent episodes
 * for series and trailers/etc. for movies.
 */
export type StremioVideo = StremioMetaVideo;

/**
 * The currently-selected playable target. The stream picker fetches sources
 * for `selected.id` using `/stream/<type>/<id>.json`. For movies, `id` is the
 * meta id; for series, `id` is the chosen video (episode) id from
 * `meta.videos`.
 */
export type SelectedPlayableItem =
  | {
      type: "movie";
      id: string;
      title: string;
    }
  | {
      type: "series";
      id: string;            // episode id from meta.videos
      title: string;
      season?: number;
      episode?: number;
    };

export interface StremioMeta {
  id: string;
  type: string;
  name: string;
  poster?: string;
  posterShape?: string;
  background?: string;
  logo?: string;
  description?: string;
  releaseInfo?: string;
  year?: number | string;
  runtime?: string;
  genres?: string[];
  cast?: string[];
  director?: string[] | string;
  writer?: string[] | string;
  imdbRating?: string | number;
  imdb_id?: string;
  country?: string;
  language?: string;
  awards?: string;
  website?: string;
  trailers?: unknown[];
  videos?: StremioMetaVideo[];
  links?: Array<{
    name: string;
    category?: string;
    url?: string;
  }>;
  [key: string]: unknown;
}

export interface StremioMetaResponse {
  meta: StremioMeta;
  [key: string]: unknown;
}

// ----- Streams -----
// Reference: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/stream.md

export interface StremioStreamSubtitle {
  id?: string;
  url?: string;
  lang?: string;
  [key: string]: unknown;
}

export interface StremioStreamBehaviorHints {
  filename?: string;
  bingeGroup?: string;
  countryWhitelist?: string[];
  notWebReady?: boolean;
  videoSize?: number;       // bytes, if the addon provides it explicitly
  videoHash?: string;
  proxyHeaders?: {
    request?: Record<string, string>;
    response?: Record<string, string>;
  };
  [key: string]: unknown;
}

export interface StremioStream {
  // Mutually-not-exclusive playable handles — at least one of these is usually
  // present:
  url?: string;
  externalUrl?: string;
  infoHash?: string;
  fileIdx?: number;
  ytId?: string;

  name?: string;          // short addon-side label (often the source group)
  title?: string;         // long descriptive title, often multi-line
  description?: string;

  thumbnail?: string;
  subtitles?: StremioStreamSubtitle[];
  sources?: string[];     // additional torrent trackers/sources

  behaviorHints?: StremioStreamBehaviorHints;

  [key: string]: unknown;
}

export interface StremioStreamResponse {
  streams: StremioStream[];
  [key: string]: unknown;
}

/**
 * A single stream merged with the addon that returned it. Used by the UI to
 * label cards with their source addon.
 */
export interface StreamSourceResult {
  stream: StremioStream;
  source: {
    addonId: string;
    addonName: string;
  };
  /** Stable key for React lists / dedup tracking. */
  key: string;
}

// ----- Subtitles -----
// Reference: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/subtitles.md
//
// The `subtitles` resource is requested at
// `<base>/subtitles/<type>/<id>.json` and returns `{ subtitles: [...] }`.
// For series, `<id>` must be the selected *episode* id from meta.videos, not
// the show id. Each track is a separate file (one language/source per entry).

export interface StremioSubtitle {
  /** Track id assigned by the addon (often the file name or an opensubtitles id). */
  id?: string;
  /** Direct URL to the subtitle file (srt/vtt/ass...). */
  url?: string;
  /** ISO-639 language code or human-readable language label. */
  lang?: string;
  /** Some addons send a display name in `name`/`title`. */
  name?: string;
  title?: string;
  /** Allow any extra fields the addon may attach without losing them. */
  [key: string]: unknown;
}

export interface StremioSubtitlesResponse {
  subtitles: StremioSubtitle[];
  // Some addons attach extra fields (cacheMaxAge, etc.) — preserve them.
  [key: string]: unknown;
}

/**
 * A single subtitle track merged with the addon that returned it. Mirrors
 * StreamSourceResult so the UI can label tracks with their source addon and
 * track a stable React/dedup key.
 */
export interface SubtitleSourceResult {
  track: StremioSubtitle;
  source: {
    addonId: string;
    addonName: string;
  };
  /** Stable key for React lists / dedup tracking. */
  key: string;
}
