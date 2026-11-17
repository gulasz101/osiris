# web-loading: show each step of the start

## Why
Wojtek's second review (GUL-1739): the title screen looks good, but the start still feels
unfinished. After Enter it takes several seconds and nothing says what is happening. Two causes:
- The page opens before the 13.8 MB engine has downloaded, and the menu changes under the player
  once it has, with nothing on screen in between.
- `start_game` did all of its slow work in one go on the page's thread, so the browser could not
  paint the loading screen until the start was nearly over. A real start on an M1 spends 1.0 s
  opening files, 4.5 s in `Defs::load`, 0.3 s on graphics and 1.0 s on the intro and menu.

## What changes
- `web/boot.js` (new): the start's steps, the lines the page prints, and `fetchWasm`, which
  counts the wasm's bytes as they arrive and hands them on as a streaming `Response`.
- The title screen shows a boot line and bar (`#boot`) while the engine downloads and while the
  game files kept in the browser are opened; the menu appears once the page is ready.
- `start_game` is async. It calls `web::stage_painted` before each slow step, which calls the
  page's `globalThis.osirisStage(name)` and waits until the browser has painted it. The steps are
  `files`, `rules`, `graphics` (in `resumed`) and `menu` (in `finish_start`), each logged as
  `osiris web: stage <name> at N ms`.
- `run()` is split into `run_args`, `open_library`, `load_assets` and `run_loaded`, so the web
  start can pause between them. The desktop calls them in the same order as before.
- The loading screen shows the four steps with a tick and the time each took, and a real bar.
  The bar moves with a CSS transform transition, which the browser runs off the page's thread,
  so it keeps moving during `Defs::load`.
- A graphics failure after `start_game` calls `globalThis.osirisFailed`, and the loading screen
  shows the message and a Reload button instead of waiting forever.
- `scripts/build-web.sh` writes `web/pkg/osiris_size.json` (GitHub Pages sends the wasm gzipped,
  so Content-Length is not the size the page counts); `pages-site.sh` publishes it and
  `check-site.sh` allows it.
- `web/tests/boot-test.mjs` (in `scripts/check.sh`); the smoke run checks the four steps.

## What does not change
- Game rules (`osiris-sim`), the game's own screens, and the desktop build's behaviour.
