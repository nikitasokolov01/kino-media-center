# Session Handoff -- 2026-06-15

## What was completed this session

### Bug Fix: Continue Watching removal for series/anime (root cause fix)

**Root cause (full analysis)**:
The previous `cw_dismissed` + `progress.revive()` fix worked correctly in concept but
failed for series because `listContinueWatching` (the IPC-wired function) NEVER filtered
by `cw_dismissed`. Two separate bugs existed:

1. `listContinueWatching` queried ALL rows (`WHERE profile_id = ? ORDER BY updated_at DESC`)
   with no `cw_dismissed` filter at all -- so the flag was completely ignored.
2. "Remove from CW" called `clearWatchProgress(profileId, mediaId, playableId)` which set
   `cw_dismissed=1` on only ONE specific episode row. For series, `listContinueWatching`
   drives the CW entry from the most-recently-updated row across ALL episodes of that series
   -- so other episode rows with `cw_dismissed=0` immediately re-surfaced the show.

Movies appeared to work because "Clear watch progress" was actually calling `resetWatchProgress`
(sets `progress_seconds=0`), and the movie branch of `listContinueWatching` checks
`row.progressSeconds >= 30` -- so 0 failed that check.

**Fix** (5 files changed):

1. **`electron/db.ts`**:
   - Fixed `listContinueWatching` `allRows` query: added `AND cw_dismissed = 0` filter.
     Now both movie and series branches naturally skip dismissed items.
   - Added `dismissMediaFromContinueWatching(profileId, mediaId)` function: sets
     `cw_dismissed=1` for ALL rows matching that `media_id` (profile-scoped). Works
     for movies (one row) and series (all episode rows) identically.

2. **`electron/ipc-channels.ts`**: Added `ProgressDismiss: "progress:dismiss"`

3. **`electron/main.ts`**: Imported `dismissMediaFromContinueWatching`, added handler
   for `IPC.ProgressDismiss` that takes `{profileId, mediaId}` (no `playableId`).

4. **`electron/preload.ts`**: Added `dismiss: (args: {profileId, mediaId}) => ...` binding.

5. **`src/types/preload.d.ts`**: Added `dismiss` to progress interface.

6. **`src/components/ContinueWatchingRow.tsx`**: Replaced the two separate context menu
   actions ("Reset Watch Progress" + "Remove from Continue Watching") with a single
   "Remove from Continue Watching" action that calls `progress.dismiss({profileId, mediaId})`.
   The local state filter now removes ALL items with matching `mediaId` (not just the
   specific `playableId`).

**Data flow after fix**:
- User right-clicks CW item -> "Remove from Continue Watching"
- `progress.dismiss({profileId, mediaId})` -> `dismissMediaFromContinueWatching` in DB
- SQL: `UPDATE watch_progress SET cw_dismissed=1 WHERE profile_id=? AND media_id=?`
  (ALL rows for that show, not just one episode)
- `listContinueWatching` now queries with `AND cw_dismissed=0` -> no rows for that show
  -> show not surfaced -> disappears completely
- When user watches again: `progress.revive({profileId, mediaId, playableId})` called
  at playback start -> `cw_dismissed=0` for that specific episode -> show reappears

**Build status**: `npm run build:electron` and `npx tsc --noEmit` both clean.

**Note on Edit tool safety**: During this session, the Edit tool was found to corrupt files
that contain em-dash (U+2014) characters ANYWHERE in the file -- even when the edit itself
doesn't touch those characters. All 5 changed files had existing em-dashes; the Edit tool
truncated or null-byte-corrupted them. All files were repaired with Python byte-level
operations. Going forward: use Python for ALL file edits in this project (not just files
where the new content contains special chars).

# Session Handoff -- 2026-06-14 (continued)

## What was completed this session

### Bug Fix 1: Global volume persistence for embedded player

**Root cause**: In `EmbeddedPlayerOverlay.tsx` `doStart`, the saved volume was stored in
`volumeRef.current`. But a `useEffect` syncs `volumeRef.current = playbackState?.volume ?? 100`
whenever `playbackState` updates. During `startPlayback`, MPV reports volume=100 via polling,
which overwrites the ref before the apply command runs -- so the apply sent 100 instead of the
saved value.

