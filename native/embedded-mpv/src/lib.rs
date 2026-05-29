//! EXPERIMENTAL embedded libmpv renderer addon (Stage E1 → E4).
//!
//! Runs a libmpv render loop on a BACKGROUND THREAD using an offscreen ANGLE
//! EGL pbuffer + GLES context (no window). The render thread owns all GL/mpv
//! objects (GL is thread-affine); it `glReadPixels` each frame into a CPU buffer
//! stored behind a mutex. The JS thread only ever touches CPU-side state:
//!
//!   start(url, libmpvPath) -> ()           spawn the render thread
//!   stop()                  -> ()          signal + join + clean up
//!   getLatestFrame(since)   -> FrameResult
//!   sendCommand(type, val)  -> ()          E4: fire-and-forget control commands
//!   getPlaybackState()      -> PlaybackStateResult  E4: state readable by JS thread
//!
//! Control commands are sent via an mpsc channel to the render thread (which
//! owns the mpv handle) and dispatched each render iteration.
//!
//! This is NOT the default player. It is loaded by the Electron main process
//! only for the experimental embedded route. If anything fails, errors are
//! surfaced through FrameResult.error and the session stops cleanly.

use std::ffi::{c_void, CStr, CString};
use std::os::raw::{c_char, c_int};
use std::panic::AssertUnwindSafe;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use khronos_egl as egl;
use libloading::{Library, Symbol};
use napi::bindgen_prelude::*;
use napi_derive::napi;

type Egl = egl::DynamicInstance<egl::EGL1_4>;

// Render target resolution.  1920×1080 (E5 fix) improves subtitle quality:
// libmpv composites subtitles into the FBO, so a 720p FBO produced blurry
// subtitles when the canvas was displayed at full window size.  All downstream
// code (local buffer, EGL pbuffer, glTexImage2D, glViewport, glReadPixels)
// derives from W/H — changing these constants is the only change needed.
const W: i32 = 1920;
const H: i32 = 1080;

// ---- libmpv C ABI constants ------------------------------------------------
const MPV_RENDER_PARAM_INVALID: c_int = 0;
const MPV_RENDER_PARAM_API_TYPE: c_int = 1;
const MPV_RENDER_PARAM_OPENGL_INIT_PARAMS: c_int = 2;
const MPV_RENDER_PARAM_OPENGL_FBO: c_int = 3;
const MPV_RENDER_PARAM_FLIP_Y: c_int = 4;
const MPV_RENDER_UPDATE_FRAME: u64 = 1;
const MPV_EVENT_NONE: c_int = 0;
const MPV_EVENT_SHUTDOWN: c_int = 1;
const MPV_EVENT_FILE_LOADED: c_int = 8;

#[repr(C)]
struct MpvRenderParam {
    type_: c_int,
    data: *mut c_void,
}
type GetProcAddress = unsafe extern "C" fn(*mut c_void, *const c_char) -> *mut c_void;
type RenderUpdateFn = unsafe extern "C" fn(*mut c_void);
#[repr(C)]
struct MpvOpenglInitParams {
    get_proc_address: GetProcAddress,
    get_proc_address_ctx: *mut c_void,
}
#[repr(C)]
struct MpvOpenglFbo {
    fbo: c_int,
    w: c_int,
    h: c_int,
    internal_format: c_int,
}
#[repr(C)]
struct MpvEvent {
    event_id: c_int,
    error: c_int,
    reply_userdata: u64,
    data: *mut c_void,
}

type MpvCreate = unsafe extern "C" fn() -> *mut c_void;
type MpvInitialize = unsafe extern "C" fn(*mut c_void) -> c_int;
type MpvSetOptionString = unsafe extern "C" fn(*mut c_void, *const c_char, *const c_char) -> c_int;
type MpvSetPropertyString = unsafe extern "C" fn(*mut c_void, *const c_char, *const c_char) -> c_int;
type MpvGetPropertyString = unsafe extern "C" fn(*mut c_void, *const c_char) -> *mut c_char;
type MpvFree = unsafe extern "C" fn(*mut c_void);
type MpvCommand = unsafe extern "C" fn(*mut c_void, *const *const c_char) -> c_int;
type MpvWaitEvent = unsafe extern "C" fn(*mut c_void, f64) -> *mut MpvEvent;
type MpvTerminateDestroy = unsafe extern "C" fn(*mut c_void);
type MpvRenderContextCreate =
    unsafe extern "C" fn(*mut *mut c_void, *mut c_void, *const MpvRenderParam) -> c_int;
