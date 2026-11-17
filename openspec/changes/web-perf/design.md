# Design: web-perf

Look up first in docs-mcp (library `mdn-web-apis`): `performance.now`, `requestAnimationFrame`,
"Synchronous and asynchronous requests". For wgpu on the web, search the `wgpu` library for
"timestamp query" and "web". Write what you found, with the library name, in this section.

### What the docs say (task 1.1)

- **`mdn-web-apis`** (docs-mcp) holds only part of MDN: searches for `performance.now` and
  `requestAnimationFrame` came back with unrelated pages (`File.lastModified`, the drag-and-drop
  guide). So the three MDN pages were read with the `web-search` skill (Firecrawl), and the
  quotes below are from those pages:
  - `Performance.now()`: "returns a high resolution timestamp in milliseconds", a
    `DOMHighResTimeStamp` with "up to microsecond precision", relative to `timeOrigin` on a
    monotonic clock. So it is the right clock for a frame split, and no extra crate is needed.
  - `Window.requestAnimationFrame()`: the callback runs "before the next repaint" and gets a
    `DOMHighResTimeStamp` with "a minimal precision of 1 millisecond", equal to
    `document.timeline.currentTime` in a window. "`requestAnimationFrame()` calls are paused in
    most browsers when running in background tabs", which is why the soak's windows are counted
    from `web_time::Instant` and not from a frame counter alone.
  - Synchronous and asynchronous requests: "Synchronous requests block the execution of code
    which causes \"freezing\" on the screen and an unresponsive user experience." That is
    exactly what a synchronous `XMLHttpRequest` in `web/files.js` does to the frame, so the
    lazy read's own time belongs in the frame split as `io`.
- **`web-time` 1.1.0** (docs-mcp): `Instant::now()` "uses `Performance.now()`" on
  `wasm32-unknown-unknown` (std's would panic), it is a drop-in for `std::time`, and
  `-Ctarget-feature=+nontrapping-fptoint` makes it cheaper but "the vast majority of the time is
  still spent going through JS". That last part matters: timing a frame costs a JS call per
  reading, so the split reads the clock a handful of times per frame, not once per part of the
  draw.
- **`wgpu` 30.0.1** (docs-mcp): `Features::TIMESTAMP_QUERY`,
  `TIMESTAMP_QUERY_INSIDE_ENCODERS` and `TIMESTAMP_QUERY_INSIDE_PASSES` are each "a native only
  feature with a proposal for the web", and `PresentationTimestamp` is a native struct. So the
  browser build cannot measure GPU time; the `render` part is CPU time spent building and
  submitting the frame, and whatever the software GPU does afterwards lands in `other`. The web
  pages also say `RequestAdapterOptions::compatible_surface` is "strictly required" for WebGL and
  that `Limits::downlevel_webgl2_defaults()` is the browser's set, which is why the frame split
  does not try to time the GPU.

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
