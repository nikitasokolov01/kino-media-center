# Current Session Handoff -- Home Cache, Error Panel, Episode Play Button

## Status: Complete (TypeScript clean)

---

## What Was Built This Session

### Part 1: Home catalog in-memory cache (src/core/catalog/homeCatalogCache.ts)

New module: `src/core/catalog/homeCatalogCache.ts`
- Module-level `Map<string, CacheEntry>` with 15-minute TTL.
- Key: `${profileId}:${addonId}:${type}:${catalogId}` (profile-scoped, no cross-contamination).
- Exports: `makeHomeCacheKey`, `getHomeCatalogCache`, `setHomeCatalogCache`,
  `invalidateHomeCatalogCache(profileId)`, `clearAllHomeCatalogCache`,
  `clearExpiredHomeCatalogCache`.
- TTL expiry is lazy (pruned on read, not on a timer).
- No SQLite persistence -- stream URLs expire, only metadata survives restart.

`src/components/CatalogRow.tsx` updated:
- Seeds `items` state from cache on mount (no shimmer if cache hit).
- Seeds `loading` as `false` if cache hit, `true` if miss.
- On cache hit: runs a silent background refresh -- updates cache and items on success,
  keeps old data on failure (zero visible flicker).
- On cache miss: shows shimmer, fetches, updates state and cache on success.
- Uses `useProfile()` to build the profile-scoped key.

`src/components/AddonManager.tsx` updated:
- Calls `invalidateHomeCatalogCache(profile.id)` after successful addon install.
- Calls `invalidateHomeCatalogCache(profile.id)` after successful addon remove.
- This ensures the next Home visit re-fetches fresh catalogs from new/removed addons.

### Part 2: Embedded player error panel (EmbeddedPlayerOverlay.tsx + styles.css)

Replaced the plain `<p className="emb-overlay__error">` banner with a structured
error panel:
- `<div className="emb-overlay__error-panel">` with message + three action buttons.
- **Retry**: increments `retryKey` state (added to the lifecycle effect deps) which
  re-runs the full `doStart()` async without clearing the overlay. Calls `stopPlayback()`
  first to teardown the previous attempt cleanly.
- **Open in MPV**: builds a new `PlayRequest` with `backend: "external-mpv"` by
  spreading `req` and overriding the backend field. Dispatches via `dispatchPlayRequest`,
  then calls `clearEmbeddedPlayRequest()` to close the overlay.
- **Close**: existing `handleClose` function.
- The addon-unavailable state gets the same Open in MPV + Close buttons.

New CSS classes in `styles.css`:
- `.emb-overlay__error-panel` -- centered panel with dark bg + red border
- `.emb-overlay__error-message` -- body text
- `.emb-overlay__error-actions` -- flex row of buttons
- `.emb-overlay__err-btn` -- ghost-style button (semi-transparent)
- `.emb-overlay__err-btn--primary` -- accent-tinted primary variant

### Part 3: Direct Play button on episode cards

`src/components/EpisodeSelector.tsx`:
- Added `onPlayEpisode?: (video: StremioVideo) => void` prop.
- Added `playingEpisodeId?: string | null` prop.
- Added `.episode-item__play-btn` inside each episode card's `episode-item__actions`
  div. Button shows a "Play" label (triangle + text) and switches to "Loading..."
  + disabled state when `playingEpisodeId === v.id`.
- `episode-item__actions` flex direction changed from end-justified to start-justified
  so the Play button leads, followed by Mark Watched.

`src/pages/MediaPage.tsx`:
- Added imports: `useSettings`, `chooseBestSource`, `resolveAudioLanguage`,
  `buildPlayRequest`, `dispatchPlayRequest`, `getCachedSources`, `makePrefetchKey`,
  `prefetchEpisodeSources`, `streamDedupKey`, `StremioStream`, `StreamSourceResult`.
- Added `playingEpisodeId` state (`string | null`).
- Added `handleDirectPlayEpisode(video)` async function:
  1. Guards against double-click (`playingEpisodeId === video.id`).
  2. Calls `handleEpisodeSelect(video)` to update selection immediately.
  3. If neither `autoPlayBestSource` nor `autoSelectSource` is on, returns early
     (SourcesSection handles it in manual mode; no spinner).
  4. Sets `playingEpisodeId = video.id`.
  5. Checks `getCachedSources(makePrefetchKey(...))` for instant result.
  6. On cache miss: fans out `window.mediaCenter.streams.fetch` to all eligible
     stream addons in parallel via `Promise.allSettled`.
  7. Calls `chooseBestSource(results, settings)` to pick the best stream.
  8. Builds a `PlayRequest` with the correct backend (embedded or external-mpv)
     and dispatches via `dispatchPlayRequest`.
  9. Clears `playingEpisodeId` in the `finally` block.
- Passes `onPlayEpisode={handleDirectPlayEpisode}` and `playingEpisodeId={playingEpisodeId}`
  to `EpisodeSelector`.

`src/styles.css`:
- Added `.episode-item__play-btn` and modifier classes.
- Uses `--color-accent` + CSS variable-based transparent fills; no hardcoded hex.

---

## TypeScript Status

`tsc --noEmit` passes with zero errors or warnings.

---

## Files Changed

- `src/core/catalog/homeCatalogCache.ts` (new)
- `src/components/CatalogRow.tsx` (cache integration)
- `src/components/AddonManager.tsx` (cache invalidation on install/remove)
- `src/components/EmbeddedPlayerOverlay.tsx` (error panel + retry/open-in-mpv)
- `src/components/EpisodeSelector.tsx` (onPlayEpisode prop + Play button)
- `src/pages/MediaPage.tsx` (handleDirectPlayEpisode + new imports)
- `src/styles.css` (error panel CSS + episode play button CSS)

---

## Guardrails Honored

- Native embedded MPV code (`native/`, `electron/mpv.ts`, `electron/mpvIpc.ts`) untouched.
- External MPV dispatch path unchanged.
- Debrid/torrent logic untouched.
- Profiles, library, Continue Watching, SQLite migrations untouched.
- Source ranking reused as-is via `chooseBestSource`.
- Prefetch cache reused via `getCachedSources` / `makePrefetchKey`.
