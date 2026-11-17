# web-soak: play a long game, a custom map and the Mission Editor in the browser

## Why
Wojtek is about to play for real. Two things have never been tried in the page: a game that
runs long enough for events, floods and invasions to arrive, and the two screens he will reach
first when he wants his own city: Custom Missions and the Mission Editor. The smoke test starts
a city and watches it turn two months; a leak that takes twelve months to show, or a panic on
the editor's save, is invisible today. This change puts those three runs in the smoke test and
records what they measured, so the numbers are on paper before he finds the breakage himself.

## What changes
- `crates/osiris-app/src/soak.rs`: the soak run's own arithmetic, built for both targets so a
  plain unit test proves it: frames per second over a ten-second window, and the run of months
  whose wasm memory only grew (twelve in a row is a leak).
- `crates/osiris-app/src/web.rs`: `set_soak(true)` turns the soak's log lines on, and
  `memory_bytes()` reads the wasm memory's `WebAssembly.Memory.buffer.byteLength`.
- `crates/osiris-app/src/main.rs`: with the soak on, a frame counter logs
  `osiris web: fps <n>` every ten seconds of real time, and each month turn logs
  `osiris web: soak month <n> memory <bytes>`. A run of twelve growing months logs
  `osiris web: soak memory grew every month` once.
- `crates/osiris-app/src/menu.rs`: the list's scroll arrows and the Custom Missions and Mission
  Editor go arrow join `debug_menu_buttons()`, so the smoke test reaches `Small Oasis` on a list
  of 33 maps the way a player does, instead of clicking guessed pixels.
- `crates/osiris-app/src/web.rs` and `main.rs`: `debug_editor()` returns the editor's state as
  JSON (the map's name, whether it is dirty, the last message it showed), and the editor logs
  `osiris web: editor open <name>` on the way in.
- `web/tests/smoke.mjs`: `SMOKE_SOAK=1` plays mission 0 from the menu at the fastest speed for 24
  game months, plays `Small Oasis.map` from Custom Missions for 6 months, and opens
  `Small Oasis.map` in the Mission Editor, paints tiles, saves it under a new name in `/user/maps`
  and goes back to the menu. It fails on a panic, on a month that takes over 60 s, and on twelve
  months of growth in a row, and prints the numbers in `design.md`.
- `scripts/web-smoke.sh`: a timeout long enough for the three runs.
- `docs/STATUS.md`: the Mission Editor and custom maps move out of "untested", with what the
  soak measured.

## Out of scope
Touch input, the game rules, the way the game looks, performance work beyond reporting the
numbers, and every desktop-only tool. A bug this run finds that needs more than three tasks is
written up in `design.md` and the issue is blocked instead of widening this change.
