# Current Session Handoff — E8 Next Episode Pipeline

## Status: Complete (TypeScript clean)

---

## What Was Built

### E6 — Embedded Player YouTube/Netflix UX (complete)
- Stage fills entire window; all chrome (header, controls, stats) as `position:absolute` floating overlays
- Auto-hide after 2500ms inactivity (`controls-hidden` CSS class)
- `is-fullscreen` React class mirrors BrowserWindow fullscreen state
- Esc: first exits fullscreen, second closes overlay

### E7 — Embedded as Default Player When Flag ON (complete)
- `StreamCard`: when `experimentalEmbeddedPlayer` ON, "▶ Play" (primary) → embedded; "Open in MPV" (secondary fallback)
- `SourcesSection.handlePlayBest`: picks backend from flag
- Flag OFF: all existing MPV-primary behavior unchanged

### E8 — Next Episode Pipeline (complete)
Background source prefetching, source affinity scoring, and "Next Episode" overlay prompt for series.

---

## E8 Architecture

### New Files

#### `src/core/player/sourcePrefetch.ts`
In-memory TTL cache for pre-fetched stream sources.
- `CACHE_TTL_MS = 7 * 60 * 1000` (7 minutes)
- `Map<string, CacheEntry>` keyed by `profileId:type:mediaId:playableId`
- `inFlight: Set<string>` prevents duplicate concurrent fetches
- `makePrefetchKey(profileId, type, mediaId, playableId): string`
- `getCachedSources(key): StreamSourceResult[] | null`
- `setCachedSources(key, results): void`
- `prefetchEpisodeSources(addons, type, mediaId, playableId, profileId): void` — fire-and-forget; fans out across all addons supporting streams for the type; per-addon failures silently ignored

#### `src/core/player/sourceAffinity.ts`
Additive affinity scoring to prefer "same release pack" sources for next episode.
- `extractSourceAffinity(stream, addonId): SourceAffinity` — extracts hostname, path prefix, release group, quality, codec, HDR, season-pack from stream fields
- `scoreNextEpisodeSource(current, candidate): AffinityScore` — returns `{score, reasons[]}`
- `chooseNextEpisodeSource(currentStream, currentAddonId, candidates, settings): StreamSourceResult | null`
  - Filters to playable candidates
  - Scores all; if best >= AFFINITY_THRESHOLD (25), picks highest scorer (ties broken by quality)
  - Falls back to chooseBestSource() if no candidate reaches threshold

**Affinity weights:**
- Same addon ID: 40
- Same stream name: 30
- Same hostname: 25
- Same release group: 20
- Same path prefix: 15
- Same quality tier: 10
- Season-pack indicator: 10
- Same codec: 5
- Same HDR: 5

### Modified Files

#### `electron/ipc-channels.ts`
Added: `SeriesGetNextEpisode: "series:get-next-episode"`

#### `electron/db.ts`
Added `getNextEpisodeAfter(seriesId, currentVideoId): SeriesEpisode | null`
- Reads series_episodes for the series, filters out Season 0 specials
- Finds the current episode by videoId, returns the next one in position order
- Returns null if current is the last episode or not found

#### `electron/main.ts`
Added IPC handler for `IPC.SeriesGetNextEpisode`.

#### `electron/preload.ts`
Added `series.getNextEpisode` to contextBridge binding.

#### `src/types/preload.d.ts`
Added `SeriesNextEpisode` interface and `getNextEpisode` method to `MediaCenterApi.series`.

#### `src/components/EmbeddedPlayerOverlay.tsx`
E8 additions:
- State: nextEpisode, nextSource, nextSourceLoading, showNextEpPrompt, transitioning
- Prefetch effect: on req change for series, resolves next episode via IPC, kicks off prefetch, polls cache, runs affinity scoring
- Remaining-time effect: when timePos within 180s of duration, shows next-ep prompt
- handleNextEpisode(): builds next PlayRequest, calls setEmbeddedPlayRequest — lifecycle handles flush/stop/start
- N key shortcut triggers handleNextEpisode when prompt is visible

#### `src/styles.css`
Added .emb-overlay__next-ep and .emb-overlay__next-ep-btn styles.

---

## IPC Layer Summary (E8)

All four layers updated symmetrically:
- Channel: electron/ipc-channels.ts — SeriesGetNextEpisode
- Handler: electron/main.ts — ipcMain.handle(...)
- Binding: electron/preload.ts — series.getNextEpisode
- Type: src/types/preload.d.ts — SeriesNextEpisode + method sig

---

## Build State

- `npx tsc --noEmit` -> clean (no errors)
- No new npm dependencies added
- No database schema changes (uses existing series_episodes table)

---

## Testing / Acceptance

1. Install a series addon (e.g. Cinemeta)
2. Open a series with a cached episode list (visit Media page — episodes must load for cache to populate)
3. Start playing an episode via embedded player (flag ON)
4. With <=3 minutes remaining, the "Next Episode ->" button should appear bottom-right
5. Click it — overlay transitions to next episode, progress for current episode is saved
6. N key should also trigger the transition
7. Source should prefer the same provider/hostname as the current stream when possible
8. If next episode is the last, the button should not appear

---

## Guardrails (unchanged)

- External MPV path completely untouched
- No debrid, no torrent resolving, no hardcoded providers
- All embedded code gated on experimentalEmbeddedPlayer flag
- No SQLite schema changes; no stream URL persistence
- Source prefetch cache is in-memory only (cleared on app restart)
