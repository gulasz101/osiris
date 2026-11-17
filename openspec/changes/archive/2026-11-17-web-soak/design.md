# Design: web-soak

## Where the soak's numbers come from
The run has three parts, and each one is driven from `web/tests/smoke.mjs` the way a player would
drive it: clicks on the menu's buttons and keys on the game's canvas. Nothing is faked from the
outside and the game is not asked to skip anything.

Two numbers need the program itself, because nothing outside it can see them:

- **Frames per second.** The page's `requestAnimationFrame` rate is not the game's frame rate: the
  renderer draws when winit asks it to redraw, and headless Chromium's rAF would report about 60
  whatever the game did. The program counts its own redraws and logs the rate.
- **The wasm memory.** `WebAssembly.Memory.prototype.buffer.byteLength` is the byte length of the
  memory instance's buffer, and its `grow()` detaches the buffer it replaces (MDN, `WebAssembly.Memory`).
  The page's own JavaScript cannot reach the instance (wasm-bindgen keeps it private), so
  `web.rs` asks for it with `wasm_bindgen::memory()` — "returns a handle to this Wasm instance's
  `WebAssembly.Memory`" (wasm-bindgen API docs) — and reads `buffer.byteLength` from that.

## 1. The arithmetic, in a file both targets build
`soak.rs` holds the two sums and nothing else, so `cargo test` proves them on this machine without
a browser:

```rust
pub const FPS_EVERY: Duration = Duration::from_secs(10);
pub const GROWTH_RUN: usize = 12;

pub struct Fps { frames: u32, since: web_time::Instant }
impl Fps {
    pub fn new(now: web_time::Instant) -> Self;
    /// Counts a frame; `Some(fps)` when the window has passed, which starts a new one.
    pub fn frame(&mut self, now: web_time::Instant) -> Option<f64>;
}

pub struct Growth { last: u64, run: usize }
impl Growth {
    /// Records a month's memory; `true` when every month since the first has grown.
    pub fn month(&mut self, bytes: u64) -> bool;
    pub fn run(&self) -> usize;
}
```

`frame` and `month` take the moment and the byte count as arguments instead of reading a clock
themselves, which is what makes the test a plain loop over made-up times: 100 frames over 10 s is
10 fps, a window that has not passed returns nothing, and eleven growing months pass while the
twelfth fails. The memory grows in 64 KiB pages, so a month's reading is only ever compared with
the month before it.

## 2. Why twelve months of growth is the rule
A city that gains something each month without losing it — a leaked sprite, a growing event list
— shows up as memory that never comes back down. One growing month means nothing (a page is
64 KiB), so the rule waits for twelve in a row. The run reports the run of growing months even
when it stays under twelve, because the number in `design.md` is worth having.

## 3. The browser hooks
`web.rs`, browser only:

```rust
pub fn set_soak(on: bool);          // #[wasm_bindgen], called by the smoke test
pub fn soak() -> bool;              // for main.rs
pub fn memory_bytes() -> u64;       // wasm_bindgen::memory().buffer().byte_length()
pub fn debug_editor() -> String;    // the editor's state as JSON
```

The soak lines are off in normal play: a player's console stays quiet, and `SMOKE_SOAK=1` turns
them on with one `page.evaluate` before the city starts. `WebAssembly.Memory.buffer.byteLength`
returns a f64 to JavaScript; `memory_bytes` returns it as a `f64` too, so the page does not see a
rounded BigInt.

## 4. The log lines
`main.rs`, browser only, next to the month line `web-mission` already logs:

- `osiris web: fps <n>` every ten seconds, `<n>` the frames in the last window divided by its
  length, rounded to a whole number.
- `osiris web: soak month <n> memory <bytes>` on each month turn, after the month line.
- `osiris web: soak memory grew every month`, once, when the twelfth growing month arrives.
- `osiris web: editor open <name>` when the Mission Editor opens a map, so the test knows the
  editor is up without polling a frame.

The fps line goes through `RedrawRequested`, which is where `redraw()` already runs, so the count
is the game's own frames and not the page's repaints.

`debug_editor()` is filled as the editor draws, like `debug_menu_buttons()` is filled by the menu,
and prints:

```json
{"name":"Small Oasis","dirty":true,"path":null,"status":"Saved /user/maps/Soak Edit.map","tool":"paint"}
```

`status` is the last message the editor showed (`Editor::say`), which is where `save_as` reports
the path it wrote. The test reads it instead of guessing whether the write worked.

