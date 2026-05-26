//! R1B continuous render-loop proof-of-concept (Approach B, Stage R1B).
//!
//! Proves the libmpv render *loop* is stable WITHOUT Electron:
//!   1. the render update callback fires,
//!   2. the loop produces many frames over several seconds,
//!   3. frames are CHANGING (not one static image),
//!   4. it runs for the full duration without crashing,
//!   5. cleanup is clean,
//!   6. rough metrics are logged (frames, avg frame time, ~skipped, non-black %),
//!   7. a handful of sample PNGs are saved (frame_001.png, frame_030.png, ...).
//!
//! Offscreen GLES via ANGLE EGL pbuffer (no window). Loads libmpv-2.dll at
//! runtime. Isolated: does not touch render-poc, the headless addon, src/**,
//! electron/**, or the app. Run: `cargo run --release -- <url>`.
//!
//! NOTE: authored without a Windows compiler to hand. If `cargo` errors (most
//! likely a `khronos-egl` API name or a render-API struct detail), paste it and
//! we'll adjust.

use std::ffi::{c_void, CStr, CString};
use std::os::raw::{c_char, c_int};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use khronos_egl as egl;
use libloading::{Library, Symbol};

type Egl = egl::DynamicInstance<egl::EGL1_4>;

// ---- Loop configuration ----------------------------------------------------
const W: i32 = 1280;
const H: i32 = 720;
const RUN_SECONDS: u64 = 8;
const MAX_PNGS: usize = 10;
// Save a PNG at these rendered-frame indices (until MAX_PNGS saved).
const SAVE_AT: &[u64] = &[1, 30, 60, 90, 120, 150, 180, 210, 240, 270];

// ---- libmpv C ABI constants ------------------------------------------------
const MPV_RENDER_PARAM_INVALID: c_int = 0;
const MPV_RENDER_PARAM_API_TYPE: c_int = 1;
const MPV_RENDER_PARAM_OPENGL_INIT_PARAMS: c_int = 2;
const MPV_RENDER_PARAM_OPENGL_FBO: c_int = 3;
const MPV_RENDER_PARAM_FLIP_Y: c_int = 4;

const MPV_RENDER_UPDATE_FRAME: u64 = 1; // 1 << 0

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

// ---- libmpv function-pointer types ----------------------------------------
type MpvCreate = unsafe extern "C" fn() -> *mut c_void;
type MpvInitialize = unsafe extern "C" fn(*mut c_void) -> c_int;
type MpvSetOptionString = unsafe extern "C" fn(*mut c_void, *const c_char, *const c_char) -> c_int;
type MpvCommand = unsafe extern "C" fn(*mut c_void, *const *const c_char) -> c_int;
type MpvGetPropertyString = unsafe extern "C" fn(*mut c_void, *const c_char) -> *mut c_char;
type MpvWaitEvent = unsafe extern "C" fn(*mut c_void, f64) -> *mut MpvEvent;
type MpvFree = unsafe extern "C" fn(*mut c_void);
type MpvTerminateDestroy = unsafe extern "C" fn(*mut c_void);
type MpvRenderContextCreate =
    unsafe extern "C" fn(*mut *mut c_void, *mut c_void, *const MpvRenderParam) -> c_int;
type MpvRenderContextSetUpdateCallback =
    unsafe extern "C" fn(*mut c_void, Option<RenderUpdateFn>, *mut c_void);
type MpvRenderContextUpdate = unsafe extern "C" fn(*mut c_void) -> u64;
type MpvRenderContextRender = unsafe extern "C" fn(*mut c_void, *const MpvRenderParam) -> c_int;
type MpvRenderContextFree = unsafe extern "C" fn(*mut c_void);

// ---- OpenGL ES function-pointer types --------------------------------------
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
type GlGetError = unsafe extern "system" fn() -> u32;

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

struct Gl {
    gen_textures: GlGenTextures,
    bind_texture: GlBindTexture,
    tex_image_2d: GlTexImage2D,
    tex_parameteri: GlTexParameteri,
    gen_framebuffers: GlGenFramebuffers,
    bind_framebuffer: GlBindFramebuffer,
    framebuffer_texture_2d: GlFramebufferTexture2D,
    check_framebuffer_status: GlCheckFramebufferStatus,
    viewport: GlViewport,
    read_pixels: GlReadPixels,
    finish: GlFinish,
    get_error: GlGetError,
}

