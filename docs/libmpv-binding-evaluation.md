# libmpv binding evaluation (Approach B research)

Status: **research / documentation only. Nothing installed, nothing committed.**
Companion to `docs/libmpv-embedded-plan.md` (Approach B) and
`docs/libmpv-stage1-windows.md`.

Goal: before building our own native addon (Approach A), check whether an
existing, maintained npm/native binding could embed libmpv in our Electron 32 /
Node (current) / Windows-first app using the **modern render API**.

> Method/caveat: assessed against web searches (May 2026) plus general
> knowledge. Package "last published" ages and mechanisms below were confirmed
> via npm/GitHub search results, but **re-verify the live status before
> adopting anything** — these are fast-moving and a package could be revived.
> Items not confirmed live are marked **[verify]**.

---

## What "viable for us" means

A binding has to clear *all* of these bars to be worth adopting:

1. **Embeds libmpv** (in-process), not just spawns `mpv.exe` (we already do the
   spawn+IPC model in Track 1).
2. Uses the **modern render API** (`render.h`/`render_gl.h`), **not** the
   removed `opengl-cb`, and **not** a removed Chromium plugin mechanism.
3. Supports a **current Electron** (we're on Electron ^32) and its Node ABI —
   ideally with **prebuilt Windows binaries**, else a sane source build.
4. **Windows x64** support.
5. **Actively maintained** (recent commits/releases, responsive to Electron ABI
   bumps).

---

## Candidates

### mpv.js (Kagami/mpv.js)
- **What it is:** an mpv **Pepper/PPAPI plugin** for Electron/NW.js; ships
  prebuilt `mpvjs.node` binaries, registered via `getPluginEntry` and embedded
  with an `<embed type="application/x-mpvjs">` element.
- **Embeds libmpv?** Yes — but through Chromium's **Pepper plugin** mechanism.
- **Render API:** internally uses mpv's render path, but the *integration*
  depends on PPAPI.
- **Blocker:** **PPAPI / Pepper plugins were removed from Chromium** (~Chromium
  110, 2022). Electron 32 is on a far newer Chromium, so the plugin embed
  mechanism mpv.js relies on **no longer exists**. Also historically required
  `nodeIntegration`/relaxed sandbox flags that conflict with our hardened
  `contextIsolation: true, sandbox: false, nodeIntegration: false` setup.
- **Maintenance:** effectively stalled; forks exist (`mpv.js-vanilla`,
  `mpv.js-bumped`) but none re-architect away from PPAPI **[verify]**.
- **Verdict:** **Not viable on Electron 32.** The embedding mechanism is gone
  from modern Chromium. Do not adopt.

### node-mpv (j-holub / "node-mpv")
- **What it is:** a Node module that **spawns the mpv binary** and controls it
  over **JSON-IPC**.
- **Embeds libmpv?** **No** — it's the external-process model.
- **Maintenance:** last published ~6 years ago (v1.5.0).
- **Verdict:** **Not relevant to embedding.** It's the same architecture we
  already implemented in Track 1; offers nothing new for an in-window surface.
  Could be skimmed for IPC command ideas only.

### node-libmpv ("node-libmpv" on npm)
- **What it is:** a native C++ module that reflects the **libmpv C API**
  (`client.h`-level) in Node.
- **Embeds libmpv?** Yes (in-process C API).
- **Render API:** unclear/likely predates a clean `render.h` integration; would
  need source inspection **[verify]**. C-API control ≠ rendering integration.
- **Maintenance:** last published ~7 years ago (v1.1.8). Will not match current
  Node/Electron ABIs without rebuilding, and likely no Windows prebuilds for our
  toolchain.
- **Verdict:** **Not viable as-is** (unmaintained, ABI-stale). Of historical
  interest as a reference for how to expose the C API from a C++ addon.

### WebChimera.js / wcjs-renderer (RSATom)
- **What it is:** a native binding that renders video into a JS-accessible
  surface — but it wraps **libVLC**, **not libmpv**.
- **Verdict:** **Out of scope.** We want mpv specifically (MKV handling, the
  render API, parity with our existing MPV path). Noted only so it isn't
  mistaken for an mpv binding.

### libmpv-rs / libmpv2 (Rust crates) — not Node, but relevant to Approach A
- **What it is:** Rust bindings to libmpv, including render-API coverage.
- **Relevance:** if we build our own addon with **napi-rs** (Rust + N-API),
  these crates could back it instead of writing raw C++. This is **Approach A**
  tooling, not an off-the-shelf Node binding.
- **Verdict:** Promising *building block* for A; not a drop-in for B. Verify
  crate maintenance and render-API completeness if we go the Rust route
  **[verify]**.

### `--wid` window embedding — technique, not a package (Approach C)
- Pass `BrowserWindow.getNativeWindowHandle()` to mpv (binary or libmpv) via the
  `wid` option so mpv draws into a native child window. Historically works on
  Windows. No npm binding required, but it's the "clunky overlay" model from the
  plan (no HTML controls over the video). Useful as a Stage-2 smoke test only.

---

## Summary matrix

| Package | Embeds libmpv? | Mechanism | Modern render API? | Electron 32 / current ABI | Windows prebuilds | Maintained | Verdict |
|---|---|---|---|---|---|---|---|
| mpv.js | Yes | Chromium PPAPI plugin | n/a (PPAPI gone) | **No** (PPAPI removed) | Yes (stale) | Stalled | Not viable |
| node-mpv | No (spawns binary) | JSON-IPC | n/a | Works (it's just IPC) | n/a | ~6 yrs old | Not for embedding |
| node-libmpv | Yes | C++ C-API addon | Unclear **[verify]** | No (ABI stale) | Unlikely | ~7 yrs old | Not viable as-is |
| WebChimera.js | No (libVLC) | Native render | n/a (VLC) | **[verify]** | **[verify]** | Low | Out of scope |
| libmpv-rs/libmpv2 | Yes (Rust) | Rust bindings | Yes (render-API) **[verify]** | via napi-rs build | build it | **[verify]** | Building block for A |

---

## Conclusion & recommendation

**No off-the-shelf Node binding currently clears the bar** for embedding libmpv
in a modern Electron app on Windows with the render API:

- `mpv.js` — the only one purpose-built for Electron — depends on the
  **PPAPI plugin mechanism that modern Chromium/Electron removed**, so it's a
  dead end for Electron 32.
- `node-mpv` is the external-process model we already have (Track 1).
- `node-libmpv` is unmaintained and ABI-stale.
- The VLC-based options aren't mpv.

Therefore the realistic embedding path is **Approach A — build our own N-API
addon on the modern render API**, optionally using **napi-rs + libmpv-rs** to
avoid hand-writing C++. **Approach B should be considered closed** unless a
live re-check turns up a newly maintained, render-API, current-Electron binding
with Windows prebuilds.

**Do not install or commit any binding yet.** This stays research until you
approve moving to a PoC (plan Stages 1–3).

### Live re-verification checklist (before adopting any binding)
- [ ] Search npm for `libmpv` / `mpv render` packages updated within the last
      ~12 months.
- [ ] Confirm it uses `render.h`/`render_gl.h` (not `opengl_cb`, not PPAPI).
- [ ] Confirm prebuilds (or a clean source build) for **Electron 32's Node ABI**
      on **Windows x64**.
- [ ] Confirm it works with `contextIsolation: true` + `sandbox: false`
      (our `webPreferences`), without requiring `nodeIntegration`.
- [ ] Check issue tracker for "Electron" / "ABI" / "Windows" breakage reports.

---

## Sources
- mpv.js (GitHub): https://github.com/Kagami/mpv.js/
- mpv.js (npm): https://www.npmjs.com/package/mpv.js
- node-mpv (npm): https://www.npmjs.com/package/node-mpv
- node-libmpv (npm): https://www.npmjs.com/package/node-libmpv
- mpv-examples "Electron example" issue: https://github.com/mpv-player/mpv-examples/issues/27
- libmpv dev files / headers (Ivshti/libmpv): https://github.com/Ivshti/libmpv
- mpv Windows dev builds (zhongfly): https://github.com/zhongfly/mpv-winbuild
- mpv Windows builds (SourceForge): https://sourceforge.net/projects/mpv-player-windows/files/libmpv/
