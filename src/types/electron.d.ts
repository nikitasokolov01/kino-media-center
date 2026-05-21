// Global typing for `window.electronAPI` exposed by electron/preload.ts.
//
// This file is intentionally an **ambient** declaration (no top-level
// import/export statements). TypeScript picks up ambient `.d.ts` files
// automatically when they live under an `include`d path, so the
// `Window` augmentation below is applied project-wide without anyone
// having to import this file.
//
// Methods currently bridged from preload:
//   - openInMpv(payload)        → main:mpv:open
//   - checkMpvAvailable()       → main:mpv:check-available
//
// MPV path getter/setter are NOT separate methods on electronAPI today —
// the MPV path is part of AppSettings, persisted in SQLite, and
// read/written via `window.mediaCenter.settings.{get,update}` (typed in
// src/types/preload.d.ts). If we later split them out, add them here.

// ----- Payload + result shapes -----
// These mirror the runtime objects sent across the contextBridge. Kept
// inline (not imported) so this file stays ambient and TypeScript always
// picks up the Window augmentation, regardless of module-resolution
// quirks across the renderer/electron tsconfigs.

interface ElectronApiPlayableStreamPayload {
  type: "movie" | "series";
  mediaId: string;
  playableId: string;
  mediaTitle: string;
  episodeTitle?: string;
  season?: number;
  episode?: number;
  poster?: string;
  streamUrl: string;
  streamTitle?: string;
  streamName?: string;
  profileId?: number;
  startSeconds?: number;
  subtitleUrl?: string;
}

interface ElectronApiMpvOpenResult {
  ok: boolean;
  pid?: number;
  error?: string;
}

interface ElectronApiMpvAvailability {
  available: boolean;
  /** Resolved path used to invoke MPV (defaults to "mpv" on PATH). */
  path: string;
  /** Parsed version string from `mpv --version` when available. */
  version?: string;
  /** Error message from spawn/exit when not available. */
  error?: string;
}

interface ElectronApi {
  /**
   * Launch MPV as a detached external process for the given stream.
   * Resolves with `{ ok: true, pid }` on success or `{ ok: false, error }`
   * when MPV is missing or the URL is rejected. Never throws.
   */
  openInMpv(
    payload: ElectronApiPlayableStreamPayload,
  ): Promise<ElectronApiMpvOpenResult>;

  /**
   * Probe MPV availability by running `<mpvPath> --version` in the main
   * process. Always resolves; check `.available` on the result.
   */
  checkMpvAvailable(): Promise<ElectronApiMpvAvailability>;
}

interface Window {
  electronAPI: ElectronApi;
}

export {};

declare global {
  interface Window {
    electronAPI: {
      openInMpv: (payload: {
        url: string;
        title?: string;
        mediaTitle?: string;
        episodeTitle?: string;
      }) => Promise<{
        success: boolean;
        error?: string;
      }>;

      checkMpvAvailable: () => Promise<{
        available: boolean;
        version?: string;
        error?: string;
      }>;

      getMpvPath?: () => Promise<string>;

      setMpvPath?: (path: string) => Promise<{
        success: boolean;
        error?: string;
      }>;
    };
  }
}