type MpvRenderContextSetUpdateCallback =
    unsafe extern "C" fn(*mut c_void, Option<RenderUpdateFn>, *mut c_void);
type MpvRenderContextUpdate = unsafe extern "C" fn(*mut c_void) -> u64;
type MpvRenderContextRender = unsafe extern "C" fn(*mut c_void, *const MpvRenderParam) -> c_int;
type MpvRenderContextFree = unsafe extern "C" fn(*mut c_void);

type GlGenTextures = unsafe extern "system" fn(c_int, *mut u32);
type GlBindTexture = unsafe extern "system" fn(u32, u32);
type GlTexImage2D =
    unsafe extern "system" fn(u32, c_int, c_int, c_int, c_int, c_int, u32, u32, *const c_void);
type GlTexParameteri = unsafe extern "system" fn(u32, u32, c_int);
type GlGenFramebuffers = unsafe extern "system" fn(c_int, *mut u32);
type GlBindFramebuffer = unsafe extern "system" fn(u32, u32);
type GlFramebufferTexture2D = unsafe extern "system" fn(u32, u32, u32, u32, c_int);
type GlCheckFramebufferStatus = unsafe extern "system" fn(u32) -> u32;
type GlViewport = unsafe extern "system" fn(c_int, c_int, c_int, c_int);
type GlReadPixels = unsafe extern "system" fn(c_int, c_int, c_int, c_int, u32, u32, *mut c_void);
type GlFinish = unsafe extern "system" fn();

const GL_TEXTURE_2D: u32 = 0x0DE1;
const GL_RGBA: u32 = 0x1908;
const GL_RGBA8: u32 = 0x8058;
const GL_UNSIGNED_BYTE: u32 = 0x1401;
const GL_FRAMEBUFFER: u32 = 0x8D40;
const GL_COLOR_ATTACHMENT0: u32 = 0x8CE0;
const GL_FRAMEBUFFER_COMPLETE: u32 = 0x8CD5;
const GL_TEXTURE_MIN_FILTER: u32 = 0x2801;
const GL_TEXTURE_MAG_FILTER: u32 = 0x2800;
const GL_LINEAR: c_int = 0x2601;

// ---- Control command (JS thread → render thread) ---------------------------
enum EmbeddedCmd {
    SetPause(bool),
    SeekAbsolute(f64),
    SetVolume(f64),
    SetSid(i32),  // -1 = disable subtitles
    SetAid(i32),
}

// ---- Playback state (render thread writes, JS thread reads) ----------------
struct PlaybackState {
    paused: bool,
    time_pos: f64,         // -1.0 if unknown/before playback
    duration: f64,         // -1.0 if unknown
    volume: f64,           // 0–130 (mpv default is 100)
    track_list_json: String, // raw JSON from mpv track-list property
}

impl Default for PlaybackState {
    fn default() -> Self {
        Self {
            paused: false,
            time_pos: -1.0,
            duration: -1.0,
            volume: 100.0,
            track_list_json: "[]".to_string(),
        }
    }
}

// ---- Shared state between the render thread and the JS thread --------------
struct LatestFrame {
    width: i32,
    height: i32,
    index: u64,
    rgba: Vec<u8>,
}
struct Shared {
    frame: Mutex<LatestFrame>,
    error: Mutex<Option<String>>,
    state: Mutex<PlaybackState>,
}
struct Session {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
    shared: Arc<Shared>,
    cmd_tx: std::sync::mpsc::Sender<EmbeddedCmd>,
}

// One embedded session at a time.
static SESSION: Mutex<Option<Session>> = Mutex::new(None);

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

// ---- napi return types ----------------------------------------------------
#[napi(object)]
pub struct FrameResult {
    pub no_new_frame: bool,
    pub width: u32,
    pub height: u32,
    pub frame_index: u32,
    pub rgba: Option<Buffer>,
    pub error: Option<String>,
}

impl FrameResult {
    fn empty(no_new: bool) -> Self {
        FrameResult {
            no_new_frame: no_new,
            width: 0,
            height: 0,
            frame_index: 0,
            rgba: None,
            error: None,
        }
    }
}

