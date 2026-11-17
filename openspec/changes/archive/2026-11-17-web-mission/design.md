# Design: web-mission

Look up first, in docs-mcp, then Firecrawl if missing: `wasm-bindgen` (exported function with an
`Option<u32>` parameter), `serde_json` (`to_string`), `playwright` (`page.mouse.click`,
`page.keyboard.type`, `page.screenshot` to a buffer, `page.goto` with a query string),
`mdn-web-apis` (`URLSearchParams`). Write in the issue comment which pages you read.

Game data for the tests: `/Users/paperclip/PharaohData/Akhenaten/resources`, read only. Never copy
it into the repo; `web/game-data-staging` is git-ignored and `scripts/no-game-files.sh` must pass.

## 1. Direct start (src/web.rs, web/main.js)
```rust
#[wasm_bindgen]
pub fn start_game(mission: Option<u32>) -> Result<(), JsValue>
```
Same as today, with `mission: mission.map(|m| m as usize)` in `Args`. `finish_start` in `main.rs`
already starts `Source::Mission(n)` when `args.mission` is set; do not add a second path.

`web/main.js`: `const m = new URLSearchParams(location.search).get("mission");` and call
`start_game(m === null ? undefined : Number(m))`. A value that is not a whole number shows
"mission must be a number" in `#status` and does not start.

## 2. Log lines (browser only, `#[cfg(target_arch = "wasm32")]`)
- `osiris web: city <m> started`: at the end of `App::start` (main.rs, `fn start`), `<m>` is the
  mission number or `map` for a custom map.
- `osiris web: city month <n>`: where the city screen advances the simulation each frame; keep the
  last month in a field on `App` (or `Game`) and log only when it changes. Use the month counter
  the top bar already shows (find it in `top_menu.rs` / `game.rs`); do not add a new counter to
  `osiris-sim`.
- `osiris web: page <name>`: in `menu.rs`, where the menu changes page (`fn go`), with
  `format!("{page:?}")` lowercased (`family`, `newfamily`, `main`, `campaign`, `briefing`, ...).
- `osiris web: panic`: the panic hook already logs panics; check that the smoke test's panic
  check still matches it.

## 3. debug_menu_buttons (src/web.rs, menu.rs)
```rust
#[wasm_bindgen]
pub fn debug_menu_buttons() -> String
```
Returns `[{"action":"Go(Campaign)","label":"Begin Family History","x":..,"y":..,"w":..,"h":..}]`
for the menu page drawn last, in CSS pixels of the canvas. Fill a `thread_local!` list in the code
that lays out the menu's clickable rows (where clicks are hit-tested), browser only. `action` is
`format!("{action:?}")` of the existing `Action` enum; `label` is the drawn text. When no menu is
on screen, return `[]`. Convert from the renderer's pixels to CSS pixels with the window's scale
factor (`window.scale_factor()`).

## 4. Smoke test (web/tests/smoke.mjs)
Only when `OSIRIS_DATA` is set and `SMOKE_MISSION` is `direct` or `menu`; otherwise the test does
what it does today. Timeout for the whole run: `SMOKE_TIMEOUT` or 600 s.

- `direct`: load the page with `?mission=3` (the mission README.md uses), choose the folder as
  today, wait for `osiris web: city 3 started`.
- `menu`: load the page with no query, choose the folder, wait for `osiris web: page family`.
  Then a helper `click(actionPrefix)` reads `debug_menu_buttons()`, finds the first button whose
  `action` starts with the prefix, and clicks its centre. Flow (check each name against `menu.rs`
  before you write it): the registry's new-family button, type `Smoke` and press Enter, wait for
  `page main`, click `Go(Campaign)`, click the first mission, wait for `page briefing`, click the
  briefing's to-city button, wait for `osiris web: city ` and `started`.
- Both: wait up to 300 s for two different `osiris web: city month` lines. Fail on any panic line.
  Then `page.screenshot({ path: "/tmp/osiris-web-city.png" })` and fail if the file is under
  50 000 bytes (a blank or one-colour canvas compresses far below that). Never write the
  screenshot inside the repo.

If a month takes too long at the default speed, the test may raise the speed with the same key the
desktop uses (find it in `game.rs`); say so in a comment in the test.

## 5. scripts/check.sh
No change: the data-free smoke run stays as it is. The data runs are manual checks named in
tasks.md, because CI has no game data.
