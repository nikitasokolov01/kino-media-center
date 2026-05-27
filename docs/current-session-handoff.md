# Session handoff — E3 overlay complete

Short note for the next Claude session. Read `CLAUDE.md` first, then this.

## 1. Branch
`experiment/libmpv-native`

## 2. Embedded MPV progress (all standalone stages passed on Windows)
- ✅ **B-Headless** — native libmpv loads at runtime, plays a URL, reads
  events/properties, clean exit. (`native/libmpv-poc/`)
- ✅ **R1 render-to-PNG** — libmpv render API renders one real frame offscreen
  to `frame.png`. (`native/libmpv-poc/render-poc/`)
- ✅ **R1B render-loop** — continuous loop renders many *changing* frames over
  several seconds, metrics + sample PNGs, clean exit.
  (`native/libmpv-poc/render-loop-poc/`)
- ✅ **E1 experimental Electron canvas player** — implemented in the app
  (gated). Draws libmpv frames into a `<canvas>`.
- ✅ **E1 orientation fix** — row-flip in `native/embedded-mpv/src/lib.rs`
  after `glReadPixels` corrects the upside-down image.
- ✅ **E2 real app sources** — "Play Embedded" button on direct-URL source
  cards (gated by `experimentalEmbeddedPlayer`). Clicking it dispatches a
  `PlayRequest` with `backend: "embedded-mpv-experimental"`.
- ✅ **E3 overlay + StrictMode fix** — replaces E2's separate-page navigation
  with an app-level overlay. Fixes the autostart bug caused by React 18
  StrictMode double-effect invocation. See details below.

`native/libmpv-poc/` is **frozen** as PoC history. Full history/plan is in
`docs/libmpv-native-approach-b.md`.

## 3. E3 architecture — overlay + cancelledRef

### The E2 bug (fixed in E3)
Clicking "Play Embedded" filled the URL input and showed the Stop button, but
playback never started. Root cause: React 18 StrictMode runs effects twice
(mount → cleanup → remount). The E2 `consumePendingEmbeddedPlayRequest()`
pattern broke because:
1. First effect run drained `_pending`, called `beginLoop` (started RAF)
2. StrictMode cleanup called `api.stop()` (killed native session) + cancelled RAF
3. Second effect run found `_pending = null` → nothing started
4. React state `running=true` remained, but no actual playback session

### E3 architecture (new)
- **`useEmbeddedPlayback` hook** (`src/features/player/useEmbeddedPlayback.ts`)
  owns the full IPC + RAF lifecycle. Uses a `cancelledRef` pattern:
  - `cancelledRef.current = false` at top of `startPlayback`
  - `stopPlayback` sets `cancelledRef.current = true` synchronously
  - `startPlayback` checks `cancelledRef.current` after `await api.start()`
    resolves; if true, bails out (stale first StrictMode invocation)
  - This makes StrictMode's cleanup+remount safe: the second invocation issues
    a fresh `api.start()` with no stale continuation from the first.

- **`EmbeddedPlayerOverlay`** (`src/components/EmbeddedPlayerOverlay.tsx`)
  App-level component rendered outside `.app-shell` in `App.tsx`. Renders
  null when no request is active; appears over the current page when one is.
  Subscribes to `embeddedRequest` store; its own `useEffect([req])` calls
  `startPlayback(req.streamUrl)` and returns `stopPlayback` as cleanup.
  Close button / ESC calls `clearEmbeddedPlayRequest()` → req → null → cleanup.

- **`embeddedRequest.ts`** (rewritten) — store now has:
  - `setEmbeddedPlayRequest(req)` — called by `dispatchEmbeddedExperimental`
  - `clearEmbeddedPlayRequest()` — called by overlay close/ESC
  - `getEmbeddedPlayRequest()` — synchronous getter for useState init
  - `subscribeEmbeddedPlayRequest(cb: (req | null) => void)` — notifies on both
    set AND clear

- **`dispatchEmbeddedExperimental`** in `playRequest.ts` (simplified) — now
  ONLY calls `setEmbeddedPlayRequest(req)` and returns `{ok: true}`. No
  `api.start()`, no `window.location.hash` navigation. The overlay owns IPC.

- **`ExperimentalEmbeddedPlayerPage`** (rewritten) — fully independent from
  the overlay store. Uses `useEmbeddedPlayback()` directly. The `start()`
  button calls `startPlayback(url.trim())` directly. Kept as developer test
  page on `/experimental-embedded-player`.

## 4. File map for E3

