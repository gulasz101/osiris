# web-page: a page that loads the wasm build and waits for the game folder

## Why
We need a real page in a real browser before we try to start the game in it. This change builds
the wasm file, puts it on a page with a canvas and a "Choose your Pharaoh folder" button, and
proves with a headless browser test that the module starts without a panic.

## What changes
- Browser entry in `crates/osiris-app/src/main.rs`: on wasm, `main()` sets a panic hook and a
  console logger, logs `osiris web: ready`, and returns. The desktop `main()` is unchanged.
- `web/index.html` + `web/main.js`: canvas, folder button, status line.
- `scripts/build-web.sh`: release build for wasm + `wasm-bindgen` into `web/pkg/` (git-ignored).
- `scripts/web-smoke.sh` + `web/tests/smoke.mjs`: serve `web/`, open it in headless Chromium,
  fail on a panic or a missing `osiris web: ready` line.

## Out of scope
Loading the folder and starting the game: change `web-start`.

## Needs on the host (Andrzej, before this change starts)
`wasm-bindgen` CLI 0.2.128 in `~/.cargo/bin` (must match the `wasm-bindgen` crate in
`Cargo.lock`), and a Playwright command that runs the cached Chromium. The issue says what was
installed.
