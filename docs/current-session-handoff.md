# Current Session Handoff — Player UX Polish (Alpha Prep)

## Status: Complete (TypeScript clean)

---

## What Was Built This Session

### Part 1 — Remove Electron Default Menu
- `electron/main.ts`: added `Menu` to imports, called `Menu.setApplicationMenu(null)` in `app.whenReady()`.
- The native File/Edit/View/Window/Help menu bar is gone. Custom React sidebar nav is unchanged.

### Part 2 — Fix Fullscreen Stuck on Close
- `EmbeddedPlayerOverlay.tsx`: added `isFullscreenRef` (ref mirror of `isFullscreen` state).
- New effect: when `req` goes null (overlay closing for any reason), calls `window.embeddedMpv?.setFullscreen(false)` and resets `setIsFullscreen(false)`.
- Covers all close paths: close button, Esc, next-episode transition, `clearEmbeddedPlayRequest()`.

### Part 3 — Explicit Play + Sources UX (No Auto-play on Selection)
**`SourcesSection.tsx` rewritten:**
- Removed `autoPlayedSelRef` and the `autoPlayBestSource` auto-trigger effect.
- Sources still load silently in background when a selection is made.
- New **inline variant** (series episode card): `[▶ Play] [Sources ▾] [↺]` row. Play calls `handlePlayBest`; Sources toggles the list panel.
- New **full variant** (movie page): `[▶ Play Best Source] [Sources ▾] [Refresh]` row above collapsible source list.
- Both variants show the source list only when Sources button is clicked.
- `sourcesOpen` state drives panel visibility.

**`styles.css` updated:**
- `.sources__play-row`, `.sources__play-btn`, `.sources__play-btn--large`, `.sources--play-bar` added.
- `.sources__panel` (generalised from `.sources--auto .sources__panel`).
- Old `.sources__play-best` and `.sources--auto .sources__panel` removed.

### Part 4 — Embedded Player UI Polish (Netflix-style)
**`EmbeddedPlayerOverlay.tsx`:**
- Dev stats HUD hidden by default; toggle via **ⓘ button** in header. `statsVisible` state.
- Header: `title-area` (left flex) + `header-actions` (right: ⓘ stats toggle + ✕ close).
- Controls split into two rows:
  - `.emb-overlay__progress-row`: time / seek bar / duration
  - `.emb-overlay__transport`: ▶ play·pause / mute / volume / spacer / CC / audio / ⚙ source / fullscreen / ⏹ stop
- Loading: replaced text spinner with CSS `@keyframes emb-spin` animated circle + label.
- "EXPERIMENTAL" badge renamed to "BETA".

**`styles.css` updated:**
- `.emb-overlay__controls` is now `flex-direction: column` with two child rows.
- `.emb-overlay__progress-row`, `.emb-overlay__transport`, `.emb-overlay__transport-spacer`.
- `.emb-overlay__ctrl--play` (larger play button), `.emb-overlay__ctrl--ghost`, `.emb-overlay__ctrl.is-active`.
- `.emb-overlay__loading` replaced by `.emb-overlay__loading-indicator` + `.emb-overlay__spinner` + `@keyframes emb-spin`.
- `.emb-overlay__header` updated for new `header-actions` child.

### Part 5 — In-Player Source Picker Drawer
**`EmbeddedPlayerOverlay.tsx`:**
- New state: `sourcePanelOpen`, `overlayResults`, `overlayLoading`, `overlayFetchError`, `currentSourceKey`.
- `openSourcePanel()`: async; fetches all eligible addons → fans out stream requests → deduplicates → sets `overlayResults`. Uses `addonSupportsResource` + `streamDedupKey` + `window.mediaCenter.streams.fetch`.
- `handleOverlaySourceSelect(result)`: closes panel, builds new `PlayRequest` with same metadata but new stream URL, calls `setEmbeddedPlayRequest(newReq)` → lifecycle effect flushes progress + restarts with new source.
- Reset effect: when `req?.playableId` changes (episode transitions), clears `overlayResults`, closes panel, resets `currentSourceKey`.
- ⚙ button in transport row toggles panel open/close.
- Panel UI: slide-in drawer (right edge), source list with name/quality badge/addon/playing badge/best badge. Currently-playing URL matched to badge.
- `source-panel-open` class on root keeps chrome visible while panel is open.

**`styles.css`:**
- `.emb-overlay__source-panel`, `@keyframes emb-panel-in`.
- `.emb-overlay__source-panel-header`, `.emb-overlay__source-panel-title`.
- `.emb-overlay__source-list`, `.emb-overlay__source-item`, `.emb-overlay__source-item-btn`.
- `.emb-overlay__source-name`, `.emb-overlay__source-meta`, `.emb-overlay__source-quality`, `.emb-overlay__source-addon`.
- `.emb-overlay__source-badge`, `--playing`, `--best`.
- `.emb-overlay.source-panel-open` overrides controls-hidden to keep chrome visible.

**New imports added to overlay:**
- `addonSupportsResource` from `../core/stremio/meta.js`
- `streamDedupKey` from `../core/stremio/streams.js`
- `chooseBestSource`, `detectResolution` from `../core/player/sourceRanking.js`

---

## Stability Pass (same session, previous tasks #46–48)

- `useEmbeddedPlayback.ts`: `friendlyError()` helper, 30s start timeout, `beforeunload` flush, `isDev` constant.
- `EmbeddedPlayerOverlay.tsx`: global mouseup handler for scrub drag, `isDev`, better error messages.
- `sourceAffinity.ts` + `sourcePrefetch.ts`: replaced `import.meta.env.DEV` with `isDev`.

---

## Files Changed This Session

| File | Change |
|------|--------|
| `electron/main.ts` | `Menu.setApplicationMenu(null)` |
| `src/components/EmbeddedPlayerOverlay.tsx` | Fullscreen-on-close fix, source picker, UI polish, stats toggle |
| `src/components/SourcesSection.tsx` | Removed auto-play, new Play + Sources UX |
| `src/styles.css` | New source row CSS, new overlay control layout, source panel CSS |

---

## Build State

- `npx tsc --noEmit` → clean
- No new npm dependencies
- No database schema changes
- No IPC changes

---

## Guardrails (unchanged)

- External MPV path untouched
- No debrid, torrent, hardcoded providers
- All embedded code gated on `experimentalEmbeddedPlayer`
- No SQLite schema changes
- Source prefetch cache in-memory only
