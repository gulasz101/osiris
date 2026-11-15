# web-start: choose the Pharaoh folder in the page and reach the main menu

## Why
This is the first time the game itself runs in the browser: the player picks their Pharaoh
folder, the page copies its files into the in-memory store, and the game opens on its main menu.

## What changes
- `web/main.js`: on folder choice, read every file with the File API and pass it to the wasm
  function `mount_file`, with a progress line; then call `start_game`.
- `src/web.rs`: `mount_file(path, bytes)` and `start_game()` exported with `#[wasm_bindgen]`.
- `main.rs`: in the browser the event loop is started with winit's `spawn_app`, the window uses
  the page's `<canvas id="osiris">`, and the graphics start asynchronously (no `pollster` in the
  browser). The part of `resumed` after the graphics exist moves into a new method so both the
  desktop and the browser path call it.
- The smoke test, when the env var `OSIRIS_DATA` points at a Pharaoh folder, also loads that
  folder and waits for `osiris web: main menu`, then saves a screenshot outside the repo.

## Out of scope
Movies, sound, keeping saves across page loads, drag and drop of a folder (button only).
