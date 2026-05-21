// RETIRED (subtitles are no longer app-level sources).
//
// The pre-play subtitle picker / OpenSubtitles chooser was removed. Subtitles
// are now auto-loaded into MPV for every playable and selected from the
// in-player controls after playback starts. See:
//   - src/features/player/subtitles.ts   (headless collection)
//   - src/components/NowPlayingBar.tsx    (in-player subtitle/audio menus)
//
// This file is intentionally empty (kept only because the sandbox can't delete
// it). Nothing imports it; it renders nothing.

export {};