**Fix** (`src/components/EmbeddedPlayerOverlay.tsx`):
- Introduced a local `pendingVolume: number | null` variable in `doStart`
- Saved volume goes into `pendingVolume` (not `volumeRef.current`) during load
- After `startPlayback`, applies `pendingVolume` to MPV and then sets `volumeRef.current = pendingVolume`
- `pendingVolume` is a stack variable -- the `playbackState` effect can't touch it

### Bug Fix 2: New built-in themes not applying

**Root cause**: `src/theme/ThemeProvider.tsx` had a hardcoded `validThemes` array with only
the original 6 entries. The 4 new themes added in the previous session were missing, so
`validThemes.includes(themeId)` returned false and `data-theme` was removed instead of set.

**Fix** (`src/theme/ThemeProvider.tsx`):
- Added `"emerald-noir"`, `"amber-theater"`, `"arctic-blue"`, `"royal-violet"` to `validThemes`
- All 10 built-in themes are now recognized and applied correctly

### Bug Fix 3: Continue Watching removal still reappearing (definitive fix)

**Root cause**: The previous `cw_dismissed` / `resetCwDismissed` approach had a race condition.
`resetCwDismissed=true` was passed from the periodic progress-save loop on the FIRST save of
each session. If external MPV was still connecting when the user dismissed (within the first
~5s of a session), the first poll would fire AFTER the dismiss and reset `cw_dismissed=0`.

**New approach -- explicit `progress.revive()` IPC**:
- `upsertWatchProgress` (DB + IPC) no longer touches `cw_dismissed` at all. The CASE WHEN
  logic and `resetCwDismissed` field are completely removed.
- New `reviveWatchProgress()` DB function: `UPDATE SET cw_dismissed=0` for a specific row.
- New `progress:revive` IPC channel (full 4-layer: ipc-channels.ts, main.ts, preload.ts,
  preload.d.ts).
- Called ONCE when playback genuinely starts:
  - Embedded player: `window.mediaCenter.progress.revive()` in `useEmbeddedPlayback.startPlayback`
  - External MPV: `reviveWatchProgress()` in `mpvIpc.ts` `connect()` on socket connect
  - Browser player: `window.mediaCenter.progress.revive()` in `PlayerPage.tsx` `isReady` effect
- The periodic save loop and flush functions never touch `cw_dismissed`
- Result: "Remove from CW" = permanent `cw_dismissed=1`. It only resets when the user
  explicitly starts watching again (at the moment the player connects/starts).

**Files changed**:
- `electron/ipc-channels.ts` -- added `ProgressRevive`
- `electron/db.ts` -- added `reviveWatchProgress()`, removed `resetCwDismissed` from
  `UpsertWatchProgressInput` and `upsertWatchProgress` SQL
- `electron/main.ts` -- added `ProgressRevive` IPC handler, imported `reviveWatchProgress`
- `electron/preload.ts` -- added `progress.revive` binding
- `src/types/preload.d.ts` -- added `revive` to progress interface, removed `resetCwDismissed`
- `electron/mpvIpc.ts` -- removed `firstPersist`, added `reviveWatchProgress()` on connect
- `src/features/player/useEmbeddedPlayback.ts` -- removed `firstFlushRef`, added `revive()` in `startPlayback`
- `src/pages/PlayerPage.tsx` -- removed `firstSaveRef`, added `revive()` in `isReady` effect

## TypeScript status

`npx tsc --noEmit` -- zero errors after all changes.

## Build note

`npm run build` fails in the Linux sandbox (missing `@rollup/rollup-linux-x64-gnu`) -- this is
a known sandbox limitation, not a code issue. The build works on the user's Windows machine
which has `@rollup/rollup-win32-x64-msvc`.

## Next session

No pending bugs from this sprint. Potential future work:
- Subtitle auto-loading for embedded player
- Dynamic embedded render resolution
- Settings polish
- Packaging/bundling MPV with the app