## 5. Reaching `Small Oasis` on the lists
`Maps/` holds 33 maps and the list shows 15 at a time, so `Small Oasis` (27th) is off screen both
on Custom Missions and on the Mission Editor's list. The scroll arrows are drawn and clicked but
were never in `debug_menu_buttons()`, so the test had no way to reach a row below the fold. They
join the list as `Scroll(-1)` and `Scroll(1)`, and the two pages that play or edit the picked row
get their go arrow as `Choose(StartMap)` and `Choose(StartEdit)`. Their rects are the game's own
button tables (`ARROW_X`, `ARROW_DOWN_Y`, `PLAY_BUTTON`), turned into canvas pixels the same way
the rows already are.

This is a debug affordance, not a game change: the arrows and the go arrow are drawn and clicked
exactly as before, and the list only gains two more entries when the browser prints its buttons.

## 6. `SMOKE_SOAK=1`: 24 months of mission 0
The smoke test walks the menu the way `SMOKE_MISSION=menu` does: skip the intro, make the `Soak`
family, choose it, Explore History, the first mission, its briefing, the city. It then clicks the
canvas (the keyboard needs the click to focus) and presses `]` eleven times, which walks the
speed ladder `game.rs` holds (10 % to 200 times normal) from 70 % to the fastest. The run turns
`set_soak(true)` on before the first month.

A month takes about 0.08 s of simulation at the fastest speed, so 24 months is a minute or two of
real time; the test waits for each one with a 60 s deadline of its own (the issue's number) and
fails on a panic at any point. Escape is pressed now and then, because a message or a briefing
that opens stops the clock where it stands (the `web-mission` run does the same).

The test sums what it saw into one line, which is the issue's acceptance line:

```
osiris web: soak OK (24 months, min fps 48, memory start 214 MB end 251 MB)
```

## 7. `SMOKE_SOAK=1`, second run: a custom map
Back at the menu (`File > Main Menu` through the city's top bar would ask "Leave the Kingdom?";
the test presses Escape and answers yes, the way a player leaves), it goes Main → Custom Missions,
scrolls to `Small Oasis`, picks it, and clicks the go arrow. The city starts through
`start_map`, so the `city map started` line is the same one a mission uses. Six months with the
same watchdog, print:

```
osiris web: custom map soak OK (6 months on Small Oasis, min fps 47, memory start 236 MB end 244 MB)
```

The six-month run also proves the map's own scenario (its events, its start date) loads from
`Maps/` in the browser, which was never tried.

## 8. `SMOKE_SOAK=1`, third run: the Mission Editor
The same session's menu, Main → Mission Editor, scroll to `Small Oasis`, go arrow. The editor
opens with no tool picked (`Tool::None`), so the test clicks tool button 0 — Grass, at
`panel_left(w) + 13, TOP + 267`, from `view.rs`'s `BUTTONS` and `TOP` — and clicks three points
on the map. `debug_editor()` then says `dirty: true`, which is the paint landing.

Save is `File > Save` on the editor's own menu bar: the same header at `[20, 15]` the city uses,
and the third entry (`Save`, code 3) at y 92 as the city's `Load game` is. The save-name popup
opens with the map's own name in it; the test backspaces it away, types `Soak Edit` and presses
Enter, so the map is written to `/user/maps/Soak Edit.map` — `maps_dir()` under `/user`, the same
folder the editor has always used. `debug_editor()`'s `status` then holds `Saved
/user/maps/Soak Edit.map`, and the test checks it.

Back is `File > Exit` (code 4, fifth entry at y 132), which the app carries out as
`Request::Exit` and the menu logs `osiris web: page main`. The line printed is:

```
osiris web: editor OK (Small Oasis painted and saved as /user/maps/Soak Edit.map, back at the menu)
```

## 9. What `page.evaluate` does not give us
Playwright's `page.evaluate` waits for the function's promise and takes no timeout of its own
(Playwright `page.evaluate` docs), so a page that stops drawing would hang the run until
`scripts/web-smoke.sh`'s `timeout` kills it with no explanation. The soak therefore polls from
Node with the existing `until()` helper and keeps the deadline in its own hands, and never awaits
anything inside the page that could wait forever.

## 10. The numbers
Measured by task 1.8 with `OSIRIS_DATA=<folder> SMOKE_SOAK=1 scripts/web-smoke.sh`.

| Run | Months | Min fps | Memory start | Memory end | Longest growing run |
|---|---|---|---|---|---|
| mission 0, fastest speed | 24 | 7 | 931 MB | 931 MB | none, the size never moved |
| `Small Oasis.map`, fastest speed | 6 | 7 | 931 MB | 931 MB | none, the size never moved |

The memory figure is `975765504` bytes (931 MB) at every one of the thirty months the two runs
logged, so the growth rule had nothing to trip on and the run passed on its other two counts. The
7 frames a second were measured over ten second windows in a headless Chromium that shared the
machine with another build, so it is a floor from a busy machine, not a fast one. A desktop run
of the same city is quicker, and the page has no threads: the game's own animation, the movie
decoder and the autosaves all draw from the same frame budget.
