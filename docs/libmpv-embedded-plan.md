# libmpv Embedded Player — Research & Proof-of-Concept Plan (Windows-first)

Status: **research / planning only. No libmpv code has been written.**
Owner decision required before any implementation begins (see §9).

Companion docs:
- `docs/libmpv-stage1-windows.md` — Windows file requirements, where to get
  them, and PoC requirements (Stage 1–3 detail).
- `docs/libmpv-binding-evaluation.md` — evaluation of existing npm/native
  bindings (Approach B research).

This document proposes how the Media Center App *could* gain a true in-window
("embedded") video player built on **libmpv**, without disturbing the current,
working **external MPV** playback path. It is deliberately conservative: the
external player stays the default and the only shipping playback method until a
libmpv path is proven stable behind a feature flag.

---

## 1. Why this document exists

The current player launches `mpv.exe` as a **separate OS window** via
`child_process.spawn` (see `electron/mpv.ts`) and tracks progress over JSON-IPC
(`electron/mpvIpc.ts`). That works well and plays virtually any container/codec,
including MKV. The downside is that video plays in a detached MPV window, not
inside the app — so there is no in-app overlay, no unified UI, and window
management is outside our control.

A "true embedded" player would render video **inside the Electron app window**.
The only realistic native route for that is **libmpv** (mpv compiled as a
library). This document scopes that work as research + a staged PoC, with hard
guarantees that the existing player is never removed or downgraded.

The codebase already anticipates this: `src/core/player/types.ts` defines a
`PlayerBackend` union that includes `"mpv-embedded-future"`, and
`src/core/player/playerBackends.ts` registers it as `implemented: false` with
notes describing exactly the native-addon / render-API approaches below. This
plan turns those notes into an actionable, staged investigation.

---

## 2. libmpv is NOT the same as launching mpv.exe

This distinction is the crux of the whole effort.

**`mpv.exe` external player — the current, working method.**
We spawn the standalone MPV binary as a child process. MPV creates and owns its
own window, decodes, renders, and handles input entirely on its own. We
communicate with it only over a text JSON-IPC pipe. We ship nothing native of
our own; the user installs MPV and we point at the binary. This is what
`electron/mpv.ts` does today and it must keep working.

**`libmpv` — a native library embedded into the app.**
libmpv is mpv's core compiled as a shared library (`mpv-2.dll` / `libmpv-2.dll`
on Windows) with a C API exposed through `client.h` and `render.h`. Instead of
spawning a process, our code would **load the DLL into our own process**, create
an `mpv_handle`, set properties, send commands, pump events, and — critically —
**render the video ourselves** into a surface we control. There is no separate
MPV window; the video frames are ours to composite.

**libmpv requires native bindings + rendering integration.**
Two hard problems come with libmpv that the external player never had:

1. **Native bindings.** Node/Electron's renderer is JavaScript. libmpv is a C
   library. Bridging them requires a **native Node addon** (N-API / node-addon-api
   or a prebuilt binding) that maps the C API to JS. This addon must be compiled
   for the exact Electron ABI and platform.
2. **Rendering integration.** libmpv does not "just draw into a div." We must
   give it a GPU surface or pump rendered frames through the
   **mpv render API** (`mpv/render.h` + `render_gl.h`). Getting those frames onto
   the screen inside an Electron/Chromium window is the genuinely hard part and
   the main risk of this whole effort.

In short: external MPV is *interprocess and hands-off*; libmpv is *in-process and
hands-on*, and the "hands-on" part means C-level bindings and a real GPU
rendering path.

---

## 3. Modern render API vs. deprecated opengl-cb

We will target the **modern mpv render API only**: `mpv/render.h` together with
`mpv/render_gl.h` (`MPV_RENDER_API_TYPE_OPENGL`), using
`mpv_render_context_create`, `mpv_render_context_render`, the
`MPV_RENDER_PARAM_*` parameter blocks, and the
`mpv_render_context_set_update_callback` for frame-ready signaling.

