# Design: web-gpu-fps

### What the docs say (task 1.1)

**`wgpu` 30.0.1, docs-mcp**, queries `Adapter get_info request_adapter backend name` and `Backend
enum BrowserWebGpu Gl variant`:
- `Adapter::get_info(&self) -> AdapterInfo` (docs.rs/wgpu/30.0.1/wgpu/struct.Adapter.html).
  `AdapterInfo` (docs.rs/wgpu/30.0.1/wgpu/struct.AdapterInfo.html) holds `name: String`,
  `vendor: u32`, `device: u32`, `device_type`, `driver: String`, `driver_info: String`,
  `backend: Backend`.
- `Backend` (docs.rs/wgpu/30.0.1/wgpu/enum.Backend.html) is `Noop = 0, Vulkan = 1, Metal = 2,
  Dx12 = 3, Gl = 4, BrowserWebGpu = 5`. The docs describe `Gl` as "OpenGL 3.3+ (Windows),
  OpenGL ES 3.0+ (Linux, Android, MacOS via Angle), and WebGL2" and `BrowserWebGpu` as "WebGPU
  in the browser", so `Gl -> WebGL2` and `BrowserWebGpu -> WebGPU` is the mapping the design
  wants, straight from the enum's own description.
- The page runs `Backends::GL` (`gfx.rs`), and `Backends::from_comma_list` only ever returns
  `WEBGPU` on wasm over the WebGPU backend, which is why the label here is `WebGL2`.

