// Renderer-side helpers for the MPV external backend.
//
// All the real work happens in the Electron main process — these wrappers
// just call through window.electronAPI so React components don't have to
// touch the global directly. Easier to type, easier to mock if we ever add
// tests, and one place to centralize error normalization.

import type {
  MpvAvailability,
  MpvControlAction,
  MpvControlResult,
  MpvOpenResult,
  MpvPlaybackState,
  PlayableStreamPayload,
} from "./types.js";

declare global {
  interface Window {
    electronAPI: {
      openInMpv: (payload: PlayableStreamPayload) => Promise<MpvOpenResult>;
      checkMpvAvailable: () => Promise<MpvAvailability>;
      mpvControl?: (action: MpvControlAction) => Promise<MpvControlResult>;
      mpvGetState?: () => Promise<MpvPlaybackState>;
    };
  }
}

const INACTIVE_STATE: MpvPlaybackState = {
  active: false,
  timePos: null,
  duration: null,
  paused: false,
  title: null,
  audioTracks: 0,
  currentAudioId: null,
  subTracks: 0,
  currentSubId: null,
  audioTrackList: [],
  subTrackList: [],
};

/**
 * Ask the main process to spawn MPV with this payload. Resolves with
 * `{ ok, pid?, error? }` — the renderer should display the error inline
 * (e.g. "MPV was not found"), not crash.
 */
export async function playWithMpv(
  payload: PlayableStreamPayload,
): Promise<MpvOpenResult> {
  try {
    if (!window.electronAPI?.openInMpv) {
      return {
        ok: false,
        error: "Electron MPV API is not available.",
      };
    }

    return await window.electronAPI.openInMpv(payload);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function checkMpvAvailable(): Promise<MpvAvailability> {
  try {
    if (!window.electronAPI?.checkMpvAvailable) {
      return {
        available: false,
        path: "mpv",
        error: "Electron MPV API is not available.",
      };
    }

    return await window.electronAPI.checkMpvAvailable();
  } catch (err) {
    return {
      available: false,
      path: "mpv",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Send a control action (play/pause, stop, seek, cycle audio/sub) to the active
 * external-MPV session. Never throws — resolves `{ ok:false }` if the bridge or
 * session is unavailable, so the UI can surface a soft error.
 */
export async function controlMpv(
  action: MpvControlAction,
): Promise<MpvControlResult> {
  try {
    if (!window.electronAPI?.mpvControl) {
      return { ok: false, error: "MPV control API is not available." };
    }
    return await window.electronAPI.mpvControl(action);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Poll the live state of the active external-MPV session for the Now Playing
 * bar. Returns an inactive snapshot when nothing is playing or on any error.
 */
export async function getMpvState(): Promise<MpvPlaybackState> {
  try {
    if (!window.electronAPI?.mpvGetState) return INACTIVE_STATE;
    return await window.electronAPI.mpvGetState();
  } catch {
    return INACTIVE_STATE;
  }
}