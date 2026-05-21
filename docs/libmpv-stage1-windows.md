# libmpv Stage 1 — Windows availability & PoC requirements

Status: **research / documentation only. No app code touches libmpv.**
Companion to `docs/libmpv-embedded-plan.md` (see Stage 1–3 there).

This file answers three concrete questions for the Windows-first PoC:
1. Which libmpv files do we need?
2. Where do we get them on Windows?
3. What would a minimal proof-of-concept actually require?

> Verification note: parts of the "where to get them" section were confirmed
> against a live web search (May 2026); the exact archive names, versions, and
> repo activity should be re-checked at the moment of download since these
> builds are rolling/auto-generated. Items I could not re-verify live are marked
> **[verify]**.

---

## 1. Files needed on Windows

libmpv on Windows ships in two halves. For *running* we need the runtime DLL;
for *compiling a binding* we also need the dev files (headers + import lib).

**Runtime (always required):**

- `libmpv-2.dll` — the libmpv shared library (current soname is "2"). Some
  distributions/historical names use `mpv-2.dll`; current mpv shared builds
  produce **`libmpv-2.dll`**. The PoC must check for both names.
- Its transitive dependencies. mpv's Windows shared build is typically built
  with a bundled FFmpeg, so the single `libmpv-2.dll` is largely self-contained,
  but confirm no extra runtime DLLs are required for the specific build used
  **[verify per build]**.

**Development files (required to build/compile a native binding — Approach A/B):**

- Headers under `include/mpv/`:
  - `client.h` — core C API: `mpv_create`, `mpv_initialize`, `mpv_command`,
    `mpv_set_property`, `mpv_observe_property`, `mpv_wait_event`, etc.
  - `render.h` — the **modern render API** (`mpv_render_context_create`,
    `mpv_render_context_render`, `MPV_RENDER_PARAM_*`,
    `mpv_render_context_set_update_callback`).
  - `render_gl.h` — OpenGL-specific render params (`MPV_RENDER_API_TYPE_OPENGL`,
    `mpv_opengl_init_params`, `mpv_opengl_fbo`).
  - `stream_cb.h` — optional custom stream callbacks (not needed for the PoC;
    we play plain http(s) URLs).
- Import library for linking against the DLL on Windows:
  - `mpv.lib` / `libmpv.dll.a` (MSVC uses a `.lib`; MinGW uses `.dll.a`). If the
    chosen build ships only the DLL, an import lib can be generated from the
    DLL's exports (`dlltool` / `lib /def:`), matching the exact DLL filename.

**Do NOT use** the deprecated `opengl_cb.h` / `mpv_opengl_cb_*` API — it is
removed from current mpv. The PoC targets `render.h` + `render_gl.h` only. See
the plan doc §3.

---

## 2. Where to get them (Windows)

The mpv project does not publish official Windows binaries; the community
maintains rolling auto-built packages. Reputable sources:

- **SourceForge — "mpv player (Windows)" `/libmpv` folder.** Long-standing
  distribution point for `mpv-dev-*` packages (the dev archive contains
  `libmpv-2.dll`, `libmpv.dll.a`, and `include/mpv/*.h`). Look for
  `mpv-dev-x86_64-*.7z` (and `arm64` variants).
- **zhongfly/mpv-winbuild (GitHub).** GitHub Actions builds of mpv for Windows
  from the latest commit; publishes `mpv-dev-{arch}-{date}.7z` development
  packages with headers + `libmpv-2.dll` + import lib.
- **shinchiro/mpv-winbuild-cmake (GitHub).** The cmake-based Windows build
  toolchain many of the above derive from; useful reference for how the shared
  lib is produced.
- **Ivshti/libmpv (GitHub).** A small repo of libmpv `include/*` headers and the
  per-platform files needed to *link* against libmpv. Notable because Ivshti is
  associated with Stremio — directly relevant prior art for a Stremio-style app
  embedding libmpv. Good for grabbing a known-consistent header set.

