# Design: web-page

Look up every call below in docs-mcp (`wasm-bindgen`, `web-sys`, `console_error_panic_hook`,
`mdn-web-apis`) before writing it.

## Dependencies (crates/osiris-app/Cargo.toml, wasm only)
Add to the existing `[target.'cfg(target_arch = "wasm32")'.dependencies]`:

```toml
wasm-bindgen = "0.2"             # Cargo.lock keeps 0.2.128; the CLI must be the same version
wasm-bindgen-futures = "0.4"
console_error_panic_hook = "0.1"
web-sys = { version = "0.3", features = ["Window", "Document", "Element", "HtmlCanvasElement", "console"] }
```

After `cargo check`, confirm `grep -A1 'name = "wasm-bindgen"' Cargo.lock` still says 0.2.128.
If it changed, stop and tell the PM (the CLI would no longer match).

## Browser main (crates/osiris-app/src/main.rs)
- Rename nothing on desktop. Gate the existing `fn main() -> Result<()>` with
  `#[cfg(not(target_arch = "wasm32"))]`.
- Add a new file `src/web.rs` (declared in `main.rs` as `#[cfg(target_arch = "wasm32")] mod web;`)
  with:
  - `fn init()`: `console_error_panic_hook::set_once()`, then a small `log::Log` implementation
    that sends each record to `web_sys::console::log_1` (`warn`/`error` to `console::warn_1` /
    `console::error_1`), installed with `log::set_logger` + `log::set_max_level(Info)`.
- Add the browser `main`:

```rust
/// In the browser `main` only prepares the page; the game starts when the player has handed over
/// the game folder (see web.rs).
#[cfg(target_arch = "wasm32")]
fn main() {
    web::init();
    log::info!("osiris web: ready");
}
```

wasm-bindgen runs a binary's `main` when the module starts (docs-mcp `wasm-bindgen`: search
"main function binary start"). If it does not with 0.2.128, put `#[wasm_bindgen(start)]` on a
`pub fn web_start()` in `web.rs` instead and say so in the issue comment.

Things that become unused on wasm after gating `main` (for example `run`, `parse_args`): gate
them with `#[cfg(not(target_arch = "wasm32"))]` only if the wasm check warns; `web-start` will
use `run` again, so prefer `#[cfg_attr(target_arch = "wasm32", allow(dead_code))]` on `run` and
its helpers for now.

## scripts/build-web.sh
```
#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
cargo build --release --target wasm32-unknown-unknown -p osiris-app
wasm-bindgen --target web --no-typescript --out-dir web/pkg --out-name osiris \
  target/wasm32-unknown-unknown/release/osiris.wasm
ls -l web/pkg
```
Add `web/pkg/` and `web/tests/node_modules/` to `.gitignore`.

## web/index.html + web/main.js
- `index.html`: a full-window `<canvas id="osiris" hidden>`, a `<div id="start">` with a heading
  "Osiris: Pharaoh in your browser", one line of text ("Choose the folder where Pharaoh is
  installed. The files stay on your computer; nothing is uploaded."), an
  `<input type="file" id="folder" webkitdirectory multiple>`, and `<p id="status">`.
  Script: `<script type="module" src="main.js"></script>`. No external URLs, no CDN.
- `main.js`: `import init from "./pkg/osiris.js"; await init();` then set `#status` to
  "Ready." If `init` throws, show the error in `#status` and `console.error` it.
  The folder input does nothing yet (web-start).

## Smoke test
- `web/tests/package.json`: private, `"type": "module"`, one devDependency `playwright` pinned to
  the exact version the host issue names (it must match the cached Chromium in
  `~/Library/Caches/ms-playwright`).
- `web/tests/smoke.mjs`: start a static server on `web/` (Node `http` module, port 8765, serve
  `.wasm` as `application/wasm` and `.js` as `text/javascript`), launch Chromium headless, collect
  every console message, open `http://localhost:8765/`, wait up to 30 s for a message containing
  `osiris web: ready`. Exit 1 if it never comes or if any message contains `panicked`. Print the
  console messages. Close the server and the browser in `finally`.
- `scripts/web-smoke.sh`: `scripts/build-web.sh`, then `cd web/tests && npm install --silent &&
  timeout 120 node smoke.mjs`.

## Gate
`scripts/check.sh` does not run the browser test (it is slow). The issue's last task runs
`scripts/web-smoke.sh` once and pastes its output.
