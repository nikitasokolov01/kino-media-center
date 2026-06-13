# Current Session Handoff -- Navigation Cleanup + Appearance Settings Polish

## Status: Complete (TypeScript clean)

---

## What Was Built This Session

### Part 1: Sidebar cleanup (App.tsx)

The sidebar now shows only Home and Library nav items. Search, Addons, Settings,
and Embedded (exp) nav links are removed from the sidebar. SearchBox component is
removed from the sidebar. A gear icon (SVG) is added at the bottom of the sidebar
as a `<Link to="/settings">` with class `sidebar__gear-btn`. All routes (/addons,
/search, /settings, /experimental-embedded-player) remain intact in App.tsx Routes.

Changed structure in `src/App.tsx`:
- Added `Link` to react-router-dom imports (alongside NavLink)
- Removed `SearchBox` import
- Sidebar nav: Home + Library only
- Bottom area: `div.sidebar__bottom` containing gear link + profile switcher

### Part 2: Home page inline search bar (HomePage.tsx)

`src/pages/HomePage.tsx` now renders a styled search form between the hero banner
and the Continue Watching row. It uses `useNavigate` to push `/search?q=...` on
submit -- same destination as the old SearchBox.

New hooks/state: `searchQuery`, `navigate` (useNavigate), `searchInputRef`.
New JSX: `form.home-search > div.home-search__inner > [icon, input, clear button]`.

### Part 3/5: New CSS in styles.css

A large CSS block was appended to `src/styles.css` (via Python to avoid truncation):

- `.sidebar__bottom` -- flex column container for gear + profile switcher
- `.sidebar__gear-btn` -- icon link button, hover/active states
- `.home-search` / `.home-search__inner` / `.home-search__input` / `.home-search__icon` / `.home-search__clear` -- inline search bar styles
- Global themed controls: `input, select, textarea` inherit `--color-surface`, `--color-border`, `--color-text` with focus ring using `--color-accent`
- `.appearance-themes` / `.theme-card` / `.theme-card__*` -- theme preset cards with mini preview, active border + checkmark
- `.accent-row` / `.accent-swatch-circle` / `.accent-custom` -- circular accent color swatches
- `.poster-radius-options` / `.poster-radius-card` / `.poster-radius-card__*` -- poster roundness options with preview
- `.bg-style-options` / `.bg-style-card` / `.bg-style-card__*` -- background style tiles
- `.custom-css-textarea` / `.appearance-css-actions` / `.appearance-reset-row` -- custom CSS section
- `:root { --poster-radius: 6px; --app-bg-override: none; }` -- new CSS variables
- `body`, `.content` -- inherit `--app-bg-override` for background override

### Part 4: Redesigned AppearanceSettings.tsx

`src/pages/settings/sections/AppearanceSettings.tsx` completely rewritten with 5 sections:

**A. Theme Presets** -- Cards with mini preview (sidebar colour strip, main area with accent pill + text lines). Selected card gets accent border + checkmark badge.

**B. Accent Color** -- Circular `accent-swatch-circle` buttons (32px) for ACCENT_PRESETS, with ring indicator on selected. Custom hex input preserved.

**C. Poster Roundness** -- 4 options: Square (2px), Soft (6px), Rounded (12px), Pill (24px). Each shows a preview div with the corresponding border-radius. Saves `posterRadius` to app_settings.

**D. Background Style** -- 5 tiles: Default, OLED Black, Subtle Gradient, Neon Gradient, Custom Color. Selected gets accent border. Custom Color shows a hex input. Saves `backgroundStyle` + `customBackgroundColor`.

**E. Custom CSS** -- Styled monospace textarea with Apply CSS + Clear CSS buttons. Debounced auto-save at 600ms.

Reset section at bottom clears all appearance settings.

### Part 6: New AppSettings fields

Four new fields added across the full settings stack (types, DB, context):

| Field | Default | Description |
|-------|---------|-------------|
| `posterRadius` | `"soft"` | Poster corner radius preset |
| `backgroundStyle` | `""` | Background style override |
| `customBackgroundColor` | `""` | Custom solid bg hex color |
| `customBackgroundGradient` | `""` | Custom gradient (reserved) |