**Building from source (fallback / for pinning a version):**

- mpv builds with Meson + Ninja. A shared libmpv is produced with roughly:
  `meson setup build -Dlibmpv=true -Ddefault_library=shared` then
  `ninja -C build` (target `libmpv-2.dll`). This is only needed if we want a
  specific pinned/custom build; for the PoC, a prebuilt `mpv-dev` archive is
  faster.

**Selection criteria for the PoC download:**

- x86_64 (match Electron's arch; add arm64 only if we target it).
- A recent mpv version (≥ 0.38; render API is stable and long-available).
- Dev archive (`mpv-dev-*`), not just the player, so we get headers + import lib.
- Record the exact archive name, mpv version, and FFmpeg version in the PoC
  notes so the result is reproducible.

---

## 3. What a proof-of-concept requires

Mirrors Stages 2–3 of the plan. **All of this lives outside the shipping app**
(e.g. `experiments/libmpv-poc/`) and changes no app code.

**Stage 2 — headless API PoC (no rendering):**

- A way to load `libmpv-2.dll` from Node: either a native N-API addon that
  links the import lib, or an FFI approach for a throwaway spike. (For the real
  thing we'd use a compiled addon; FFI is acceptable only for a quick "does the
  DLL load and play" probe.)
- Toolchain on Windows: **Visual Studio Build Tools** (MSVC + Windows SDK), plus
  `node-gyp` or `cmake-js` if building an addon. Python is required by node-gyp.
- Steps to prove:
  1. `mpv_create()` + `mpv_initialize()` succeed.
  2. `mpv_command(["loadfile", "<direct http(s) URL>"])` starts playback
     (audio is enough at this stage; video can be windowless/`--vo=null`).
  3. `mpv_observe_property` / `mpv_wait_event` deliver `time-pos`, `duration`,
     `pause`, `eof-reached` — proving events + properties round-trip.
  4. `mpv_set_property`/commands for pause and seek take effect.
- Exit criterion: a standalone script/binary plays a remote URL and reports live
  property changes. No app code changed.

**Stage 3 — rendering PoC (the make-or-break step):**

- Create an `mpv_render_context` with `MPV_RENDER_API_TYPE_OPENGL` and the
  `render_gl.h` init params; drive it with
  `mpv_render_context_set_update_callback` + `mpv_render_context_render`.
- Decide the realistic Windows surface path under Electron/Chromium:
  - **OpenGL via ANGLE** (Chromium's GL is ANGLE→D3D11 on Windows) — most likely
    compatible target for the GL render API.
  - **Native D3D11** surface in a child/native window.
  - **Vulkan** — almost certainly overkill for this integration.
  - **Offscreen render → texture upload** to a `<canvas>`/WebGL as a fallback
    (accepting a copy cost).
- Exit criterion: video visibly rendered through the render API, plus a written
  recommendation on the surface path. Concluding "in-renderer compositing isn't
  viable on Electron right now → stay on external MPV + improved IPC" is an
  acceptable, honest outcome.

**Hard constraints (also in plan §7):** external MPV stays the default and
fallback; MPV JSON-IPC progress tracking stays intact; no DB migrations for the
PoC; no debrid; no torrent resolving; no provider hardcoding; native code never
faked in the renderer (no iframe/webview).

---

## 4. PoC download checklist (fill in when actually doing Stage 1)

- [ ] Source used (URL): ____
- [ ] Archive name: ____  (e.g. `mpv-dev-x86_64-YYYYMMDD.7z`)
- [ ] mpv version / FFmpeg version: ____
- [ ] DLL filename present: `libmpv-2.dll` ☐  / `mpv-2.dll` ☐
- [ ] Import lib present: `mpv.lib` ☐ / `libmpv.dll.a` ☐ / generated ☐
- [ ] Headers present: `client.h` ☐ `render.h` ☐ `render_gl.h` ☐
- [ ] Extra runtime DLL dependencies (list): ____
- [ ] SHA-256 of the DLL (for provenance): ____
