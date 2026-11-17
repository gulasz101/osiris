# Design: web-perf

Look up first in docs-mcp (library `mdn-web-apis`): `performance.now`, `requestAnimationFrame`,
"Synchronous and asynchronous requests". For wgpu on the web, search the `wgpu` library for
"timestamp query" and "web". Write what you found, with the library name, in this section.

## 1. The clock
Use `web_time::Instant` (already used in `redraw`). On wasm it wraps `performance.now()`, so it
has sub-millisecond steps in Chrome. No new dependency.

Note: `gfx.frame` on the web only records and submits the GPU work; the browser draws later.
The `render` number is the CPU time of building and submitting the frame, plus whatever the
browser blocks on. The rest of the 1/fps gap that is in none of the three parts is `other`
(the browser's own work between frames, including the software GPU). Print it too, so the
three parts are not mistaken for the whole frame.

## 2. `soak::FrameSplit`
Plain code in `soak.rs`, built for both targets with a unit test, like `Fps`.
```rust
pub struct Part { pub sim: f64, pub render: f64, pub io: f64 } // milliseconds
pub struct FrameSplit { /* sums, frame count, worst frame (by sim+render+io), window start */ }
impl FrameSplit {
    pub fn new(now: Instant) -> Self;
    /// One frame's parts and its full length (now - last_frame). Every FPS_EVERY it returns
    /// (average Part, worst Part, average other) and starts a new window.
    pub fn frame(&mut self, now: Instant, part: Part, whole_ms: f64) -> Option<(Part, Part, f64)>;
}
```
Unit test: three frames with known parts over one window give the right average and worst.

## 3. Where the numbers come from
- `redraw` in `main.rs`, `Screen::Playing` only, and only when `crate::web::soak()` is on:
  - sim: the time around `game.update(dt)`.
  - render: the time around the `gfx.frame(|r| { game.draw(r); ... })` call.
  - io: `crate::web::take_io_ms()`, which returns and zeroes the sum kept by `lazy_read`.
- `lazy_read` in `web.rs`: time `files_read(path)` with `web_time::Instant`; add it to a
  `thread_local! Cell<f64>`; count the path in a `thread_local! RefCell<HashMap<String,(u32,f64)>>`
  (reads, total ms). Only when `soak()` is on, so a player pays nothing.
- The log line, next to `osiris web: fps N`, in the same ten-second window:
  `osiris web: frame ms sim X render Y io Z other W (worst sim X render Y io Z)`, one decimal.
- At the end of the 24 months, before `soak OK`: `osiris web: top reads <path> <n>x <ms> ms; ...`
  for the five paths with the most total ms. `smoke.mjs` prints both lines as they are.

## 4. The fix, picked by the numbers
Write the first soak numbers here (task 1.3), then pick by the biggest part:
- **io biggest** (likely: `osiris-audio` opens a WAV through `osiris_vfs::open` each time a
  sound plays, and every open of a lazy entry is a full sync read). Fix in `osiris-vfs`
  `MemFs`: a small cache of lazy reads, keyed by original path, with a byte budget
  (`LAZY_CACHE_BYTES = 32 MiB`), dropping the least recently read entry when over budget, and
  never caching a file bigger than 8 MiB (movies stay uncached). Unit tests in `mem.rs`: a
  second read of a small file does not call the reader; a big file always calls it; going over
  the budget drops the oldest. Memory start must stay below 300 MB.
- **sim biggest**: the smoke test has no Chrome profiler, so time the parts of `World::update` the same way (one line per part, soak only), and make the
  most expensive one cheaper with the same results. The replay tests prove the rules did not
  change. Stop and comment if the only fix changes a rule.
- **render biggest** (and sim and io small): check `gfx.frame` and `game.draw` for work done
  every frame that could be done once: textures or buffers created per frame, a full upload of
  the tile map per frame. Fix one. If nothing like that exists, write in `STATUS.md` that the
  rest is the headless software GPU, with the numbers; that meets the goal.

## 5. After the fix
Run the soak again. Write both lines (before and after) here and in `docs/STATUS.md`.
