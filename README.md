# Media Center App — MVP

Electron + React + TypeScript + Vite + SQLite (better-sqlite3) desktop app.

This first MVP can install Stremio-compatible addons by their base URL or
direct `manifest.json` URL, validate the manifest, and persist installed
addons per profile in SQLite. No streaming playback, no debrid, and no
hardcoded addon sources.

## Project layout

```
electron/
  main.ts            Electron main process, window + IPC handlers
  preload.ts         Typed contextBridge API exposed as window.mediaCenter
  ipc-channels.ts    Shared IPC channel names
  db.ts              SQLite schema, profile + addon storage
  tsconfig.json      tsc config for the Electron build

src/
  main.tsx           React entrypoint
  App.tsx            Sidebar + routes
  pages/
    HomePage.tsx
    AddonsPage.tsx   Paste-to-install form + installed-addon grid
  components/
    AddonCard.tsx
  state/
    ProfileContext.tsx
  core/
    stremio/         <-- isolated core module (no Electron, no UI imports)
      index.ts       resolveAddonFromUrl() + re-exports
      url.ts         normalizeAddonUrl()
      fetch.ts       fetchManifest()
      validate.ts    validateManifest() — id, name, resources, types
      types.ts
  types/
    preload.d.ts     Global typing for window.mediaCenter

vite.config.ts       Renderer build config
tsconfig.json        Renderer tsc config
index.html
package.json
```

## Install + run

Requires Node 20+ and a C++ build toolchain for `better-sqlite3` native bindings
(on Windows: install with `npm install --global windows-build-tools` or use
Visual Studio Build Tools).

```bash
npm install
npm run dev
```

`npm run dev` starts Vite on `localhost:5173`, compiles the Electron main +
preload with tsc, and launches Electron once Vite is ready.

To build a production bundle:

```bash
npm run build
npm start
```

## How addon installation works

1. User pastes any of:
   - `https://example.com/`
   - `https://example.com/path`
   - `https://example.com/path/manifest.json`
   - `stremio://example.com/manifest.json`
2. `normalizeAddonUrl` rewrites it to a canonical `manifest.json` URL and a
   trailing-slash base URL.
3. `fetchManifest` GETs the manifest with a 15s timeout.
4. `validateManifest` requires `id`, `name`, a non-empty `resources` array,
   and a non-empty `types` array. Throws `InvalidManifestError` otherwise.
5. The main process upserts the addon into SQLite, keyed by
   `(profileId, manifest.id)` — reinstalling refreshes the stored manifest.
6. The Addons page re-fetches the list and renders cards.

## Data location

SQLite database is stored in Electron's `app.getPath("userData")` directory
as `media-center.db`. WAL mode is enabled; foreign keys are on.

## Not in this MVP

- Streaming playback
- Debrid integrations
- Hardcoded addons or piracy sources
- Catalog/meta browsing UI