// Set by the libmpv render update callback (fires on mpv's render thread).
static FRAME_PENDING: AtomicBool = AtomicBool::new(false);
static UPDATE_SIGNALS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

unsafe extern "C" fn on_mpv_render_update(_ctx: *mut c_void) {
    FRAME_PENDING.store(true, Ordering::Release);
    UPDATE_SIGNALS.fetch_add(1, Ordering::Relaxed);
}

unsafe fn load_gl<T>(egl: &Egl, name: &str) -> T {
    let f = egl
        .get_proc_address(name)
        .unwrap_or_else(|| panic!("GL function not found via eglGetProcAddress: {name}"));
    std::mem::transmute_copy::<extern "system" fn(), T>(&f)
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

unsafe fn sym<T>(lib: &Library, name: &[u8]) -> T {
    let s: Symbol<T> = lib
        .get(name)
        .unwrap_or_else(|e| panic!("missing libmpv symbol {}: {e}", String::from_utf8_lossy(name)));
    std::mem::transmute_copy::<Symbol<T>, T>(&s)
}

fn main() {
    let manifest = env!("CARGO_MANIFEST_DIR"); // .../native/libmpv-poc/render-loop-poc
    let base = Path::new(manifest).parent().expect("crate parent"); // .../native/libmpv-poc
    let angle_dir = base.join("vendor").join("angle");
    let libmpv_dir = base.join("vendor").join("libmpv");
    let libmpv_dll = libmpv_dir.join("libmpv-2.dll");

    let old_path = std::env::var("PATH").unwrap_or_default();
    std::env::set_var(
        "PATH",
        format!("{};{};{}", angle_dir.display(), libmpv_dir.display(), old_path),
    );

    let url = std::env::args().nth(1).unwrap_or_else(|| {
        "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4"
            .to_string()
    });

    println!("[loop-poc] libmpv : {}", libmpv_dll.display());
    println!("[loop-poc] angle  : {}", angle_dir.display());
    println!("[loop-poc] url    : {url}");
    println!("[loop-poc] run    : {RUN_SECONDS}s, target {W}x{H}");

    if !libmpv_dll.exists() {
        eprintln!("[loop-poc] ERROR: libmpv-2.dll not found at {}", libmpv_dll.display());
        std::process::exit(1);
    }

    unsafe { run(&libmpv_dll.to_string_lossy(), &url) }
}

/// Cheap FNV-1a over a subsample of the buffer — used to detect frame changes.
fn frame_hash(rgba: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    // Sample every 257th byte (coprime-ish stride) to keep it fast.
    let mut i = 0;
    while i < rgba.len() {
        h ^= rgba[i] as u64;
        h = h.wrapping_mul(0x100000001b3);
        i += 257;
    }
    h
}

fn non_black_percent(rgba: &[u8]) -> f64 {
    let total = rgba.len() / 4;
    if total == 0 {
        return 0.0;
    }
    let mut non_black = 0usize;
    for px in rgba.chunks_exact(4) {
        if px[0] > 16 || px[1] > 16 || px[2] > 16 {
            non_black += 1;
        }
    }
    non_black as f64 * 100.0 / total as f64
}

fn write_png(path: &str, rgba: &[u8], w: u32, h: u32) {
    use std::fs::File;
    use std::io::BufWriter;
    let file = File::create(path).unwrap_or_else(|e| panic!("create {path}: {e}"));
    let mut enc = png::Encoder::new(BufWriter::new(file), w, h);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    let mut writer = enc.write_header().expect("png header");
    writer.write_image_data(rgba).expect("png data");
}

unsafe fn run(libmpv_path: &str, url: &str) {
    // ---- Load libmpv + symbols -------------------------------------------
    let mpvlib = Library::new(libmpv_path).unwrap_or_else(|e| panic!("load libmpv: {e}"));
    let mpv_create: MpvCreate = sym(&mpvlib, b"mpv_create\0");
    let mpv_initialize: MpvInitialize = sym(&mpvlib, b"mpv_initialize\0");
    let mpv_set_option_string: MpvSetOptionString = sym(&mpvlib, b"mpv_set_option_string\0");
    let mpv_command: MpvCommand = sym(&mpvlib, b"mpv_command\0");
    let mpv_get_property_string: MpvGetPropertyString = sym(&mpvlib, b"mpv_get_property_string\0");
    let mpv_wait_event: MpvWaitEvent = sym(&mpvlib, b"mpv_wait_event\0");
    let mpv_free: MpvFree = sym(&mpvlib, b"mpv_free\0");
    let mpv_terminate_destroy: MpvTerminateDestroy = sym(&mpvlib, b"mpv_terminate_destroy\0");
    let mpv_render_context_create: MpvRenderContextCreate =
        sym(&mpvlib, b"mpv_render_context_create\0");
    let mpv_render_context_set_update_callback: MpvRenderContextSetUpdateCallback =
        sym(&mpvlib, b"mpv_render_context_set_update_callback\0");
    let mpv_render_context_update: MpvRenderContextUpdate =
        sym(&mpvlib, b"mpv_render_context_update\0");
    let mpv_render_context_render: MpvRenderContextRender =
        sym(&mpvlib, b"mpv_render_context_render\0");
    let mpv_render_context_free: MpvRenderContextFree = sym(&mpvlib, b"mpv_render_context_free\0");

    // ---- Offscreen EGL/ANGLE pbuffer + GLES context ----------------------
    let egl = egl::DynamicInstance::<egl::EGL1_4>::load_required_from_filename("libEGL.dll")
        .expect("failed to load libEGL.dll (ANGLE) — is it in vendor/angle/ ?");
    let display = egl.get_display(egl::DEFAULT_DISPLAY).expect("eglGetDisplay");
    let (major, minor) = egl.initialize(display).expect("eglInitialize");
    println!("[loop-poc] EGL initialized: {major}.{minor}");

    let config_attribs = [
        egl::SURFACE_TYPE, egl::PBUFFER_BIT,
        egl::RENDERABLE_TYPE, egl::OPENGL_ES2_BIT,
        egl::RED_SIZE, 8, egl::GREEN_SIZE, 8, egl::BLUE_SIZE, 8, egl::ALPHA_SIZE, 8,
        egl::NONE,
    ];
    let config = egl
        .choose_first_config(display, &config_attribs)
        .expect("eglChooseConfig")
        .expect("no matching EGL config");
    let pbuffer_attribs = [egl::WIDTH, W, egl::HEIGHT, H, egl::NONE];
    let surface = egl
        .create_pbuffer_surface(display, config, &pbuffer_attribs)
        .expect("eglCreatePbufferSurface");
    egl.bind_api(egl::OPENGL_ES_API).expect("eglBindAPI");
    let context = {
        let a3 = [egl::CONTEXT_CLIENT_VERSION, 3, egl::NONE];
        match egl.create_context(display, config, None, &a3) {
            Ok(c) => c,
            Err(_) => {
                let a2 = [egl::CONTEXT_CLIENT_VERSION, 2, egl::NONE];
                egl.create_context(display, config, None, &a2)
                    .expect("eglCreateContext (GLES3 and GLES2)")
            }
        }
    };
    egl.make_current(display, Some(surface), Some(surface), Some(context))
        .expect("eglMakeCurrent");
    println!("[loop-poc] EGL pbuffer + GLES context current");

    // ---- GL entry points + FBO -------------------------------------------
    let gl = Gl {
        gen_textures: load_gl(&egl, "glGenTextures"),
        bind_texture: load_gl(&egl, "glBindTexture"),
        tex_image_2d: load_gl(&egl, "glTexImage2D"),
        tex_parameteri: load_gl(&egl, "glTexParameteri"),
        gen_framebuffers: load_gl(&egl, "glGenFramebuffers"),
        bind_framebuffer: load_gl(&egl, "glBindFramebuffer"),
        framebuffer_texture_2d: load_gl(&egl, "glFramebufferTexture2D"),
        check_framebuffer_status: load_gl(&egl, "glCheckFramebufferStatus"),
        viewport: load_gl(&egl, "glViewport"),
        read_pixels: load_gl(&egl, "glReadPixels"),
        finish: load_gl(&egl, "glFinish"),
        get_error: load_gl(&egl, "glGetError"),
    };
    let mut tex: u32 = 0;
    (gl.gen_textures)(1, &mut tex);
    (gl.bind_texture)(GL_TEXTURE_2D, tex);
    (gl.tex_image_2d)(
        GL_TEXTURE_2D, 0, GL_RGBA8 as c_int, W, H, 0, GL_RGBA, GL_UNSIGNED_BYTE,
        std::ptr::null(),
    );
    (gl.tex_parameteri)(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    (gl.tex_parameteri)(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    let mut fbo: u32 = 0;
    (gl.gen_framebuffers)(1, &mut fbo);
    (gl.bind_framebuffer)(GL_FRAMEBUFFER, fbo);
    (gl.framebuffer_texture_2d)(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, tex, 0);
    let status = (gl.check_framebuffer_status)(GL_FRAMEBUFFER);
    if status != GL_FRAMEBUFFER_COMPLETE {
        panic!("FBO incomplete: 0x{status:X}");
    }
    (gl.viewport)(0, 0, W, H);
    println!("[loop-poc] FBO {W}x{H} ready");

    // ---- mpv handle + render context (with update callback) --------------
    let mpv = mpv_create();
    if mpv.is_null() {
        panic!("mpv_create returned null");
    }
    let set_opt = |name: &str, val: &str| {
        if let (Ok(n), Ok(v)) = (CString::new(name), CString::new(val)) {
            mpv_set_option_string(mpv, n.as_ptr(), v.as_ptr());
        }
    };
    set_opt("vo", "libmpv");
    set_opt("ao", "null");
    set_opt("hwdec", "no");
    set_opt("network-timeout", "15");
    if mpv_initialize(mpv) < 0 {
        panic!("mpv_initialize failed");
    }
    if let Some(v) = get_prop_string(mpv_get_property_string, mpv_free, mpv, "mpv-version") {
        println!("[loop-poc] libmpv loaded: {v}");
    }

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
        panic!("mpv_render_context_create failed");
    }
    mpv_render_context_set_update_callback(rctx, Some(on_mpv_render_update), std::ptr::null_mut());
    println!("[loop-poc] render context created (update callback installed)");

    // ---- Load URL --------------------------------------------------------
    let c_load = CString::new("loadfile").unwrap();
    let c_url = CString::new(url).unwrap();
    let argv: [*const c_char; 3] = [c_load.as_ptr(), c_url.as_ptr(), std::ptr::null()];
    if mpv_command(mpv, argv.as_ptr()) < 0 {
        panic!("loadfile failed");
    }

    // ---- Render loop -----------------------------------------------------
    let mut rgba = vec![0u8; (W * H * 4) as usize];
    let mut frames: u64 = 0;
    let mut distinct: u64 = 0;
    let mut last_hash: u64 = 0;
    let mut min_nb = 100.0f64;
    let mut max_nb = 0.0f64;
    let mut total_render_ns: u128 = 0;
    let mut saved = 0usize;
    let mut file_loaded = false;

    let fbo_struct = MpvOpenglFbo { fbo: fbo as c_int, w: W, h: H, internal_format: 0 };
    let start = Instant::now();
    let deadline = start + Duration::from_secs(RUN_SECONDS);

    while Instant::now() < deadline {
        // Drain mpv events so decoding progresses + note file-loaded.
        loop {
            let evp = mpv_wait_event(mpv, 0.0);
            if evp.is_null() {
                break;
            }
            match (*evp).event_id {
                MPV_EVENT_NONE => break,
                MPV_EVENT_FILE_LOADED => {
                    if !file_loaded {
                        file_loaded = true;
                        println!("[loop-poc] file-loaded");
                    }
                }
                MPV_EVENT_SHUTDOWN => {
                    println!("[loop-poc] shutdown event");
                    break;
                }
                _ => {}
            }
        }

        // Render only when mpv signals a new frame.
        if FRAME_PENDING.swap(false, Ordering::AcqRel) {
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

                let t0 = Instant::now();
                mpv_render_context_render(rctx, render_params.as_ptr());
                (gl.finish)();
                (gl.bind_framebuffer)(GL_FRAMEBUFFER, fbo);
                (gl.read_pixels)(
                    0, 0, W, H, GL_RGBA, GL_UNSIGNED_BYTE,
                    rgba.as_mut_ptr() as *mut c_void,
                );
                total_render_ns += t0.elapsed().as_nanos();
                let glerr = (gl.get_error)();
                if glerr != 0 {
                    eprintln!("[loop-poc] glGetError: 0x{glerr:X}");
                }

                frames += 1;
                let hash = frame_hash(&rgba);
                if frames == 1 || hash != last_hash {
                    distinct += 1;
                }
                last_hash = hash;

                let nb = non_black_percent(&rgba);
                if nb < min_nb {
                    min_nb = nb;
                }
                if nb > max_nb {
                    max_nb = nb;
                }

                // Save sample PNGs at the configured frame indices.
                if saved < MAX_PNGS && SAVE_AT.contains(&frames) {
                    // Flip rows so the PNG is upright.
                    let mut flipped = vec![0u8; rgba.len()];
                    let rowb = (W * 4) as usize;
                    for y in 0..H as usize {
                        let s = y * rowb;
                        let d = (H as usize - 1 - y) * rowb;
                        flipped[d..d + rowb].copy_from_slice(&rgba[s..s + rowb]);
                    }
                    let name = format!("frame_{:03}.png", frames);
                    write_png(&name, &flipped, W as u32, H as u32);
                    saved += 1;
                    println!("[loop-poc] saved {name} ({nb:.0}% non-black)");
                }
            }
        } else {
            // Nothing pending — yield briefly.
            std::thread::sleep(Duration::from_millis(2));
        }
    }

    let elapsed = start.elapsed().as_secs_f64();
    let signals = UPDATE_SIGNALS.load(Ordering::Relaxed);
    let avg_ms = if frames > 0 {
        (total_render_ns as f64 / frames as f64) / 1_000_000.0
    } else {
        0.0
    };
    let fps = if elapsed > 0.0 { frames as f64 / elapsed } else { 0.0 };
    let skipped = signals.saturating_sub(frames);

    println!("\n[loop-poc] ---- metrics ----");
    println!("[loop-poc] rendered {frames} frames in {elapsed:.1}s (~{fps:.0} fps), avg {avg_ms:.2} ms/frame");
    println!("[loop-poc] update signals: {signals}, rendered: {frames}, approx skipped: {skipped}");
    println!("[loop-poc] distinct frames (by checksum): {distinct}/{frames}");
    println!("[loop-poc] non-black: min {min_nb:.0}% max {max_nb:.0}%");
    println!("[loop-poc] saved {saved} PNG(s)");

    // ---- Cleanup ---------------------------------------------------------
    mpv_render_context_set_update_callback(rctx, None, std::ptr::null_mut());
    mpv_render_context_free(rctx);
    mpv_terminate_destroy(mpv);
    let _ = egl.make_current(display, None, None, None);
    let _ = egl.destroy_context(display, context);
    let _ = egl.destroy_surface(display, surface);
    let _ = egl.terminate(display);

    let ok = frames >= 30 && distinct > 1 && max_nb > 1.0;
    if ok {
        println!("[loop-poc] SUCCESS ✅  loop stable, frames changing, PNGs non-blank, clean exit.");
        std::process::exit(0);
    } else {
        eprintln!("[loop-poc] INCOMPLETE ⚠️  frames={frames} distinct={distinct} max_non_black={max_nb:.0}% — see output above.");
        std::process::exit(2);
    }
}

unsafe fn get_prop_string(
    f: MpvGetPropertyString,
    free: MpvFree,
    mpv: *mut c_void,
    name: &str,
) -> Option<String> {
    let cname = CString::new(name).ok()?;
    let p = f(mpv, cname.as_ptr());
    if p.is_null() {
        return None;
    }
    let s = CStr::from_ptr(p).to_string_lossy().into_owned();
    free(p as *mut c_void);
    Some(s)
}