| File | Change |
|---|---|
| `src/features/player/useEmbeddedPlayback.ts` | **NEW** — hook, cancelledRef |
| `src/features/player/embeddedRequest.ts` | **REWRITTEN** — new store API |
| `src/features/player/playRequest.ts` | `dispatchEmbeddedExperimental` simplified |
| `src/pages/ExperimentalEmbeddedPlayerPage.tsx` | **REWRITTEN** — uses hook directly |
| `src/components/EmbeddedPlayerOverlay.tsx` | **NEW** — overlay component |
| `src/App.tsx` | Import + render `<EmbeddedPlayerOverlay />` outside `.app-shell` |
| `src/styles.css` | `.emb-overlay` and sub-classes added |

## 5. Experimental embedded player state (in the app, gated + isolated)
- Feature flag: **`experimentalEmbeddedPlayer`** (default **false**), stored in
  `app_settings`; toggle in Settings → "Experimental".
- Overlay: **`EmbeddedPlayerOverlay`** — rendered outside `.app-shell`, only
  visible when a PlayRequest is in the store. Triggered by StreamCard's
  "⬡ Play Embedded" button.
- Route (kept for dev): **`/experimental-embedded-player`** (+ sidebar link);
  page is now a standalone manual URL test tool, independent of the overlay.
- Native addon: **`native/embedded-mpv/`** (napi-rs; background render thread;
  `start`/`stop`/`getLatestFrame`). Built **manually/separately** (`npm install`
  + `npm run build` in that folder); **not** wired into the app's npm scripts.
  Reuses the libmpv + ANGLE DLLs in `native/embedded-mpv/vendor/`.
- IPC: channels `embedded:start|stop|get-frame` in `electron/ipc-channels.ts`;
  handlers in `electron/main.ts`; main-process module
  `electron/embeddedMpvExperimental.ts` (lazy addon load, friendly errors);
  preload bridge `window.embeddedMpv.{start,stop,getFrame}`.
- **External MPV remains the default/fallback player.**

## 6. Known issues / next steps for E4+
- No progress tracking for embedded playback (no `watch_progress` writes).
- No subtitle/audio track selection in embedded player.
- No pause/seek/volume controls (embedded IPC not wired — TODO in control bar).
- Video is 1280×720 fixed (W/H constants in `lib.rs`); dynamic resize not
  implemented.
- Frame throughput is copy-based; may be choppy at high frame rates.
- `⬡ Play Embedded` button has no dedicated CSS class yet (falls back to base
  `stream-card__action` look).
- Overlay close uses Stop semantics — consider separate Minimize in future.

## 7. Guardrails (unchanged)
- Do **not** touch normal external MPV playback (`electron/mpv.ts`,
  `electron/mpvIpc.ts`, the external-mpv dispatch path).
- Do **not** touch the source picker internals, subtitles, audio collectors,
  profiles, library, Continue Watching, source ranking, or the database.
- No debrid, no torrent, no `mpv.exe --wid`, no iframe/webview.
- Embedded is not the default; external MPV stays the default/fallback.

## 8. Build / verify reminders
- App (renderer + electron): `npm run dev` or `npm run build` from project root.
- Enforced type-check: `tsc -p electron/tsconfig.json` (electron + src/core)
  and `tsc -p tsconfig.json` (renderer). Both clean after E3.
- Embedded addon (separate): `cd native/embedded-mpv && npm install && npm run
  build`. Requires `vendor/` to have `libmpv-2.dll`, `libEGL.dll`,
  `libGLESv2.dll`.
- Sandbox note: the Linux file mirror in CI/Claude sandbox sometimes serves
  truncated copies of freshly-written files, causing bogus `tsc` errors
  ("unterminated string", "Invalid character"). Trust the real Windows files;
  run `npm run build` locally to verify.

## 9. Acceptance test for E3
1. Build the addon if needed: `cd native/embedded-mpv && npm run build`.
2. Settings → Experimental → enable **Embedded player**.
3. Open any media page. Find a direct HTTP/HTTPS source card.
4. Click **⬡ Play Embedded** on that source.
5. The overlay appears **over the current page** (no navigation). Canvas starts
   rendering the video automatically (no manual Start click needed).
6. The overlay header shows the media title.
7. Click **⏹ Stop** in the control bar → overlay closes, current page visible.
8. Press ESC → same: overlay closes.
9. Click **⬡ Play Embedded** again → overlay re-opens with fresh playback.
10. Click **▶ Play with MPV** on any source — normal external MPV playback
    still works, completely unaffected.
11. Navigate to Settings → Experimental → `/experimental-embedded-player` via
    sidebar. Paste a URL and click **▶ Start** — this test page still works
    independently of the overlay.
