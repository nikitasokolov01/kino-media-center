import type {
  MpvAvailability,
  MpvControlAction,
  MpvControlResult,
  MpvOpenResult,
  MpvPlaybackState,
  PlayableStreamPayload,
} from "../core/player/types";

export {};

declare global {
  interface Window {
    electronAPI: {
      openInMpv: (payload: PlayableStreamPayload) => Promise<MpvOpenResult>;
      checkMpvAvailable: () => Promise<MpvAvailability>;
      // Track 1: control + live state for the active external-MPV session.
      mpvControl?: (action: MpvControlAction) => Promise<MpvControlResult>;
      mpvGetState?: () => Promise<MpvPlaybackState>;
    };
  }
}