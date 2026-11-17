# Design: web-gpu-fps

### What the docs say (task 1.1)
_Task 1.1 fills this in: the docs-mcp searches (library name and query) and what they said about
Playwright `chromium.launch` (`headless`, `args`, `channel`), Chrome's `--use-angle=metal`,
`--enable-gpu` and `--ignore-gpu-blocklist` on macOS, and wgpu `Adapter::get_info` /
`AdapterInfo` (`name`, `backend`, `device_type`). Firecrawl only for what docs-mcp lacks; say so._

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
_Task 1.3 pastes here: the adapter line, `soak OK (...)` and the `frame ms ...` line of the
headless run and of the GPU run, and which mode (headless or headed) gave the GPU._

## 4. What limits the frame on a real GPU
_Task 1.3 writes one sentence: the biggest part of the GPU run's frame split. If GPU min fps is
under 20, name it as the next thing to fix. Do not fix it here._
