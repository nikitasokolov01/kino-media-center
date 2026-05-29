// Global typing for window.mediaCenter exposed by electron/preload.ts.
// Mirrors the API shape; we hand-roll it here to avoid the renderer importing
// from the electron build output (which would cause module-system mismatch).

import type {
  StremioManifest,
  StremioCatalogResponse,
  StremioMetaResponse,
  StremioStreamResponse,
  StremioSubtitlesResponse,
} from "../core/stremio/types.js";
import type { AppSettings } from "../core/player/types.js";

export interface Profile {
  id: number;
  name: string;
  color?: string | null;
  emoji?: string | null;
  createdAt: string;
}

export interface AddonRow {
  id: string;
  profileId: number;
  manifestUrl: string;
  baseUrl: string;
  manifest: StremioManifest;
  installedAt: string;
}

export interface MediaCenterApi {
  profile: {
    getDefault: () => Promise<Profile>;
    list: () => Promise<Profile[]>;
    create: (args: {
      name: string;
      color?: string | null;
      emoji?: string | null;
    }) => Promise<Profile>;
    update: (args: {
      id: number;
      name?: string;
      color?: string | null;
      emoji?: string | null;
    }) => Promise<Profile>;
    remove: (id: number) => Promise<{ ok: boolean; error?: string }>;
  };
  addons: {
    list: (profileId: number) => Promise<AddonRow[]>;
    get: (profileId: number, id: string) => Promise<AddonRow | null>;
    install: (profileId: number, url: string) => Promise<AddonRow>;
    /** Dev-only — present at runtime only when the main process is in dev mode. */
    installFake?: (profileId: number) => Promise<AddonRow>;
    remove: (profileId: number, id: string) => Promise<boolean>;
  };
  catalog: {
    fetch: (args: {
      manifestUrl: string;
      type: string;
      catalogId: string;
      extra?: Record<string, string | number | null | undefined>;
    }) => Promise<StremioCatalogResponse>;
  };
  meta: {
    fetch: (args: {
      manifestUrl: string;
      type: string;
      id: string;
    }) => Promise<StremioMetaResponse>;
  };
  streams: {
    fetch: (args: {
      manifestUrl: string;
      type: string;
      id: string;
    }) => Promise<StremioStreamResponse>;
  };
  subtitles: {
    fetch: (args: {
      manifestUrl: string;
      type: string;
      id: string;
    }) => Promise<StremioSubtitlesResponse>;
  };
  progress: {
    upsert: (args: {
      profileId: number;
      type: "movie" | "series";
      mediaId: string;
      playableId: string;
      title: string;
      episodeTitle?: string | null;
      poster?: string | null;
      streamTitle?: string | null;
      season?: number | null;
      episode?: number | null;
      progressSeconds: number;
      durationSeconds: number;
      completed?: boolean;
    }) => Promise<WatchProgress>;
    get: (args: {
      profileId: number;
      mediaId: string;
      playableId: string;
    }) => Promise<WatchProgress | null>;
    list: (args: {
      profileId: number;
      limit?: number;
    }) => Promise<WatchProgress[]>;
    clear: (args: {
      profileId: number;
      mediaId: string;
      playableId: string;
    }) => Promise<boolean>;
    reset: (args: {
      profileId: number;
      mediaId: string;
      playableId: string;
    }) => Promise<boolean>;
  };
  watched: {
    set: (args: {
      profileId: number;
      type: "movie" | "series";
      mediaId: string;
      playableId: string;
      title: string;
      episodeTitle?: string | null;
      poster?: string | null;
      season?: number | null;
      episode?: number | null;
      completed: boolean;
    }) => Promise<WatchProgress>;
    listForMedia: (args: {
      profileId: number;
      mediaId: string;
    }) => Promise<WatchProgress[]>;
  };
  library: {
    add: (args: {
      profileId: number;
      type: string;
      mediaId: string;
      title: string;
      poster?: string | null;
      background?: string | null;
      releaseInfo?: string | null;
    }) => Promise<LibraryItem>;
    remove: (args: {
      profileId: number;
      type: string;
      mediaId: string;
    }) => Promise<boolean>;
    get: (args: {
      profileId: number;
      type: string;
      mediaId: string;
    }) => Promise<LibraryItem | null>;
    list: (args: { profileId: number }) => Promise<LibraryItem[]>;
  };
  series: {
    cacheEpisodes: (args: {
      seriesId: string;
      episodes: Array<{
        videoId: string;
        season?: number | null;
        episode?: number | null;
        title?: string | null;
      }>;
    }) => Promise<{ ok: true }>;
    libraryStatus: (args: {
      profileId: number;
      mediaId: string;
    }) => Promise<SeriesLibraryStatus>;
    /** Returns the next normal episode after currentVideoId in position order.
     *  Ignores Season 0 specials. Returns null if not found or already last. */
    getNextEpisode: (args: {
      seriesId: string;
      currentVideoId: string;
    }) => Promise<SeriesNextEpisode | null>;
  };
  system: {
    openExternal: (url: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  };
  settings: {
    get: () => Promise<AppSettings>;
    update: (patch: Partial<AppSettings>) => Promise<AppSettings>;
  };
}

// `window.electronAPI` is declared as an ambient global in
// src/types/electron.d.ts so it always augments the global Window type
// without needing an explicit import here.

export interface WatchProgress {
  profileId: number;
  type: "movie" | "series";
  mediaId: string;
  playableId: string;
  title: string;
  episodeTitle?: string | null;
  poster?: string | null;
  streamTitle?: string | null;
  season?: number | null;
  episode?: number | null;
  progressSeconds: number;
  durationSeconds: number;
  completed: boolean;
  updatedAt: string;
}

export interface LibraryItem {
  id: number;
  profileId: number;
  type: string;
  mediaId: string;
  title: string;
  poster?: string | null;
  background?: string | null;
  releaseInfo?: string | null;
  addedAt: string;
  updatedAt: string;
}

/** A single cached series episode row, returned by series.getNextEpisode(). */
export interface SeriesNextEpisode {
  videoId: string;
  season: number | null;
  episode: number | null;
  title: string | null;
  position: number;
}

export interface SeriesLibraryStatusEpisode {
  id: string;
  season?: number | null;
  episode?: number | null;
  title?: string | null;
}

export interface SeriesLibraryStatus {
  status: "not_started" | "watching" | "watched";
  watchedCount: number;
  totalCount: number;
  nextEpisode?: SeriesLibraryStatusEpisode;
  lastWatchedEpisode?: SeriesLibraryStatusEpisode;
}

declare global {
  interface Window {
    mediaCenter: MediaCenterApi;
  }
}

export {};
