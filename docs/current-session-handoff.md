# Session handoff — E6: YouTube/Netflix fullscreen UX

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
- ✅ **E5** — Watch progress persistence + fullscreen toggle (E5 original).
- ✅ **E5 fixes** — Fullscreen via BrowserWindow IPC, resume from saved
  progress, subtitle quality improved (1080p render FBO).
- ✅ **E6** — YouTube/Netflix UX: video fills full area, floating chrome,
  auto-hide controls after inactivity, cursor hides.

## 3. E6 changes (this session)

### Goal
Make the embedded player feel like YouTube/Netflix:
- Video uses the maximum available area at all times (including non-fullscreen).
- Aspect ratio is preserved via `object-fit:contain`.
- Header, controls, stats are floating overlays — they never push the canvas down.
- Chrome auto-hides after 2500 ms of inactivity.
- Cursor hides with chrome.
- Controls reappear on mouse move, keyboard, or pause.

### CSS changes (`src/styles.css`, embedded overlay section)

**Old layout**: `.emb-overlay` was `display:flex; flex-direction:column`. The header
was a flex child that took layout space above the canvas. Fullscreen used CSS
`:fullscreen` pseudo-class (unreliable in Electron).

**New layout**:
- `.emb-overlay` — `position:fixed; inset:0` (unchanged), no flex.
- `.emb-overlay__stage` — `position:absolute; inset:0`, fills everything.
- `.emb-overlay__canvas` — `width:100%; height:100%; object-fit:contain`.
- `.emb-overlay__header` — `position:absolute; top:0; left:0; right:0; z-index:11`
  with top gradient. Fades with `controls-hidden`.
- `.emb-overlay__errors` — `position:absolute; top:48px` always visible.
- `.emb-overlay__stats` — `position:absolute; bottom:64px; left:12px` corner HUD.
- `.emb-overlay__controls` — `position:absolute; bottom:0; left:0; right:0; z-index:11`
  with bottom gradient. Fades with `controls-hidden`.
- `.emb-overlay.controls-hidden .emb-overlay__header/controls/stats` → `opacity:0; pointer-events:none`.
- `.emb-overlay.controls-hidden` → `cursor:none`.
- `.emb-overlay.is-fullscreen` — marker class (styling only; no `:fullscreen` selectors).

### Component changes (`src/components/EmbeddedPlayerOverlay.tsx`)

**JSX structure** — header, errors, stats moved inside `emb-overlay__stage`:
```
<div.emb-overlay [rootClass]>        ← is-fullscreen, controls-hidden toggles
  <div.emb-overlay__stage>
    [loading indicator]
    <canvas />
    <div.emb-overlay__header />      ← floating top
    <div.emb-overlay__errors />      ← always-visible banners
    <div.emb-overlay__stats />       ← corner HUD
    <div.emb-overlay__controls />    ← floating bottom (when running/starting)
  </div>
</div>
```

**Auto-hide logic**:
- `controlsVisible` state → drives `controls-hidden` class on root.
- `hideTimerRef` — 2500 ms timeout; reads refs (not state) to avoid stale closures.
- `pausedRef`, `runningRef`, `draggingRef`, `isInteractingRef` — synced from state.
- `showControls()` — sets visible, schedules hide.
- `scheduleHideControls()` — clears old timer, sets new 2500 ms timer; aborts if
  `pausedRef || draggingRef || isInteractingRef || !runningRef`.
- `pinControls()` / `unpinControls()` — set `isInteractingRef`; attached to
  `onMouseEnter/onMouseLeave` and `onFocus/onBlur` on the controls div and close button.
- Root div: `onMouseMove={handleMouseActivity}`, `onMouseEnter={handleMouseActivity}`.
- Keyboard handler: calls `showControls()` on every key.
- Progress drag: calls `pinControls()` on mousedown, `unpinControls()` on mouseup;
  also sets `draggingRef.current` directly (synchronous, no React batch delay).
- `paused → true`: cancel timer, always show.
- `running → true`: show and schedule hide.
- `req → null`: cancel timer, reset visible.
- Unmount: cancel timer.

**`rootClass` computation**:
```ts
const rootClass = ["emb-overlay", isFullscreen ? "is-fullscreen" : "", !controlsVisible ? "controls-hidden" : ""]
  .filter(Boolean).join(" ");
```

**Stats HUD** — URL line removed (it's a tiny corner overlay now). Shows:
`fps · ms · drawn/skipped`.

## 4. File map (E6)

| File | Change |
|---|---|
| `src/styles.css` | Embedded overlay section rewritten: stage fills window, all chrome is `position:absolute`, auto-hide CSS, `controls-hidden` + `is-fullscreen` classes |
| `src/components/EmbeddedPlayerOverlay.tsx` | JSX restructured (all chrome inside stage); auto-hide state/refs/callbacks; `rootClass` with class toggles; `pinControls`/`unpinControls` on controls div |
| `CLAUDE.md` | Section 10 updated with E6 YouTube/Netflix UX |
| `docs/current-session-handoff.md` | This file |

## 5. Build steps

```
npm run dev    # development
npm run build  # production
```

The native Rust addon (`native/embedded-mpv/`) does NOT need a rebuild for E6
(all changes are TypeScript/CSS only).

## 6. Acceptance tests

### Video fills area (non-fullscreen)
1. Enable embedded player in Settings → Experimental.
2. Play a source via ⬡ Play Embedded.
3. Canvas fills the full window from edge to edge. ✓
4. Letterboxing visible if video AR ≠ window AR (object-fit:contain). ✓
5. Header and controls are floating overlays — they do NOT push canvas down. ✓

### Auto-hide
6. After 2.5 s of no mouse/keyboard activity, header, controls, and stats fade. ✓
7. Cursor disappears with the chrome. ✓
8. Move mouse → chrome reappears instantly. ✓
9. Pause → chrome stays visible, no auto-hide. ✓
10. Unpause → 2.5 s timer restarts. ✓
11. Hover over controls → timer paused, chrome stays. ✓
12. Mouse leaves controls → 2.5 s timer restarts. ✓
13. Drag the scrub bar → chrome stays visible throughout. ✓
14. Release scrub bar → 2.5 s timer restarts. ✓

### Fullscreen
15. Click ⤢ → fullscreen, canvas still uses object-fit:contain. ✓
16. Press Esc → exits fullscreen (overlay stays open). ✓
17. Press Esc again → overlay closes. ✓
18. Press F → toggles fullscreen. ✓
19. F11 / OS fullscreen → `is-fullscreen` class syncs via `onFullscreenChange`. ✓

## 7. Guardrails (unchanged)
- Do **not** touch `electron/mpv.ts`, `electron/mpvIpc.ts`, external-mpv path.
- Do **not** touch source picker, subtitles/audio for external MPV, profiles,
  library, Continue Watching, database, debrid/torrent.
- Embedded is **never** the default; external MPV stays the fallback.
- All embedded code gated on `experimentalEmbeddedPlayer` flag.
