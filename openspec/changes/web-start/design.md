# Design: web-start

Look up first, in docs-mcp: `winit` 0.30.13 `platform::web` (`EventLoopExtWebSys::spawn_app`,
`WindowAttributesExtWebSys::with_canvas`), `wgpu` 30.0.1 (web backends, the `webgl` feature,
`Limits::downlevel_webgl2_defaults`), `wasm-bindgen-futures::spawn_local`, `mdn-web-apis`
(`File.webkitRelativePath`, `Blob.arrayBuffer`).

## Exports (src/web.rs)
```rust
#[wasm_bindgen]
pub fn mount_file(path: String, bytes: Vec<u8>)
```
`path` is `webkitRelativePath` without its first part (the folder name the player picked), so
`Pharaoh/Data/Pharaoh_General.sg3` is mounted as `/PharaohData/Data/Pharaoh_General.sg3`
(`osiris_vfs::mount`).

```rust
#[wasm_bindgen]
pub fn start_game() -> Result<(), JsValue>
```
Fails with a readable message if `osiris_vfs::is_dir("/PharaohData/Data")` is false ("This folder
does not hold Pharaoh's Data folder."). Otherwise builds the default `Args` with
`data = Some("/PharaohData".into())` and calls the same `run(args)` the desktop uses. Errors
become `JsValue::from_str(&format!("{e:#}"))`.

## Event loop (main.rs, end of `run`)
`event_loop.run_app(&mut app)?` blocks; the browser cannot. Desktop keeps it. Browser:
```rust
#[cfg(target_arch = "wasm32")]
{
    use winit::platform::web::EventLoopExtWebSys;
    event_loop.spawn_app(app);
    return Ok(());
}
```
(`spawn_app` takes `app` by value; check the exact signature in docs-mcp.)

## Window (resumed)
Browser: skip the saved/monitor size logic. Get the canvas
(`web_sys::window()?.document()?.get_element_by_id("osiris")` -> `dyn_into::<HtmlCanvasElement>()`),
un-hide it, and set `Window::default_attributes().with_canvas(Some(canvas))`. Size: the canvas
client size. Add `HtmlCanvasElement` features to web-sys if missing.

## Graphics start (resumed)
Today: `let gfx = pollster::block_on(gfx::Gfx::new(window, library))?;` and then a long tail that
uses `gfx`. Refactor:
1. Move everything in `resumed` after `self.gfx = Some(gfx);` into
   `fn finish_start(&mut self, event_loop: &ActiveEventLoop)`. Desktop `resumed` calls it at the
   end, so desktop behaviour is identical (run `cargo test -p osiris-app` after this step alone).
2. Browser: add a field `#[cfg(target_arch = "wasm32")] pending: Rc<RefCell<Option<Result<(sidebar::SidebarImages, gfx::Gfx)>>>>`
   to `App`. In `resumed`, `wasm_bindgen_futures::spawn_local` an async block that awaits
   `Gfx::new`, stores the result in `pending`, and calls `window.request_redraw()`.
3. Browser: at the top of `window_event`, if `self.gfx.is_none()` and `pending` holds a value,
   take it: on `Ok` set `self.images`/`self.gfx` and call `finish_start`; on `Err` log the error
   and show it in `#status`.
4. When the main menu screen is first set, log `osiris web: main menu` (browser only).

## wgpu in the browser
Add for wasm: `wgpu = { version = "30", features = ["webgl"] }` in the wasm dependency table, so
browsers without WebGPU fall back to WebGL2. If `Gfx::new` fails on WebGL with a limits error, use
`wgpu::Limits::downlevel_webgl2_defaults().using_resolution(adapter.limits())` under
`#[cfg(target_arch = "wasm32")]` in `fn device`.

## main.js
On `change` of `#folder`: `const files = [...input.files]`; for each, `await file.arrayBuffer()`,
`mount_file(rel, new Uint8Array(buf))`, update `#status` every 50 files ("Reading 350 of 2210
files..."). Then hide `#start`, call `start_game()` in `try`; on error show `#start` again with
the message.

## Smoke test with game data
In `smoke.mjs`: if `process.env.OSIRIS_DATA` is set, after `osiris web: ready` call
`page.setInputFiles("#folder", process.env.OSIRIS_DATA)` (Playwright accepts a directory for a
`webkitdirectory` input; check the Playwright docs via Firecrawl if docs-mcp has none), wait up to
120 s for `osiris web: main menu`, then `page.screenshot({ path: "/tmp/osiris-web-menu.png" })`.
Never save the screenshot inside the repo.
