# Session handoff — E4 embedded player controls complete

Read `CLAUDE.md` (section 10 especially) before making changes.

## 1. Branch
`experiment/libmpv-native`

## 2. Embedded MPV stage history
- ✅ **E1** — libmpv renders offscreen via ANGLE EGL; canvas player page.
- ✅ **E1 orientation fix** — row-flip in `native/embedded-mpv/src/lib.rs`.
- ✅ **E2** — "⬡ Play Embedded" on StreamCards; dispatch via PlayRequest boundary.
- ✅ **E3** — App-level overlay (no navigation); StrictMode-safe `cancelledRef`.
- ✅ **E4** — Full player controls: play/pause, seek, volume, subtitle/audio
  track selection, keyboard shortcuts, responsive canvas.

## 3. E4 changes (this session)

### native/embedded-mpv/src/lib.rs
- New `EmbeddedCmd` enum (SetPause, SeekAbsolute, SetVolume, SetSid, SetAid)
- New `PlaybackState` struct in `Shared` — written by render thread every ~200ms
- New `Session.cmd_tx: Sender<EmbeddedCmd>` — JS thread sends controls here
- New napi exports: `send_command(type, value)`, `get_playback_state()`
- New FFI loads: `mpv_set_property_string`, `mpv_get_property_string`, `mpv_free`
- Render loop drains `cmd_rx` each iteration; updates state on timer; refreshes
  track-list on `MPV_EVENT_FILE_LOADED`

### IPC four-layer additions
| Layer | Change |
|---|---|
| `ipc-channels.ts` | `EmbeddedCommand: "embedded:command"`, `EmbeddedGetState: "embedded:get-state"` |
| `electron/embeddedMpvExperimental.ts` | `embeddedSendCommand()`, `embeddedGetState()` |
| `electron/main.ts` | Two new `ipcMain.handle` registrations |
| `electron/preload.ts` | `embeddedMpv.command()`, `embeddedMpv.getState()` |
| `src/types/embedded-mpv.d.ts` | `EmbeddedPlaybackState`, `MpvTrack` types; two new window methods |

### src/features/player/useEmbeddedPlayback.ts (expanded)
- State polling: `useEffect([running])` → `setInterval(api.getState, 250ms)`
- Derived: `audioTracks`, `subtitleTracks` (parsed from `trackListJson`)
- Controls: `togglePause`, `seekTo`, `seekRelative`, `setVolume`,
  `setSubtitleTrack`, `setAudioTrack`
- All controls fire-and-forget via `api.command(type, value)`

### src/components/EmbeddedPlayerOverlay.tsx (rewritten)
- Full player UI with control bar **overlaid at the bottom of the stage**
- Play/pause button, progress scrubber (seek on mouseup only), volume slider
- Subtitle and audio track `<select>` menus (populated from mpv track-list)
- Keyboard shortcuts: Space=play/pause, ←/→=±5s, M=mute, Esc=close
- Dev stats strip at the very bottom (fps, getFrame ms, drawn/skipped counts)
- Canvas: `width: 100%; height: 100%; object-fit: contain` — fills stage,
  preserves 16:9 aspect ratio, letter-boxes cleanly on any window size

### src/styles.css
- Overlay CSS rewritten for E4 — control bar is `position: absolute; bottom: 0`
  overlaid on the stage with a gradient fade
- Canvas: `width: 100%; height: 100%; object-fit: contain`
- New classes: `.emb-overlay__progress`, `.emb-overlay__volume`,
  `.emb-overlay__track-select`, `.emb-overlay__time`, `.emb-overlay__ctrl--icon`

### CLAUDE.md
- Section 10 added with full embedded MPV architecture docs
- Section 1 overview updated
- Section 5 player rules updated

## 4. Build steps

### App (renderer + Electron main)
```
npm run dev          # development
npm run build        # production
```

### Native embedded addon (separate, manual)
```
cd native/embedded-mpv
npm install
npm run build
```
Requires in `native/embedded-mpv/vendor/`:
- `libmpv-2.dll`
- `libEGL.dll`
- `libGLESv2.dll`

The app loads the addon lazily — missing addon gives a graceful error, never crashes.