/// Playback state returned to the JS thread via `getPlaybackState()`.
/// napi-rs converts snake_case → camelCase automatically.
#[napi(object)]
pub struct PlaybackStateResult {
    pub has_session: bool,
    pub paused: bool,
    /// Current playback position in seconds. -1 if unknown.
    pub time_pos: f64,
    /// Total duration in seconds. -1 if unknown.
    pub duration: f64,
    /// Volume 0–130 (mpv scale, 100 = normal).
    pub volume: f64,
    /// Raw JSON string of mpv's `track-list` property (array of track objects).
    pub track_list_json: String,
}

fn is_http(url: &str) -> bool {
    url.starts_with("http://") || url.starts_with("https://")
}

/// Start (or restart) the embedded render session for `url`.
///
/// `start_time_secs`: optional resume position. When provided (and > 10 s),
/// the render thread issues an absolute seek immediately after
/// `MPV_EVENT_FILE_LOADED` so playback resumes from the saved position.
#[napi]
pub fn start(url: String, libmpv_path: String, start_time_secs: Option<f64>) -> Result<()> {
    if !is_http(&url) {
        return Err(Error::from_reason(
            "Embedded player: URL must be http(s).".to_string(),
        ));
    }

    let mut guard = lock(&SESSION);
    stop_locked(&mut guard);

    let stop = Arc::new(AtomicBool::new(false));
    let shared = Arc::new(Shared {
        frame: Mutex::new(LatestFrame {
            width: 0,
            height: 0,
            index: 0,
            rgba: Vec::new(),
        }),
        error: Mutex::new(None),
        state: Mutex::new(PlaybackState::default()),
    });

    let (cmd_tx, cmd_rx) = std::sync::mpsc::channel::<EmbeddedCmd>();

    let shared_thread = shared.clone();
    let stop_thread = stop.clone();
    let handle = std::thread::Builder::new()
        .name("embedded-mpv-render".to_string())
        .spawn(move || {
            let result = std::panic::catch_unwind(AssertUnwindSafe(|| {
                render_main(&url, &libmpv_path, start_time_secs, &shared_thread, &stop_thread, cmd_rx)
            }));
            match result {
                Ok(Ok(())) => {}
                Ok(Err(e)) => *lock(&shared_thread.error) = Some(e),
                Err(_) => *lock(&shared_thread.error) = Some("render thread panicked".into()),
            }
        })
        .map_err(|e| Error::from_reason(format!("failed to spawn render thread: {e}")))?;

    *guard = Some(Session {
        stop,
        handle: Some(handle),
        shared,
        cmd_tx,
    });
    Ok(())
}

/// Stop the embedded session (idempotent).
#[napi]
pub fn stop() -> Result<()> {
    let mut guard = lock(&SESSION);
    stop_locked(&mut guard);
    Ok(())
}

fn stop_locked(guard: &mut Option<Session>) {
    if let Some(mut s) = guard.take() {
        s.stop.store(true, Ordering::Release);
        // Dropping cmd_tx disconnects the channel, waking the render thread.
        drop(s.cmd_tx);
        if let Some(h) = s.handle.take() {
            let _ = h.join();
        }
    }
}

/// Get the latest frame if its index is newer than `since_index`.
#[napi]
pub fn get_latest_frame(since_index: u32) -> FrameResult {
    let guard = lock(&SESSION);
    let Some(s) = guard.as_ref() else {
        return FrameResult::empty(true);
    };

    if let Some(err) = lock(&s.shared.error).clone() {
        let mut r = FrameResult::empty(true);
        r.error = Some(err);
        return r;
    }

    let f = lock(&s.shared.frame);
    if f.index == 0 || f.index <= since_index as u64 {
        let mut r = FrameResult::empty(true);
        r.width = f.width.max(0) as u32;
        r.height = f.height.max(0) as u32;
        r.frame_index = f.index as u32;
        return r;
    }

    FrameResult {
        no_new_frame: false,
        width: f.width as u32,
        height: f.height as u32,
        frame_index: f.index as u32,
        rgba: Some(Buffer::from(f.rgba.clone())),
        error: None,
    }
}