The **old `opengl-cb` API** (`mpv/opengl_cb.h`, `mpv_get_sub_api`,
`MPV_SUB_API_OPENGL_CB`) is **deprecated and removed** from current mpv. Any
tutorial, Stack Overflow answer, or npm binding that uses `opengl_cb` /
`mpv_opengl_cb_*` is obsolete and must not be copied. If a candidate npm binding
is built on `opengl-cb`, that alone disqualifies it for new work.

The render API is **output-backend-agnostic at the mpv layer** but we still must
choose a concrete GPU surface on our side (OpenGL, ANGLE/D3D, etc.). That choice
is the subject of Stage 3.

---

## 4. Possible implementation approaches for Electron

Four approaches are on the table. They are not mutually exclusive — D is a
hedge that should proceed regardless, and A/B/C are competing routes to true
embedding.

### Approach A — Native Node addon wrapping libmpv (build our own)

We write a small N-API addon (node-addon-api) that links against libmpv, exposes
`create handle / set property / command / observe property / pump events`, and
implements the render API hookup. Distributed as a prebuilt binary per platform
(prebuildify / prebuild-install) so end users don't compile anything.

- **Pros:** Full control over the exact API surface we expose; we can pin to the
  modern render API and avoid dead code; no dependency on an unmaintained third
  party; can be tuned to our payload shape (`PlayableStreamPayload`); cleanest
  long-term fit with the existing main-process MPV ownership rule.
- **Cons:** We own a C/C++ codebase and its build matrix; requires native
  toolchain knowledge (node-gyp / cmake-js, Visual Studio Build Tools on
  Windows); ABI rebuilds needed on every Electron major bump; the render hookup
  is non-trivial engineering.
- **Risk level:** **High** (build/maintenance burden + rendering integration).
- **Required dependencies:** `node-addon-api` / N-API, `cmake-js` or `node-gyp`,
  Visual Studio Build Tools + Windows SDK, libmpv dev files (`client.h`,
  `render.h`, `render_gl.h`, import lib), prebuild tooling for shipping binaries.
- **Packaging concerns:** Must ship the compiled `.node` for the user's
  Electron ABI + arch; must bundle/locate `mpv-2.dll`; electron-builder
  `extraResources` + `asarUnpack` for the native module; code-signing the DLL/
  addon on Windows to avoid SmartScreen friction.
- **Windows-first feasibility:** **Good.** Windows is mpv's best-supported libmpv
  target and prebuilt libmpv dev packages exist (see §6/Stage 1). The toolchain
  is well-trodden. This is the most controllable route once the rendering
  question (Stage 3) is answered.

### Approach B — Existing npm / native libmpv binding (reuse, only if viable)

Use a maintained npm package that already wraps libmpv (e.g. node bindings that
expose mpv handles and/or render hooks). Adopt **only** if it is actively
maintained, uses the **modern render API (not opengl-cb)**, supports current
Electron ABIs, and ships Windows prebuilds.

- **Pros:** Potentially huge time savings; someone else owns the C glue; faster
  to a working Stage 2 PoC if a good one exists.
- **Cons:** The ecosystem here is thin and historically **stale** — many
  bindings are abandoned, target old Node/Electron ABIs, are
  Linux/X11-centric, or are built on the deprecated `opengl-cb`. A binding that
  embeds video by passing a window handle (`--wid`) is a different (and weaker)
  model than the render API. Supply-chain/trust risk for a native module that
  runs in-process.
- **Risk level:** **Medium-High** (mostly *availability* risk — a suitable
  binding may simply not exist; if it does, risk drops to Medium).
- **Required dependencies:** the chosen npm package + its libmpv runtime; same
  Windows libmpv DLL bundling as A.
- **Packaging concerns:** Same DLL bundling as A, plus we inherit whatever
  packaging assumptions the binding makes; must verify its prebuilds match our
  Electron version or we fall back to compiling it ourselves anyway.
- **Windows-first feasibility:** **Uncertain — depends entirely on the package.**
  Must be validated in Stage 1/2 against a real candidate. Treat as
  "evaluate, don't assume."

### Approach C — Separate native helper window/process embedding libmpv

