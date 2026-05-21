// Registry of player backends. The shape exists so future backends (mpv-ipc,
// mpv-embedded) plug in without disturbing the call sites.
//
// Future work, deliberately NOT in this build:
// =============================================
// `mpv-ipc`:
//   Launch MPV with `--input-ipc-server=<socket>` and exchange JSON-IPC
//   commands (`{"command": ["get_property", "time-pos"]}`, etc.) over a Unix
//   socket / Windows named pipe. This unlocks pause/play/seek from the app
//   plus accurate watch-progress capture without MPV being embedded.
//
// `mpv-embedded-future`:
//   True in-window MPV requires one of:
//     (a) Native window-handle embedding (BrowserWindow.getNativeWindowHandle
//         passed to libmpv via mpv_set_option_string("wid", ...)).
//     (b) libmpv bindings via a native Node addon and rendering via the MPV
//         render API into a WebGL/<canvas> surface.
//     (c) A bespoke compositor on macOS where windowing rules differ.
//   Do NOT fake this with an iframe/webview; MPV is a native binary, not a
//   web app. The current MVP keeps MPV out-of-process via spawn() until one
//   of the above is wired.

import type { BackendCapability, PlayerBackend } from "./types.js";

export const BACKENDS: Record<PlayerBackend, BackendCapability> = {
  browser: {
    id: "browser",
    label: "Browser",
    description:
      "Built-in HTML5 video element. Good for .mp4 / .webm / HLS in a hurry, struggles with .mkv and many direct CDN streams.",
    implemented: true,
  },
  "mpv-external": {
    id: "mpv-external",
    label: "MPV (external)",
    description:
      "Launches MPV as a separate window via child_process.spawn. Plays virtually any container or codec, including .mkv.",
    implemented: true,
  },
  "mpv-ipc": {
    id: "mpv-ipc",
    label: "MPV (IPC)",
    description:
      "Future: MPV launched with --input-ipc-server so the app can pause/play/seek and persist accurate progress.",
    implemented: false,
  },
  "mpv-embedded-future": {
    id: "mpv-embedded-future",
    label: "MPV (embedded)",
    description:
      "Future: libmpv / mpv render API rendered into the app window. Requires a native addon — not in this build.",
    implemented: false,
  },
};

export function listAvailableBackends(): BackendCapability[] {
  return Object.values(BACKENDS).filter((b) => b.implemented);
}
