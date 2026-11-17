//! Window surface and offscreen targets around the renderer.

use anyhow::{Context, Result};
use osiris_formats::{ImageLibrary, TextTable};
use osiris_render::Renderer;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use winit::window::Window;

/// The player's interface size (Options menu): 0 is automatic, then 100%, 150% and
/// 200%. It multiplies the system's own display scaling.
static UI_SIZE: AtomicU8 = AtomicU8::new(0);
const UI_SIZES: [(&str, f64); 4] = [("Auto", 0.0), ("100%", 1.0), ("150%", 1.5), ("200%", 2.0)];

pub fn ui_size() -> u8 {
    UI_SIZE.load(Ordering::Relaxed)
}

pub fn set_ui_size(i: u8) {
    UI_SIZE.store(i % UI_SIZES.len() as u8, Ordering::Relaxed);
}

/// The Options menu's label for the interface size.
pub fn ui_size_label() -> String {
    let (name, _) = UI_SIZES[ui_size() as usize];
    format!("{} - {}", crate::lang::tr("Interface size"), if name == "Auto" { crate::lang::tr("Auto") } else { name })
}

pub fn load_ui_size() {
    let s = osiris_vfs::read_to_string(crate::user_dir().join("ui_size.txt")).unwrap_or_default();
    set_ui_size(UI_SIZES.iter().position(|(name, _)| *name == s.trim()).unwrap_or(0) as u8);
}

pub fn save_ui_size() {
    let _ = osiris_vfs::write(crate::user_dir().join("ui_size.txt"), format!("{}\n", UI_SIZES[ui_size() as usize].0));
}

/// Whether the window is (or is about to be) shown full screen. The window itself
/// lives with `Gfx`, which the Options menu's Fullscreen entry doesn't have; this
/// mirrors its state so the entry's label and `main.rs`'s Alt+Enter/F11 handling
/// agree on it, the same way `UI_SIZE` stands in for the window's scale.
static FULLSCREEN: AtomicBool = AtomicBool::new(false);

pub fn fullscreen() -> bool {
    FULLSCREEN.load(Ordering::Relaxed)
}

pub fn set_fullscreen(on: bool) {
    FULLSCREEN.store(on, Ordering::Relaxed);
}

/// The Options menu's label for the fullscreen toggle, in the Autosave entry's form:
/// the original's own "Full screen" (group 42, its display settings) and whether it's on.
pub fn fullscreen_label(text: &TextTable) -> String {
    let name = text.get(42, 1).map_or("Full screen", |s| s.trim());
    format!("{name} - {}  (F11)", if fullscreen() { crate::lang::tr("ON") } else { crate::lang::tr("OFF") })
}

/// Device pixels per interface pixel, for a screen `height` device pixels tall whose
/// system scaling is `system`. Automatic scales the art up on a screen tall enough
/// (in its own logical pixels, so the system's own scaling isn't double-counted)
/// that it would otherwise be a sliver in a corner: a step at 1440p and up (a bare
/// 1440p or an ultrawide of that height, run without the system's own scaling) and
/// a full doubling at 4K and up (2160 logical and up, i.e. 4K without display
/// scaling); 1080p stays as the system sets it.
pub fn ui_scale(system: f64, height: f64) -> f64 {
    let logical = height / system;
    let auto = if logical >= 1800.0 {
        2.0
    } else if logical >= 1300.0 {
        1.5
    } else {
        1.0
    };
    match UI_SIZES[ui_size() as usize].1 {
        0.0 => system * auto,
        f => system * f,
    }
}

const CLEAR: wgpu::Color = wgpu::Color {
    r: 0.0,
    g: 0.0,
    b: 0.0,
    a: 1.0,
};

/// The backend's name for the page's log line. On the web the GL backend is WebGL2 and
/// the WebGPU backend is WebGPU; any other backend keeps `wgpu`'s own name.
#[cfg(any(target_arch = "wasm32", test))]
pub fn backend_label(backend: wgpu::Backend) -> String {
    match backend {
        wgpu::Backend::Gl => "WebGL2".to_string(),
        wgpu::Backend::BrowserWebGpu => "WebGPU".to_string(),
        other => format!("{other:?}"),
    }
}

/// The GPU to draw with: the fast one if there is one, else any, else the system's
/// software renderer (WARP on Windows), so a virtual machine or an old driver still
/// gets a picture instead of no window at all.
async fn adapter(
    instance: &wgpu::Instance,
    surface: Option<&wgpu::Surface<'_>>,
) -> Result<wgpu::Adapter> {
    let tries = [
        (wgpu::PowerPreference::HighPerformance, false),
        (wgpu::PowerPreference::LowPower, false),
        (wgpu::PowerPreference::None, true),
    ];
    let mut last = None;
    for (power_preference, force_fallback_adapter) in tries {
        match instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference,
                force_fallback_adapter,
                compatible_surface: surface,
                ..Default::default()
            })
            .await
        {
            Ok(a) => {
                let info = a.get_info();
                log::info!("GPU: {:?}", info);
                // The page and the smoke test read this one line to know which backend and
                // which piece of hardware they really got: a software adapter makes a slow
                // smoke run look like a slow game (web-gpu-fps).
                #[cfg(target_arch = "wasm32")]
                log::info!(
                    "osiris web: gfx backend {} adapter {}",
                    backend_label(info.backend),
                    info.name
                );
                return Ok(a);
            }
            Err(e) => last = Some(e),
        }
    }
    Err(anyhow::anyhow!("{}", last.map_or_else(String::new, |e| e.to_string()))).context(crate::lang::tr("Osiris found no graphics adapter it can draw with (DirectX 12, Vulkan, Metal or OpenGL)"))
}