Run libmpv in a **dedicated native helper** (a small native app/window, or a
child Electron `BrowserWindow` whose native window handle is handed to mpv via
`--wid` / `mpv_set_option_string("wid", ...)`), positioned/overlaid to look
in-app. This is "window embedding," not render-API compositing.

- **Pros:** Avoids the hardest render-API GPU work; mpv owns its own surface and
  just draws into the handle we give it; conceptually simpler to get *a* picture
  on screen; isolates native crashes from the main renderer if a separate
  process.
- **Cons:** Overlaying a native child window on top of Chromium content is
  fragile — z-order, DPI scaling, resize sync, fullscreen, and rounded corners
  all fight you; our HTML overlay controls can't easily draw *over* the video;
  not a true composited surface so UI integration stays clunky; multi-window
  lifecycle/focus bugs are common.
- **Risk level:** **Medium** for first picture-on-screen, **High** for a polished
  result.
- **Required dependencies:** libmpv DLL; a way to obtain the native window handle
  (`BrowserWindow.getNativeWindowHandle()`); minimal/no custom native code if
  using `--wid`.
- **Packaging concerns:** Bundle `mpv-2.dll`; if a separate helper executable,
  ship and sign it too; simpler than A on the addon front.
- **Windows-first feasibility:** **Moderate.** `--wid` embedding has historically
  worked on Windows, but the overlay-control limitation undercuts the whole
  reason for embedding. Useful as a fast "does libmpv play in our process at
  all" smoke test (Stage 2), less attractive as the final architecture.

### Approach D — Keep external MPV, improve IPC controls (the safe hedge)

Do **not** embed at all yet. Instead, extend the already-wired JSON-IPC channel
(`electron/mpvIpc.ts`) so the app can pause/play/seek and read richer state from
the external MPV window — closing much of the UX gap without any native code.
This corresponds to the existing `"mpv-ipc"` backend (`implemented: false`
today).

- **Pros:** **Zero native code, zero new packaging risk;** builds directly on a
  channel we already maintain; immediately useful; cannot break the default
  player; great fallback to ship while A/B/C are researched.
- **Cons:** Video still lives in a separate MPV window — not truly embedded; no
  in-window overlay; doesn't satisfy the end goal of an in-app surface.
- **Risk level:** **Low.**
- **Required dependencies:** none new (uses existing `net` IPC + MPV).
- **Packaging concerns:** none new.
- **Windows-first feasibility:** **High** — the named-pipe IPC already runs on
  Windows (`\\.\pipe\...` in `makePipeName()`).

---

## 5. Comparison at a glance

| Approach | What it is | Risk | Native code? | New packaging risk | Windows-first | Achieves true embed? |
|---|---|---|---|---|---|---|
| A. Own Node addon | Build N-API wrapper + render API | High | Yes (C/C++) | High | Good | Yes |
| B. Existing npm binding | Reuse maintained libmpv binding | Med-High* | Yes (theirs) | Medium | Uncertain | Yes (if it exists) |
| C. Helper window (`--wid`) | mpv draws into a native handle | Med→High | Little/none | Medium | Moderate | Partial / clunky |
| D. External + better IPC | Extend current JSON-IPC | Low | No | None | High | No (but best fallback) |

\* B's risk is dominated by whether a suitable, modern, maintained binding
actually exists.

---

## 6. Staged plan

Each stage is a gate. We do not advance until the previous stage's exit
criterion is met, and **every stage keeps the external MPV player fully
functional**.

### Stage 0 — External MPV remains the default (no change)

- The current `mpv-external` backend stays the default/fallback and the only
  shipping playback path.
- Nothing in `electron/mpv.ts`, `electron/mpvIpc.ts`, the source picker, or
  library/profile/Continue-Watching logic is touched.
- **Exit criterion:** confirmed baseline — app builds and external MPV plays as
  before. (This is already true today.)

### Stage 1 — Verify libmpv availability on Windows

Goal: confirm we can obtain the libmpv runtime + dev files on Windows before
writing any code.

