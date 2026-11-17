# web-mission: start a mission in the browser and let the city run

## Why
The page reaches the main menu (web-start) with sound (web-sound). The last step of the proof of
concept (GUL-1518, step 2) is a city that runs: the player starts a mission and time passes with
no panic. Until a test proves it, we do not know that the city screen, the renderer and the
simulation work in wasm.

## What changes
- `src/web.rs`: `start_game` takes an optional mission number. `?mission=N` in the page URL
  starts that mission directly, as `osiris --mission N` does on the desktop.
- Browser-only log lines the smoke test waits for: `osiris web: page <name>` on each menu page,
  `osiris web: city <mission> started`, and `osiris web: city month <n>` when the game month
  changes.
- Browser-only export `debug_menu_buttons()`: the current menu page's buttons as JSON (action and
  screen rectangle), so the test clicks real buttons instead of guessed pixels.
- `web/tests/smoke.mjs`: with `OSIRIS_DATA` and `SMOKE_MISSION=direct` it opens `?mission=3`; with
  `SMOKE_MISSION=menu` it clicks from the family registry to the first mission's city. In both,
  it waits for two month changes, fails on a panic, and saves `/tmp/osiris-web-city.png`.

## Out of scope
Movies (web-movies), saving a running city, the Mission Editor, touch input, speed settings.