/// Send a fire-and-forget control command to the render thread.
///
/// `cmd_type`:
///   - `"pause"`  → `value` != 0.0 = pause, 0.0 = resume
///   - `"seek"`   → seek to absolute `value` seconds
///   - `"volume"` → set volume (0–130)
///   - `"sid"`    → set subtitle track id; -1.0 = disable
///   - `"aid"`    → set audio track id
///
/// No-ops when there is no active session (safe to call at any time).
#[napi]
pub fn send_command(cmd_type: String, value: f64) -> Result<()> {
    let guard = lock(&SESSION);
    if let Some(s) = guard.as_ref() {
        let cmd = match cmd_type.as_str() {
            "pause" => EmbeddedCmd::SetPause(value != 0.0),
            "seek" => EmbeddedCmd::SeekAbsolute(value),
            "volume" => EmbeddedCmd::SetVolume(value.clamp(0.0, 130.0)),
            "sid" => EmbeddedCmd::SetSid(value as i32),
            "aid" => EmbeddedCmd::SetAid(value as i32),
            _ => {
                return Err(Error::from_reason(format!(
                    "unknown embedded command type: {cmd_type}"
                )))
            }
        };
        let _ = s.cmd_tx.send(cmd); // ignore if render thread has already exited
    }
    Ok(())
}

/// Read the latest playback state written by the render thread.
/// Cheap: only reads from a Mutex-protected struct; no IPC round-trip.
#[napi]
pub fn get_playback_state() -> PlaybackStateResult {
    let guard = lock(&SESSION);
    match guard.as_ref() {
        None => PlaybackStateResult {
            has_session: false,
            paused: true,
            time_pos: -1.0,
            duration: -1.0,
            volume: 100.0,
            track_list_json: "[]".to_string(),
        },
        Some(s) => {
            let st = lock(&s.shared.state);
            PlaybackStateResult {
                has_session: true,
                paused: st.paused,
                time_pos: st.time_pos,
                duration: st.duration,
                volume: st.volume,
                track_list_json: st.track_list_json.clone(),
            }
        }
    }
}

// ---- Render thread ---------------------------------------------------------

unsafe fn getsym<T>(lib: &Library, name: &[u8]) -> std::result::Result<T, String> {
    let s: Symbol<T> = lib
        .get(name)
        .map_err(|e| format!("missing libmpv symbol {}: {e}", String::from_utf8_lossy(name)))?;
    Ok(std::mem::transmute_copy::<Symbol<T>, T>(&s))
}

unsafe fn load_gl<T>(egl: &Egl, name: &str) -> std::result::Result<T, String> {
    let f = egl
        .get_proc_address(name)
        .ok_or_else(|| format!("GL function not found: {name}"))?;
    Ok(std::mem::transmute_copy::<extern "system" fn(), T>(&f))
}

static FRAME_PENDING_FALLBACK: AtomicBool = AtomicBool::new(true);

unsafe extern "C" fn on_update(ctx: *mut c_void) {
    let flag = if ctx.is_null() {
        &FRAME_PENDING_FALLBACK
    } else {
        &*(ctx as *const AtomicBool)
    };
    flag.store(true, Ordering::Release);
}

unsafe extern "C" fn mpv_get_proc_address(ctx: *mut c_void, name: *const c_char) -> *mut c_void {
    if ctx.is_null() || name.is_null() {
        return std::ptr::null_mut();
    }
    let egl = &*(ctx as *const Egl);
    let cname = match CStr::from_ptr(name).to_str() {
        Ok(s) => s,
        Err(_) => return std::ptr::null_mut(),
    };
    match egl.get_proc_address(cname) {
        Some(f) => f as *mut c_void,
        None => std::ptr::null_mut(),
    }
}

fn render_main(
    url: &str,
    libmpv_path: &str,
    start_time_secs: Option<f64>,
    shared: &Arc<Shared>,
    stop: &Arc<AtomicBool>,
    cmd_rx: std::sync::mpsc::Receiver<EmbeddedCmd>,
) -> std::result::Result<(), String> {
    unsafe { render_main_inner(url, libmpv_path, start_time_secs, shared, stop, cmd_rx) }
}