- Locate and document a source for the libmpv **runtime**: `mpv-2.dll` (current
  naming) or `libmpv-2.dll`, plus its dependencies. Note that recent mpv Windows
  shared builds (e.g. the community `mpv-dev` / shinchiro builds) package the DLL
  + import library + headers.
- Locate the **dev headers**: `mpv/client.h`, `mpv/render.h`, and
  `mpv/render_gl.h`, plus the import library (`mpv.lib` / `libmpv.dll.a`).
- Record exact filenames, versions, and DLL dependencies (this informs Stage 2
  loading and §7 packaging).
- **Exit criterion:** we have a documented, reproducible way to get
  `mpv-2.dll` + `client.h` + `render.h` (+ `render_gl.h`) for Windows x64, with
  versions noted.

### Stage 2 — Minimal native PoC, OUTSIDE the main app

Goal: prove we can drive libmpv at all, with **no rendering yet** and **no
integration into the app**. This lives in a throwaway sandbox (e.g.
`experiments/libmpv-poc/`), never imported by the shipping build.

- Load `mpv-2.dll` and create an `mpv_handle` (`mpv_create` + `mpv_initialize`).
- Load a **direct HTTP/HTTPS** video URL (audio-only or windowless is fine here)
  via the `loadfile` command.
- Prove **events and properties** work: observe `time-pos`, `duration`,
  `pause`, `eof-reached`; send `set_property` (pause/seek) and confirm responses.
- This validates the binding/ABI and the C API surface independent of the
  rendering question.
- **Exit criterion:** a standalone script/binary loads libmpv, plays/seeks a
  remote URL, and reports live property changes. No app code changed.

### Stage 3 — Prove rendering (the make-or-break stage)

Goal: get **actual video frames on screen** via the **modern render API**, and
decide the realistic surface path inside Electron.

- Stand up an `mpv_render_context` with `MPV_RENDER_API_TYPE_OPENGL`, wire
  `mpv_render_context_set_update_callback`, and render with
  `mpv_render_context_render` into a GL framebuffer.