## 5. TypeScript verification
Both tsc checks clean on real Windows files:
- `tsc -p tsconfig.json --noEmit`
- `tsc -p electron/tsconfig.json --noEmit`

**Sandbox note**: The Linux sandbox mirror truncates freshly-written files,
causing bogus "} expected" / "'*/' expected" errors. These are NOT real. Always
trust `npm run build` on Windows, not `tsc` in the sandbox.

## 6. File map (E4)

| File | Change |
|---|---|
| `native/embedded-mpv/src/lib.rs` | Control API, state mutex, mpsc channel |
| `electron/embeddedMpvExperimental.ts` | `embeddedSendCommand`, `embeddedGetState` |
| `electron/ipc-channels.ts` | Two new channels |
| `electron/main.ts` | Two new IPC handlers |
| `electron/preload.ts` | Two new `embeddedMpv` methods |
| `src/types/embedded-mpv.d.ts` | `EmbeddedPlaybackState`, `MpvTrack`, two new methods |
| `src/features/player/useEmbeddedPlayback.ts` | State polling + all controls |
| `src/components/EmbeddedPlayerOverlay.tsx` | Full player UI |
| `src/styles.css` | Overlay CSS rewritten, canvas responsive fix |
| `CLAUDE.md` | Section 10 added |

## 7. Known limitations / TODO

- **Fixed render resolution**: 1280×720 (W/H in `lib.rs`). CSS scales visually.
- **No watch_progress** writes for embedded playback.
- **No subtitle auto-loading** from addons or OpenSubtitles. The subtitle menu
  only shows tracks mpv loaded itself (from the stream or embedded subs).
  → Document as TODO; do not touch external subtitle collector.
- **No pause IPC** for the standalone test page (`/experimental-embedded-player`).
  That page uses `useEmbeddedPlayback` directly but its Start/Stop buttons
  don't go through the overlay controls.
- **Copy-based frame transfer** (Rust → main → renderer) — may be choppy at
  high frame rates. This is a known architectural limitation of the E1 approach.
- **Seek accuracy**: mpv seek mode is "absolute" (key frames). For precise seek,
  would need "absolute-percent" or "exact" mode. Currently acceptable.
- **Volume range**: mpv allows 0–130 (130 = amplified). Slider reflects this.
- **Control bar always visible** while running. Fade-on-inactivity is a future
  polish task (not required yet).

## 8. Acceptance test for E4
1. `cd native/embedded-mpv && npm run build` if addon not built.
2. Settings → Experimental → enable **Embedded player**.
3. Open a movie media page → find a direct HTTP/HTTPS source card.
4. Click **⬡ Play Embedded** → overlay opens over current page.
5. Video starts playing automatically. Canvas fills the overlay area.
6. **Resize the app window** — video scales, preserves 16:9, no distortion. ✓
7. Click **⏸** — video pauses. Click **▶** — resumes. ✓
8. Drag/click the progress bar — video seeks on release. ✓
9. Adjust volume slider — volume changes. ✓
10. Press M — mutes (vol→0), press M again — restores. ✓
11. Press Space — play/pause toggle. ✓
12. Press ← / → — seek ±5 seconds. ✓
13. Press Esc — overlay closes, playback stops. ✓
14. If the stream has subtitle tracks, CC menu shows them; select one → subs appear.
15. If the stream has multiple audio tracks, 🎵 menu shows them; switch works.
16. Open a series episode source, click ⬡ Play Embedded — same flow works. ✓
17. **▶ Play with MPV** from any source — external MPV playback completely
    unaffected, works exactly as before. ✓
18. `/experimental-embedded-player` sidebar link (when flag on) — manual URL
    test page still works independently. ✓

## 9. Guardrails (unchanged)
- Do **not** touch `electron/mpv.ts`, `electron/mpvIpc.ts`, external-mpv path.
- Do **not** touch source picker, subtitles/audio for external MPV, profiles,
  library, Continue Watching, database, debrid/torrent.
- Embedded is **never** the default; external MPV stays the fallback.
- All embedded code gated on `experimentalEmbeddedPlayer` flag.