**`playwright`: not in docs-mcp.** The search answers `Library playwright not found in store.`
So this came from Firecrawl (playwright.dev `docs/api/class-browsertype`, which shows
`chromium.launch()` and little else) plus the installed copy's own types,
`web/tests/node_modules/playwright-core/types/types.d.ts` 1.45.0, `interface LaunchOptions`:
`args?: Array<string>` ("Use custom browser args at your own risk, as some of them may break
Playwright functionality"), `channel?: string`, `executablePath?: string`, and `headless`
(`false` makes `channel` unset). So `args` takes Chrome switches as written, and `headless: false`
is the headed switch.

**Chrome flags: not in docs-mcp either.** `mdn-web-apis` has no page on Chrome command-line
switches (the search returned drag-and-drop and File API pages), so Firecrawl again:
- Chromium's own `docs/gpu/using-gpu-hardware-in-headless-chrome.md`: "Headless Chrome can
  utilize the local machine's GPU"; pass `--enable-gpu` to stop headless forcing software
  rendering, otherwise it defers to the driver autodetection. That page's Linux notes are about
  X11 and Vulkan, so it says nothing about macOS or Metal.
- Nothing authoritative on `--ignore-gpu-blocklist` for macOS beyond the Chromium switches list
  and a Stack Overflow thread ("Force headless chromium/chrome to use actual gpu instead of
  Google SwiftShader"), where it did not help. It is a harmless extra flag, not the lever.

**Measured on this host, with the probe below, not from docs:** Playwright's Chromium 1.45.0 on
the M1 Air is *not* software rendering in headless mode. `--use-angle=metal` gives the WebGL2
renderer `ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)`, plain
`--use-angle=gl` gives `ANGLE (Apple, Apple M1, OpenGL 4.1)`, and SwiftShader appears in no
combination. `navigator.gpu` is absent in all of them, so the WebGPU backend is not available to
this Chrome and `WebGL2` is the only label this run can print.

## 1. The adapter line
`gfx.rs` already logs `GPU: {:?}` of `a.get_info()` after `request_adapter`. Add, on
`target_arch = "wasm32"` only, one more line with the same `log::info!`:

    osiris web: gfx backend <B> adapter <name>

`<B>` is `WebGL2` for `wgpu::Backend::Gl` and `WebGPU` for `wgpu::Backend::BrowserWebGpu`
(anything else: the `{:?}` of the backend). `<name>` is `AdapterInfo::name`. On WebGL2 that
name is the GL renderer string Chrome gives (for example `ANGLE (Apple, ANGLE Metal Renderer:
Apple M1, ...)` on a real GPU, or a `SwiftShader` string in software). Put the mapping in a small
pure function `fn backend_label(b: wgpu::Backend) -> String` with a unit test for `Gl` and
`BrowserWebGpu`, so it is tested on the host too.

`smoke.mjs` matches `/osiris web: gfx backend (\S+) adapter (.+)/` and prints the line in every
run (headless too), so STATUS.md can show what the headless run really drew with.

## 2. The GPU launch
With `SMOKE_GPU=1`, `smoke.mjs` replaces `--use-angle=gl` with:

    --use-angle=metal --enable-gpu --ignore-gpu-blocklist --no-sandbox

and keeps `--force-device-scale-factor=1` for viewport runs. Headless stays the default. With
`SMOKE_HEADED=1` it also passes `headless: false` to `chromium.launch` (a window opens on the
M1 Air; that is fine on this host, never in CI). Validate both like `SMOKE_SOAK`: `1` or unset,
anything else FAILs with a clear message.

After the page starts, with `SMOKE_GPU=1`: if no adapter line came, FAIL
`GPU run logged no gfx adapter line`; if the adapter name matches
`/swiftshader|llvmpipe|software|microsoft basic/i`, FAIL
`GPU run got a software adapter: <name>`. Try headless first; only if headless gets a software
adapter, use `SMOKE_HEADED=1` and write which one worked in design 3.

## 3. The numbers (task 1.3)

Both runs: `OSIRIS_DATA=/Users/paperclip/PharaohData/Akhenaten/resources`, same M1 Air host,
same commit, one after the other, both exit 0.

**The GPU run** (`SMOKE_SOAK=1 SMOKE_GPU=1`, headless, no `SMOKE_HEADED` needed: headless got
the GPU on the first try, so the Metal flags above are enough on this host):

    osiris web: gfx backend WebGL2 adapter ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)
    osiris web: frame ms sim 7.1 render 1.4 io 0.1 other 183.1 (worst sim 20.0 render 1.5 io 0.0)
    osiris web: soak OK (24 months, min fps 5, memory start 294 MB end 294 MB)
    osiris web: custom map soak OK (6 months on Small Oasis, min fps 5, memory start 294 MB end 294 MB)
    osiris web: editor OK (Small Oasis edited and saved as /user/maps/Soak Edit.map)
    osiris web: GPU run OK on ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version) via WebGL2

**The default soak** (`SMOKE_SOAK=1`, the unchanged run, `--use-angle=gl`):

    osiris web: gfx backend WebGL2 adapter ANGLE (Apple, Apple M1, OpenGL 4.1)
    osiris web: frame ms sim 9.1 render 2.7 io 0.3 other 171.1 (worst sim 12.1 render 17.2 io 11.4)
    osiris web: soak OK (24 months, min fps 5, memory start 294 MB end 294 MB)
    osiris web: custom map soak OK (6 months on Small Oasis, min fps 5, memory start 294 MB end 294 MB)
    osiris web: editor OK (Small Oasis edited and saved as /user/maps/Soak Edit.map)

Both are the same Apple M1, one through ANGLE on Metal and one through ANGLE on OpenGL. Our own
work is 8.6 ms per frame on Metal and 12.1 ms on OpenGL; `other` is 183.1 ms and 171.1 ms. Asking
for Metal changed neither the fps (5 both) nor the shape of the split, so the GPU was never what
held this run back.

## 4. What limits the frame on a real GPU

The biggest part of the GPU run's frame is `other` at 183.1 ms of a 191.7 ms frame, the time
between our frames that the browser spends and that neither sim, render nor io accounts for;
because Metal and OpenGL land on the same 5 fps with the same `other`, the limit is the
browser's own frame pacing here, not the GPU and not our 8.6 ms of work.