async fn device(adapter: &wgpu::Adapter) -> Result<(wgpu::Device, wgpu::Queue)> {
    // The atlas pages are 4096 square; ask for no more than the adapter has, so an
    // OpenGL or software adapter below the default limits still gives a device.
    #[cfg(target_arch = "wasm32")]
    let required_limits =
        wgpu::Limits::downlevel_webgl2_defaults().using_resolution(adapter.limits());
    #[cfg(not(target_arch = "wasm32"))]
    let required_limits = wgpu::Limits::downlevel_defaults().using_resolution(adapter.limits());
    adapter
        .request_device(&wgpu::DeviceDescriptor { required_limits, ..Default::default() })
        .await
        .context("the graphics adapter refused to start")
}

/// Prefer a non-sRGB format so sprite colours reach the screen unchanged.
fn pick_format(formats: &[wgpu::TextureFormat]) -> wgpu::TextureFormat {
    formats
        .iter()
        .copied()
        .find(|f| !f.is_srgb())
        .unwrap_or(formats[0])
}

pub struct Gfx {
    pub window: Arc<Window>,
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    pub renderer: Renderer,
}

impl Gfx {
    pub async fn new(window: Window, library: ImageLibrary) -> Result<Self> {
        // In the browser the window's own `inner_size` is only filled in by
        // winit's resize observer, which has not run yet when graphics start:
        // it reads 0, the surface would be configured 1x1 and nothing would be
        // drawn. Take the size from the canvas instead: the page (`main.js`
        // `fitCanvas`) set the bitmap to the window's size in device pixels, so
        // it is exactly the drawing buffer the surface is about to configure.
        #[cfg(target_arch = "wasm32")]
        let size = {
            use winit::platform::web::WindowExtWebSys;
            window.canvas().map_or_else(
                || window.inner_size(),
                |canvas| {
                    winit::dpi::PhysicalSize::new(canvas.width().max(1), canvas.height().max(1))
                },
            )
        };
        #[cfg(not(target_arch = "wasm32"))]
        let size = window.inner_size();
        let window = Arc::new(window);
        #[cfg(target_arch = "wasm32")]
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::GL,
            ..wgpu::InstanceDescriptor::new_without_display_handle()
        });
        #[cfg(not(target_arch = "wasm32"))]
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        let surface = instance.create_surface(window.clone())?;
        let adapter = adapter(&instance, Some(&surface)).await?;
        let (device, queue) = device(&adapter).await?;
        let mut config = surface
            .get_default_config(&adapter, size.width.max(1), size.height.max(1))
            .context("surface unsupported")?;
        config.format = pick_format(&surface.get_capabilities(&adapter).formats);
        config.present_mode = wgpu::PresentMode::AutoVsync;
        surface.configure(&device, &config);
        let renderer = Renderer::new(device, queue, config.format, library);
        let mut gfx = Self {
            window,
            surface,
            config,
            renderer,
        };
        gfx.fit();
        Ok(gfx)
    }

    /// Device pixels per interface pixel: the system's scaling times the player's
    /// interface size.
    pub fn scale(&self) -> f64 {
        ui_scale(self.window.scale_factor(), self.config.height as f64)
    }

    /// Sets the renderer's screen to the surface in interface pixels.
    fn fit(&mut self) {
        let scale = self.scale() as f32;
        self.renderer.screen = [self.config.width as f32 / scale, self.config.height as f32 / scale];
        self.renderer.scale = scale;
    }

    pub fn resize(&mut self, w: u32, h: u32) {
        self.config.width = w.max(1);
        self.config.height = h.max(1);
        self.surface.configure(self.renderer.device(), &self.config);
        self.fit();
    }

    pub fn frame(&mut self, draw: impl FnOnce(&mut Renderer)) {
        let frame = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(f)
            | wgpu::CurrentSurfaceTexture::Suboptimal(f) => f,
            _ => {
                self.surface.configure(self.renderer.device(), &self.config);
                return;
            }
        };
        let view = frame.texture.create_view(&Default::default());
        // The interface size can change between frames.
        self.fit();
        draw(&mut self.renderer);
        self.renderer.flush(&view, Some(CLEAR));
        self.window.pre_present_notify();
        self.renderer.queue().present(frame);
    }
}