- Evaluate, for Electron/Chromium on Windows, which surface path is realistic:
  - **OpenGL via ANGLE** (Chromium's GL is ANGLE-on-D3D11 on Windows) — likely
    the most compatible target for the GL render API; investigate sharing/blitting
    into a texture we can present.
  - **Native D3D11** surface in a child/native window.
  - **Vulkan** — generally overkill/unrealistic for this integration.
  - **Offscreen render → texture upload** to a `<canvas>`/WebGL as a fallback,
    accepting a copy cost.
- Decide explicitly: is in-renderer compositing viable, or do we fall back to the
  Approach C helper-window model?
- **Exit criterion:** video visibly rendered through the render API in a test
  surface, with a written recommendation on the surface path (and an honest
  "embedding is not viable in Electron right now → stay on D" verdict is an
  acceptable outcome).

### Stage 4 — Experimental player backend behind a feature flag

Goal: introduce the backend into the app **without making it reachable by
default**.

- Flip `src/core/player/playerBackends.ts` to register a backend whose id is
  **`"libmpv-experimental"`** (add this to the `PlayerBackend` union in
  `src/core/player/types.ts`). Keep `implemented` gated behind a flag so it never
  appears for normal users.
- Gate it behind a **Settings toggle / feature flag** (e.g. an
  `experimentalLibmpv` flag in `app_settings`, defaulting off). When off, the app
  behaves exactly as today.
- The libmpv code path is fully **opt-in**; selecting it never disables or
  replaces `mpv-external`.
- **Exit criterion:** with the flag off (default) the app is byte-for-byte the
  current behavior; with the flag on, an experimental libmpv backend is
  selectable and plays a stream in a contained view, with external MPV still
  selectable as fallback.

### Stage 5 — Integrate (only if Stage 4 proves stable)

Goal: bring the experimental backend up to feature parity, one capability at a
time, only after it's demonstrably stable.

- **Progress tracking** — reuse the existing `watch_progress` model and the
  ≥90% / ≤15-min completion rules; read `time-pos`/`duration` from libmpv
  properties instead of (or alongside) the external IPC poller.
- **Subtitles** — external `--sub-file` equivalent via `sub-add`, matching the
  current single-track behavior.
- **Audio/subtitle track switching** — `aid` / `sid` property control in-app.
- **App overlay controls** — play/pause/seek/volume drawn by our UI over the
  libmpv surface.
- **Exit criterion:** experimental backend reaches parity and stability targets;
  only then is any change to its default-status even *considered* — and that is a
  separate, future decision, not part of this plan.

---

## 7. Safety rules (hard constraints)

These are non-negotiable for all stages:

1. **External MPV remains the fallback and the default.** `mpv-external` is never
   removed, never demoted during this work. The libmpv backend is additive and
   opt-in.
2. **If libmpv fails, the user can still play through external MPV.** Any libmpv
   error (DLL missing, init failure, render failure, crash) must degrade
   gracefully to the external MPV path, never to a dead end.
3. **MPV JSON-IPC progress tracking is preserved.** `electron/mpvIpc.ts` and its
   completion logic stay intact; libmpv progress is added alongside, not as a
   replacement, until parity is proven.
4. **No changes to source picker behavior.** `SourcesSection` / `StreamCard` /
   stream selection are untouched by this work.
5. **No changes to library / profile / Continue-Watching logic.** All
   `profile_id`-scoped data and series next-episode behavior stay exactly as is.
6. **No database migrations for the initial PoC.** Stages 1–3 touch no schema.
   A flag in `app_settings` (Stage 4) would be an additive, idempotent
   key/value entry only — consistent with the "additive migrations only" rule —
   and is not required to begin the PoC.
7. **No debrid integration.** Per the standing project decision, no debrid login,
   tokens, provider APIs, or resolver logic.
8. **No torrent resolving.** infoHash-only streams remain "Resolver Needed".
9. **No provider hardcoding.** The app only consumes what installed addons
   return; libmpv plays the same direct HTTP/HTTPS URLs the external player does.
10. **Native code stays in the main process / a native addon, never faked in the
    renderer.** No iframe/webview pretending to be MPV; the existing
    architecture rule (MPV ownership in main, renderer calls via preload) holds.

---

## 8. Recommended approach

**Proceed on two tracks in parallel, gated by the stages above:**

- **Track 1 (ship-safe, do now): Approach D.** Extend the existing JSON-IPC to
  add pause/play/seek controls for the external MPV window. It's low-risk, needs
  no native code, builds on a channel we already own, and immediately narrows the
  UX gap while embedding is researched. This is the pragmatic near-term win and
  the guaranteed fallback.

- **Track 2 (research, gated): Approach A, with a Stage-1/2 evaluation of
  Approach B.** For *true* embedding, a **self-built N-API addon on the modern
  render API (Approach A)** is the most controllable long-term fit and aligns
  with the existing `mpv-embedded-future` notes. Before committing to building
  it, spend Stage 1–2 checking whether a **maintained, modern-render-API,
  Windows-prebuilt npm binding (Approach B)** exists; if a genuinely good one
  does, it short-cuts the early stages. **Approach C (`--wid` helper window)** is
  worth keeping only as a quick Stage-2 "can libmpv play in our process?" smoke
  test — its overlay-control limitations make it a poor final architecture.

The single biggest unknown — and the gate that determines whether true embedding
is even worth pursuing — is **Stage 3 (rendering inside Electron/Chromium on
Windows)**. We should be willing to conclude, honestly, that embedding isn't
viable yet and that improved external-MPV IPC (Approach D) is the right place to
stop for now.

---

## 9. Decision requested

This is a plan only — **no libmpv code has been written, and none will be until
you confirm.** Before implementing anything, please confirm:

1. Should we **start Track 1 (Approach D — better external-MPV IPC controls)**
   now, since it's low-risk and ships value while the rest is researched?
2. For embedding, do you want to begin **Stage 1 (verify libmpv availability on
   Windows)** as pure research, with no app code touched?
3. Any preference between **building our own addon (A)** vs. **evaluating an
   existing binding (B)** first?

Once you confirm scope, the first concrete action would be Stage 1 (locating and
documenting the Windows libmpv runtime + headers) — still no changes to the
shipping app.