Files touched:
- `src/core/player/types.ts` -- added 4 fields to AppSettings interface
- `electron/db.ts` -- added to AppSettings interface, DEFAULTS, getAppSettings, updateAppSettings
- `src/state/SettingsContext.tsx` -- added 4 fields to FALLBACK object

### ThemeProvider.tsx: neon-midnight fix + new effects

`src/theme/ThemeProvider.tsx` rewritten cleanly (was previously not in git HEAD):

- Added `"neon-midnight"` to validThemes array (was missing, preventing the theme from applying)
- Added effect for `posterRadius`: sets `--poster-radius` on `document.documentElement`
- Added effect for `backgroundStyle` + `customBackgroundColor`: sets `--app-bg-override` on `document.documentElement`
- Helper functions `POSTER_RADIUS_MAP` and `buildBackground()` added before component

---

## Files Changed This Session

| File | Change |
|------|--------|
| `src/App.tsx` | Sidebar cleanup: removed nav items + SearchBox, added gear icon, sidebar__bottom wrapper |
| `src/pages/HomePage.tsx` | Added inline search bar with useNavigate + useRef |
| `src/styles.css` | Appended ~350 lines of new CSS (gear, search, appearance sections, CSS vars) |
| `src/pages/settings/sections/AppearanceSettings.tsx` | Full redesign: theme cards, circular swatches, poster roundness, bg style, custom CSS |
| `src/theme/ThemeProvider.tsx` | Rewritten: neon-midnight fix, posterRadius effect, backgroundStyle effect |
| `src/core/player/types.ts` | Added 4 new AppSettings fields |
| `electron/db.ts` | Added 4 new fields to AppSettings interface, DEFAULTS, getAppSettings, updateAppSettings |
| `src/state/SettingsContext.tsx` | Added 4 new fields to FALLBACK |

**Not touched:** electron/main.ts, electron/mpv.ts, electron/mpvIpc.ts, src/core/stremio/*, src/core/player/playerBackends.ts, EmbeddedPlayerOverlay.tsx, useEmbeddedPlayback.ts, native/, any IPC channels.

---

## Build State

- `npx tsc --noEmit` -- clean (no output)
- No new npm dependencies
- No new IPC channels
- No database migrations (additive SQLite key-value pairs only)

---

## CSS Variables Added

| Variable | Default | Applied by |
|----------|---------|-----------|
| `--poster-radius` | `6px` | ThemeProvider effect; applied to `.catalog-item__poster` etc. |
| `--app-bg-override` | `none` | ThemeProvider effect; applied to `body` and `.content` |

---

## How to Test Each New Feature

**Sidebar cleanup:** Sidebar should show only Home + Library. Gear icon at bottom opens /settings. /addons, /search still work via URL or internal links.

**Home search:** Type in the search bar on the Home page and press Enter or click the search icon. Should navigate to /search?q=... Clicking X clears the input.

**Appearance > Theme:** Settings -> Appearance -> Theme section. Click theme cards. Mini preview shows each theme's palette. Selected card has accent border + checkmark.

**Appearance > Accent:** Circular swatches apply immediately. Custom hex input in the same row.

**Appearance > Poster Roundness:** Square / Soft / Rounded / Pill options. Poster images on catalog cards should update corner radius immediately.

**Appearance > Background:** Default / OLED Black / Subtle Gradient / Neon Gradient / Custom Color. Body/content background changes immediately.

**Appearance > Custom CSS:** Type CSS, it auto-saves after 600ms or click Apply CSS. Click Clear CSS to reset.

---

## Known: Edit/Write tool truncation with multi-byte UTF-8

**Rule:** Never use the Edit or Write tool to write content containing em dash (U+2014),
ellipsis (U+2026), or any multi-byte UTF-8 character. The tool silently truncates.
Use bash heredoc or Python byte-level writes for all file creation/repair.

This session had multiple truncation events and required Python rewrites for:
App.tsx, types.ts, SettingsContext.tsx, ThemeProvider.tsx, HomePage.tsx.
All were reconstructed cleanly via Python.

---

## Guardrails (unchanged)

- No playback logic changes
- No embedded MPV native code changes
- No source ranking/fetching changes
- No IPC channel changes
- External MPV fallback untouched
- ThemeProvider nesting in App.tsx preserved