/// Renders one frame offscreen and writes it to `out` as PNG.
/// The interface scale a screenshot `h` pixels high is drawn at (OSIRIS_SCALE=2
/// renders as a Retina display would: the same pixels, laid out at half the size).
fn screenshot_scale(h: u32) -> f32 {
    let system = std::env::var("OSIRIS_SCALE").ok().and_then(|s| s.parse::<f64>().ok()).unwrap_or(1.0).max(1.0);
    ui_scale(system, h as f64) as f32
}

/// The screen a screenshot of `size` pixels lays its interface out on.
pub fn screenshot_screen((w, h): (u32, u32)) -> [f32; 2] {
    let scale = screenshot_scale(h);
    [w as f32 / scale, h as f32 / scale]
}

pub fn screenshot(
    library: ImageLibrary,
    size: (u32, u32),
    out: &std::path::Path,
    mut draw: impl FnMut(&mut Renderer),
) -> Result<()> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
    let adapter = pollster::block_on(adapter(&instance, None))?;
    let (device, queue) = pollster::block_on(device(&adapter))?;
    let format = wgpu::TextureFormat::Rgba8Unorm;
    let (w, h) = size;
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("screenshot"),
        size: wgpu::Extent3d {
            width: w,
            height: h,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let mut renderer = Renderer::new(device, queue, format, library);
    // OSIRIS_SCALE=2 renders as a Retina display would: the same pixels, laid out at
    // half the size. Any factor goes, which stands in for the interface size that
    // screenshots don't read: 1.5 is 150% on a plain display, 3 is 150% on Retina.
    let scale = screenshot_scale(h);
    renderer.scale = scale;
    renderer.screen = [w as f32 / scale, h as f32 / scale];
    let first = web_time::Instant::now();
    draw(&mut renderer);
    let first_build = first.elapsed();
    let sprites = renderer.instance_count();
    let t0 = web_time::Instant::now();
    renderer.flush(&texture.create_view(&Default::default()), Some(CLEAR));
    // OSIRIS_BENCH_FRAMES=N draws N more frames and reports the time spent building
    // the sprite list and drawing it, for benchmarks.
    if let Some(n) = std::env::var("OSIRIS_BENCH_FRAMES").ok().and_then(|s| s.parse::<u32>().ok()) {
        let view = texture.create_view(&Default::default());
        let (mut build, mut gpu) = (std::time::Duration::ZERO, std::time::Duration::ZERO);
        for _ in 0..n {
            let t = web_time::Instant::now();
            draw(&mut renderer);
            build += t.elapsed();
            let t = web_time::Instant::now();
            renderer.flush(&view, Some(CLEAR));
            renderer.device().poll(wgpu::PollType::wait_indefinitely())?;
            gpu += t.elapsed();
        }
        eprintln!("frames {n}: build {:?} draw {:?} per frame; the first frame built in {first_build:?}", build / n.max(1), gpu / n.max(1));
        draw(&mut renderer);
        renderer.flush(&view, Some(CLEAR));
    }

    let row = (w * 4).div_ceil(256) * 256;
    let buffer = renderer.device().create_buffer(&wgpu::BufferDescriptor {
        label: Some("readback"),
        size: (row * h) as u64,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut enc = renderer
        .device()
        .create_command_encoder(&Default::default());
    enc.copy_texture_to_buffer(
        texture.as_image_copy(),
        wgpu::TexelCopyBufferInfo {
            buffer: &buffer,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(row),
                rows_per_image: Some(h),
            },
        },
        texture.size(),
    );
    renderer.queue().submit([enc.finish()]);
    let slice = buffer.slice(..);
    slice.map_async(wgpu::MapMode::Read, |r| r.expect("map readback"));
    renderer
        .device()
        .poll(wgpu::PollType::wait_indefinitely())?;
    let data = slice.get_mapped_range()?;
    let mut pixels = Vec::with_capacity((w * h * 4) as usize);
    for y in 0..h {
        let start = (y * row) as usize;
        pixels.extend_from_slice(&data[start..start + (w * 4) as usize]);
    }
    drop(data);
    eprintln!("rendered {sprites} sprites in {:?}", t0.elapsed());
    // Encode the PNG into a Vec<u8>, then write it through osiris_vfs.
    let mut data = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut data, w, h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header()?;
        writer.write_image_data(&pixels)?;
    }
    osiris_vfs::write(out, data)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backend_label_names_the_two_web_backends() {
        // The page is the only place these two are ever seen, and the page is the one
        // place a test cannot run, so the names are checked here on the host.
        assert_eq!(backend_label(wgpu::Backend::Gl), "WebGL2");
        assert_eq!(backend_label(wgpu::Backend::BrowserWebGpu), "WebGPU");
        // Anything else keeps the backend's own name, so a wrong backend is visible.
        assert_eq!(backend_label(wgpu::Backend::Metal), "Metal");
        assert_eq!(backend_label(wgpu::Backend::Vulkan), "Vulkan");
    }
}