unsafe fn render_main_inner(
    url: &str,
    libmpv_path: &str,
    start_time_secs: Option<f64>,
    shared: &Arc<Shared>,
    stop: &Arc<AtomicBool>,
    cmd_rx: std::sync::mpsc::Receiver<EmbeddedCmd>,
) -> std::result::Result<(), String> {
    // ---- libmpv -----------------------------------------------------------
    let mpvlib = Library::new(libmpv_path)
        .map_err(|e| format!("failed to load libmpv-2.dll at '{libmpv_path}': {e}"))?;
    let mpv_create: MpvCreate = getsym(&mpvlib, b"mpv_create\0")?;
    let mpv_initialize: MpvInitialize = getsym(&mpvlib, b"mpv_initialize\0")?;
    let mpv_set_option_string: MpvSetOptionString = getsym(&mpvlib, b"mpv_set_option_string\0")?;
    let mpv_set_property_string: MpvSetPropertyString =
        getsym(&mpvlib, b"mpv_set_property_string\0")?;
    let mpv_get_property_string: MpvGetPropertyString =
        getsym(&mpvlib, b"mpv_get_property_string\0")?;
    let mpv_free: MpvFree = getsym(&mpvlib, b"mpv_free\0")?;
    let mpv_command: MpvCommand = getsym(&mpvlib, b"mpv_command\0")?;
    let mpv_wait_event: MpvWaitEvent = getsym(&mpvlib, b"mpv_wait_event\0")?;
    let mpv_terminate_destroy: MpvTerminateDestroy =
        getsym(&mpvlib, b"mpv_terminate_destroy\0")?;
    let mpv_render_context_create: MpvRenderContextCreate =
        getsym(&mpvlib, b"mpv_render_context_create\0")?;
    let mpv_render_context_set_update_callback: MpvRenderContextSetUpdateCallback =
        getsym(&mpvlib, b"mpv_render_context_set_update_callback\0")?;
    let mpv_render_context_update: MpvRenderContextUpdate =
        getsym(&mpvlib, b"mpv_render_context_update\0")?;
    let mpv_render_context_render: MpvRenderContextRender =
        getsym(&mpvlib, b"mpv_render_context_render\0")?;
    let mpv_render_context_free: MpvRenderContextFree =
        getsym(&mpvlib, b"mpv_render_context_free\0")?;

    // ---- EGL/ANGLE offscreen context --------------------------------------
    let egl = egl::DynamicInstance::<egl::EGL1_4>::load_required_from_filename("libEGL.dll")
        .map_err(|e| format!("failed to load libEGL.dll (ANGLE): {e}"))?;
    let display = egl
        .get_display(egl::DEFAULT_DISPLAY)
        .ok_or("eglGetDisplay returned no display")?;
    egl.initialize(display)
        .map_err(|e| format!("eglInitialize failed: {e}"))?;
    let config_attribs = [
        egl::SURFACE_TYPE, egl::PBUFFER_BIT,
        egl::RENDERABLE_TYPE, egl::OPENGL_ES2_BIT,
        egl::RED_SIZE, 8, egl::GREEN_SIZE, 8, egl::BLUE_SIZE, 8, egl::ALPHA_SIZE, 8,
        egl::NONE,
    ];
    let config = egl
        .choose_first_config(display, &config_attribs)
        .map_err(|e| format!("eglChooseConfig failed: {e}"))?
        .ok_or("no matching EGL config")?;
    let pbuffer_attribs = [egl::WIDTH, W, egl::HEIGHT, H, egl::NONE];
    let surface = egl
        .create_pbuffer_surface(display, config, &pbuffer_attribs)
        .map_err(|e| format!("eglCreatePbufferSurface failed: {e}"))?;
    egl.bind_api(egl::OPENGL_ES_API)
        .map_err(|e| format!("eglBindAPI failed: {e}"))?;
    let context = {
        let a3 = [egl::CONTEXT_CLIENT_VERSION, 3, egl::NONE];
        match egl.create_context(display, config, None, &a3) {
            Ok(c) => c,
            Err(_) => {
                let a2 = [egl::CONTEXT_CLIENT_VERSION, 2, egl::NONE];
                egl.create_context(display, config, None, &a2)
                    .map_err(|e| format!("eglCreateContext failed: {e}"))?
            }
        }
    };
    egl.make_current(display, Some(surface), Some(surface), Some(context))
        .map_err(|e| format!("eglMakeCurrent failed: {e}"))?;

    // ---- GL entry points + FBO --------------------------------------------
    let gl_gen_textures: GlGenTextures = load_gl(&egl, "glGenTextures")?;
    let gl_bind_texture: GlBindTexture = load_gl(&egl, "glBindTexture")?;
    let gl_tex_image_2d: GlTexImage2D = load_gl(&egl, "glTexImage2D")?;
    let gl_tex_parameteri: GlTexParameteri = load_gl(&egl, "glTexParameteri")?;
    let gl_gen_framebuffers: GlGenFramebuffers = load_gl(&egl, "glGenFramebuffers")?;
    let gl_bind_framebuffer: GlBindFramebuffer = load_gl(&egl, "glBindFramebuffer")?;
    let gl_framebuffer_texture_2d: GlFramebufferTexture2D =
        load_gl(&egl, "glFramebufferTexture2D")?;
    let gl_check_framebuffer_status: GlCheckFramebufferStatus =
        load_gl(&egl, "glCheckFramebufferStatus")?;
    let gl_viewport: GlViewport = load_gl(&egl, "glViewport")?;
    let gl_read_pixels: GlReadPixels = load_gl(&egl, "glReadPixels")?;
    let gl_finish: GlFinish = load_gl(&egl, "glFinish")?;

    let mut tex: u32 = 0;
    gl_gen_textures(1, &mut tex);
    gl_bind_texture(GL_TEXTURE_2D, tex);
    gl_tex_image_2d(
        GL_TEXTURE_2D, 0, GL_RGBA8 as c_int, W, H, 0, GL_RGBA, GL_UNSIGNED_BYTE,
        std::ptr::null(),
    );
    gl_tex_parameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    gl_tex_parameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    let mut fbo: u32 = 0;
    gl_gen_framebuffers(1, &mut fbo);
    gl_bind_framebuffer(GL_FRAMEBUFFER, fbo);
    gl_framebuffer_texture_2d(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, tex, 0);
    if gl_check_framebuffer_status(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE {
        return Err("FBO incomplete".to_string());
    }
    gl_viewport(0, 0, W, H);

    // ---- mpv handle + render context --------------------------------------
    let mpv = mpv_create();
    if mpv.is_null() {
        return Err("mpv_create returned null".to_string());
    }
    let set_opt = |name: &str, val: &str| {
        if let (Ok(n), Ok(v)) = (CString::new(name), CString::new(val)) {
            mpv_set_option_string(mpv, n.as_ptr(), v.as_ptr());
        }
    };
    set_opt("vo", "libmpv");
    set_opt("hwdec", "no");
    set_opt("network-timeout", "15");
    if mpv_initialize(mpv) < 0 {
        mpv_terminate_destroy(mpv);
        return Err("mpv_initialize failed".to_string());
    }

    let frame_pending = Arc::new(AtomicBool::new(true));
    let api = CString::new("opengl").unwrap();
    let mut gl_init = MpvOpenglInitParams {
        get_proc_address: mpv_get_proc_address,
        get_proc_address_ctx: &egl as *const Egl as *mut c_void,
    };
    let create_params = [
        MpvRenderParam { type_: MPV_RENDER_PARAM_API_TYPE, data: api.as_ptr() as *mut c_void },
        MpvRenderParam {
            type_: MPV_RENDER_PARAM_OPENGL_INIT_PARAMS,
            data: &mut gl_init as *mut _ as *mut c_void,
        },
        MpvRenderParam { type_: MPV_RENDER_PARAM_INVALID, data: std::ptr::null_mut() },
    ];
    let mut rctx: *mut c_void = std::ptr::null_mut();
    if mpv_render_context_create(&mut rctx, mpv, create_params.as_ptr()) < 0 || rctx.is_null() {
        mpv_terminate_destroy(mpv);
        return Err("mpv_render_context_create failed".to_string());
    }
    mpv_render_context_set_update_callback(
        rctx,
        Some(on_update),
        Arc::as_ptr(&frame_pending) as *mut c_void,
    );

    // ---- loadfile ---------------------------------------------------------
    let c_load = CString::new("loadfile").unwrap();
    let c_url = CString::new(url).map_err(|_| "url contains NUL".to_string())?;
    let argv: [*const c_char; 3] = [c_load.as_ptr(), c_url.as_ptr(), std::ptr::null()];
    if mpv_command(mpv, argv.as_ptr()) < 0 {
        mpv_render_context_free(rctx);
        mpv_terminate_destroy(mpv);
        return Err("loadfile command failed".to_string());
    }

    // ---- render loop ------------------------------------------------------
    let mut local = vec![0u8; (W * H * 4) as usize];
    let mut index: u64 = 0;
    let fbo_struct = MpvOpenglFbo { fbo: fbo as c_int, w: W, h: H, internal_format: 0 };

    // State polling: update every 200 ms; refresh tracks on FILE_LOADED.
    let mut last_state_update = Instant::now();
    let state_interval = Duration::from_millis(200);
    let mut needs_track_refresh = true; // fetch tracks as soon as possible

    // E5 fix: resume position. Consumed on MPV_EVENT_FILE_LOADED (file is
    // buffered and seekable at that point). Ignored if ≤ 10 s.
    let mut pending_resume: Option<f64> = match start_time_secs {
        Some(t) if t > 10.0 => Some(t),
        _ => None,
    };

    while !stop.load(Ordering::Acquire) {
        // ---- Drain control commands from JS thread ------------------------
        loop {
            match cmd_rx.try_recv() {
                Ok(cmd) => {
                    let set_prop = |name: &str, val: &str| {
                        if let (Ok(n), Ok(v)) = (CString::new(name), CString::new(val)) {
                            mpv_set_property_string(mpv, n.as_ptr(), v.as_ptr());
                        }
                    };
                    match cmd {
                        EmbeddedCmd::SetPause(b) => {
                            set_prop("pause", if b { "yes" } else { "no" });
                        }
                        EmbeddedCmd::SeekAbsolute(t) => {
                            let c_seek = CString::new("seek").unwrap();
                            let c_t = CString::new(format!("{t:.3}")).unwrap();
                            let c_abs = CString::new("absolute").unwrap();
                            let argv2: [*const c_char; 4] = [
                                c_seek.as_ptr(),
                                c_t.as_ptr(),
                                c_abs.as_ptr(),
                                std::ptr::null(),
                            ];
                            mpv_command(mpv, argv2.as_ptr());
                        }
                        EmbeddedCmd::SetVolume(v) => {
                            set_prop("volume", &format!("{v:.1}"));
                        }
                        EmbeddedCmd::SetSid(id) => {
                            let sid_owned;
                            let sid_str = if id < 0 {
                                "no"
                            } else {
                                sid_owned = id.to_string();
                                sid_owned.as_str()
                            };
                            set_prop("sid", sid_str);
                        }
                        EmbeddedCmd::SetAid(id) => {
                            let aid_owned = id.to_string();
                            set_prop("aid", &aid_owned);
                        }
                    }
                }
                Err(std::sync::mpsc::TryRecvError::Empty) => break,
                Err(std::sync::mpsc::TryRecvError::Disconnected) => break,
            }
        }

        // ---- Drain mpv events (drive decoder + detect shutdown/fileload) --
        let mut shutdown = false;
        loop {
            let evp = mpv_wait_event(mpv, 0.0);
            if evp.is_null() {
                break;
            }
            match (*evp).event_id {
                MPV_EVENT_NONE => break,
                MPV_EVENT_SHUTDOWN => {
                    shutdown = true;
                    break;
                }
                MPV_EVENT_FILE_LOADED => {
                    needs_track_refresh = true;
                    // E5 fix: if a resume position was requested, seek now.
                    // The file is buffered and seeking is valid at FILE_LOADED.
                    if let Some(t) = pending_resume.take() {
                        let c_seek = CString::new("seek").unwrap();
                        let c_t = CString::new(format!("{t:.3}")).unwrap();
                        let c_abs = CString::new("absolute").unwrap();
                        let argv_seek: [*const c_char; 4] = [
                            c_seek.as_ptr(),
                            c_t.as_ptr(),
                            c_abs.as_ptr(),
                            std::ptr::null(),
                        ];
                        mpv_command(mpv, argv_seek.as_ptr());
                    }
                }
                _ => {}
            }
        }
        if shutdown {
            break;
        }

        // ---- Periodic state update ----------------------------------------
        let now = Instant::now();
        if now.duration_since(last_state_update) >= state_interval || needs_track_refresh {
            last_state_update = now;
            let do_tracks = needs_track_refresh;
            needs_track_refresh = false;

            let mut ps = lock(&shared.state);

            // Helper macro: read a string property, parse as f64.
            macro_rules! read_f64 {
                ($prop:expr, $default:expr) => {{
                    match CString::new($prop) {
                        Ok(n) => {
                            let ptr = mpv_get_property_string(mpv, n.as_ptr());
                            if ptr.is_null() {
                                $default
                            } else {
                                let val = CStr::from_ptr(ptr)
                                    .to_str()
                                    .unwrap_or("")
                                    .parse::<f64>()
                                    .unwrap_or($default);
                                mpv_free(ptr as *mut c_void);
                                val
                            }
                        }
                        Err(_) => $default,
                    }
                }};
            }

            ps.time_pos = read_f64!("time-pos", -1.0);
            ps.duration = read_f64!("duration", -1.0);
            let raw_vol = read_f64!("volume", 100.0);
            ps.volume = if raw_vol < 0.0 { 100.0 } else { raw_vol };

            // pause: string property "yes"/"no"
            if let Ok(n) = CString::new("pause") {
                let ptr = mpv_get_property_string(mpv, n.as_ptr());
                if !ptr.is_null() {
                    ps.paused = CStr::from_ptr(ptr).to_str().unwrap_or("no") == "yes";
                    mpv_free(ptr as *mut c_void);
                }
            }

            // track-list: full JSON (fetch only when needed)
            if do_tracks {
                if let Ok(n) = CString::new("track-list") {
                    let ptr = mpv_get_property_string(mpv, n.as_ptr());
                    if !ptr.is_null() {
                        if let Ok(s) = CStr::from_ptr(ptr).to_str() {
                            ps.track_list_json = s.to_string();
                        }
                        mpv_free(ptr as *mut c_void);
                    }
                }
            }
        }

        // ---- Render frame if one is pending --------------------------------
        if frame_pending.swap(false, Ordering::AcqRel) {
            let flags = mpv_render_context_update(rctx);
            if flags & MPV_RENDER_UPDATE_FRAME != 0 {
                let mut fbo_param = MpvOpenglFbo { ..fbo_struct };
                let mut flip: c_int = 1;
                let render_params = [
                    MpvRenderParam {
                        type_: MPV_RENDER_PARAM_OPENGL_FBO,
                        data: &mut fbo_param as *mut _ as *mut c_void,
                    },
                    MpvRenderParam {
                        type_: MPV_RENDER_PARAM_FLIP_Y,
                        data: &mut flip as *mut _ as *mut c_void,
                    },
                    MpvRenderParam { type_: MPV_RENDER_PARAM_INVALID, data: std::ptr::null_mut() },
                ];
                mpv_render_context_render(rctx, render_params.as_ptr());
                gl_finish();
                gl_bind_framebuffer(GL_FRAMEBUFFER, fbo);
                gl_read_pixels(
                    0, 0, W, H, GL_RGBA, GL_UNSIGNED_BYTE,
                    local.as_mut_ptr() as *mut c_void,
                );

                // glReadPixels returns rows bottom-up (OpenGL convention).
                // canvas ImageData expects top-left origin. Flip rows in-place.
                {
                    let stride = (W * 4) as usize;
                    let height = H as usize;
                    for row in 0..(height / 2) {
                        let top = row * stride;
                        let bot = (height - 1 - row) * stride;
                        let (lo, hi) = local.split_at_mut(bot);
                        lo[top..top + stride].swap_with_slice(&mut hi[..stride]);
                    }
                }

                index += 1;
                let mut f = lock(&shared.frame);
                f.width = W;
                f.height = H;
                f.index = index;
                if f.rgba.len() != local.len() {
                    f.rgba.resize(local.len(), 0);
                }
                f.rgba.copy_from_slice(&local);
            }
        } else {
            std::thread::sleep(Duration::from_millis(2));
        }
    }

    // ---- cleanup ----------------------------------------------------------
    mpv_render_context_set_update_callback(rctx, None, std::ptr::null_mut());
    mpv_render_context_free(rctx);
    mpv_terminate_destroy(mpv);
    let _ = egl.make_current(display, None, None, None);
    let _ = egl.destroy_context(display, context);
    let _ = egl.destroy_surface(display, surface);
    let _ = egl.terminate(display);
    drop(frame_pending);
    Ok(())
}
