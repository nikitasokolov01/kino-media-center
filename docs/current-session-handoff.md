# Session Handoff Notes

Last updated: 2026-06-18

## What was done this session

Phase 3: airing / new-episode badge. Additive, local, per-profile. No
playback/source/progress/native-MPV/ratings changes. No AniList. Verified with
`tsc` on renderer + electron (both clean). See CLAUDE.md section 18.

### New-episode badge
- New SQLite table `series_caught_up` (per profile; snapshot of the latest
  episode watched-through when caught up; movies excluded).
- IPC `caught-up:get|set|clear|badges` (four layers); `window.mediaCenter.caughtUp.*`.
- `src/core/episodes/episodeProgressState.ts`: caught-up + episode-ordering helpers.
- Snapshot is written only when the user is fully caught up (advances forward);
  marking unwatched never marks caught-up. Badge = snapshot exists AND current
  metadata shows a newer episode (season/episode, with episode-count fallback
  for anime/irregular numbering).
- Badges: Continue Watching + Library Recent corner "New"; media detail hero
  ("S8E4 Out"); episode selector header. Never on movies.
- DEV-only "Simulate new ep (dev)" button on the series page to test without a
  real airing episode.

## Files changed
- `electron/db.ts` (series_caught_up table + caught-up/badge fns/types)
- `electron/ipc-channels.ts`, `electron/main.ts` (caught-up handlers)
- `electron/preload.ts`, `src/types/preload.d.ts` (caughtUp API + types)
- `src/core/episodes/episodeProgressState.ts` (new)
- `src/pages/MediaPage.tsx` (snapshot write + hero badge + dev button + Ep label)
- `src/components/EpisodeSelector.tsx` (header badge prop)
- `src/components/ContinueWatchingRow.tsx`, `src/components/LibraryRecentRow.tsx` (card badges)
- `src/styles.css` (badge styles)

## Current state
- TypeScript: clean (renderer + electron).
- Run `npm run build` on Windows to confirm the production bundle (Linux sandbox
  cannot run the platform-native rollup binary; `tsc` is the gate here).

## Limitation
- `series_episodes` refreshes on show open, so a real airing show's badge shows
  after the episode cache next updates. Background refresh = future enhancement.

## Suggested manual test pass
1. Open an airing series, mark every episode watched -> caught-up snapshot stored.
2. Click "Simulate new ep (dev)" on that series page (dev build) -> hero shows
   "SxEy Out"; Continue Watching / Library Recent cards show a "New" corner badge.
3. Mark the (simulated) new episode watched / become caught up again -> badge clears.
4. A series you were NOT caught up on shows no badge from old unwatched episodes.
5. Movies never show the badge.
6. Continue Watching, progress/resume, ratings/export, source picker, playback
   all still work.
