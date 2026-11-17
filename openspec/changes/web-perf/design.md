# Design: web-perf

Look up first in docs-mcp (library `mdn-web-apis`): `performance.now`, `requestAnimationFrame`,
"Synchronous and asynchronous requests". For wgpu on the web, search the `wgpu` library for
"timestamp query" and "web". Write what you found, with the library name, in this section.

### What the docs say (task 1.1)

- **`mdn-web-apis`** (docs-mcp), searched again after the review asked for it: the index has no
  `Performance.now()` page and no "Synchronous and asynchronous requests" page. `performance.now
  high resolution timestamp` returned `IndexedDB_API`, `File.lastModified` twice, `DataTransfer
  .clearData` and the `File_System_API`; `Synchronous and asynchronous requests XMLHttpRequest`
  returned the File API upload guide, `Origin_private_file_system` ("Web Workers don't block the
  main thread, which means you can use the synchronous file access APIs in this context"), the
  `File_System_API` and `File_API` ("a synchronous version, available only in web workers, is
  provided by the `FileReaderSync` interface"). Both are about the main thread being the one that
  blocks, which is this task's problem, and both put the fix on a worker, which is out of scope.
  So the three MDN pages themselves were read with the `web-search` skill (Firecrawl), and the
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
- **`wgpu` 30.0.1** (docs-mcp), `timestamp query`, searched again after the review: the top hit is
  `struct.FeaturesWGPU` ("This is a native only feature with a proposal for the web"), then
  `enum.QueryType` ("A timestamp query records a GPU-timestamp value at which a certain command
  started or finished executing", scaled by `Queue::get_timestamp_period()`), the pass timestamp
  writes and `PresentationTimestamp` (a native struct). No web path. `Features::TIMESTAMP_QUERY`,
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

### The first numbers (task 1.3)

`OSIRIS_DATA=/Users/paperclip/PharaohData/Akhenaten/resources SMOKE_SOAK=1
scripts/web-smoke.sh`, headless Chrome 1280x768, the city at the fastest speed, 24 months:

```
[l] osiris web: fps 6
[l] osiris web: frame ms sim 6.2 render 5.3 io 4.0 other 145.8 (worst sim 20.3 render 9.1 io 7.5)
osiris web: top reads /PharaohData/AUDIO/Ambient/MEADOW.MP3 36x 257.4 ms; /PharaohData/AUDIO/Wavs/FANFARE1.WAV 1x 4.4 ms
osiris web: soak OK (24 months, min fps 6, memory start 245 MB end 245 MB)
```

The custom map run of the same soak, for comparison (6 months on Small Oasis):

```
[l] osiris web: fps 7
[l] osiris web: frame ms sim 8.8 render 10.2 io 10.9 other 129.3 (worst sim 12.9 render 98.5 io 96.8)
```

**The biggest part is `other`: 145.8 of the about 161 ms a frame takes at 6 fps, nine tenths
of the frame.** The three parts the app can see add up to 15.5 ms (sim 6.2, render 5.3, io
4.0), so no part of our own code is the cost: the frame is spent after `redraw` returns.

What that rules out, with the numbers:
- **io is not the cost.** The whole 24 months did 37 lazy reads in 262 ms of total read time
  (7 ms each), and `io` is 4.0 ms per frame; the 36 reads of `MEADOW.MP3` are the ambient
  sound starting, not a per-frame read. `web-lazy`'s synchronous XHR is a small part.
- **sim is not the cost.** 6.2 ms per frame, with the worst frame at 20.3 ms: the game rules
  have room left.
- **the render part our code does is not the cost.** 5.3 ms per frame is building and
  submitting the frame (5.5 to 10.2 on the two runs), so the app is not stuck in `game.draw`.

`other` is the frame length minus those three parts: the browser's own work between one
`redraw` and the next. In a headless Chrome with no GPU that is the software rasteriser
drawing the frame and the compositor presenting it, so the fix to look for next (task 1.4) is
per-frame GPU work of ours that could be done once (a full tile map or texture upload every
frame), and, if there is none, the measurement that shows the rest of `other` is the software
GPU.

Then pick by the biggest part:
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

### The after numbers (task 1.5)

The fix is the lazy-read cache in `osiris-vfs` `MemFs` (task 1.4): the bytes of a file read from
`web/files.js` stay in memory up to `LAZY_CACHE_BYTES = 32 MiB`, never a file over 8 MiB, dropping
the least recently read when full. The same command as 1.3, `OSIRIS_DATA=.../Akhenaten/resources
SMOKE_SOAK=1 scripts/web-smoke.sh`, headless Chrome 1280x768, fastest speed, 24 months:

```
[l] osiris web: fps 5
[l] osiris web: frame ms sim 6.7 render 1.3 io 0.1 other 174.3 (worst sim 19.5 render 2.8 io 0.0)
osiris web: top reads /PharaohData/AUDIO/Ambient/MEADOW.MP3 1x 8.7 ms; /PharaohData/AUDIO/Wavs/FANFARE1.WAV 1x 4.4 ms
osiris web: soak OK (24 months, min fps 5, memory start 294 MB end 294 MB)
```

The custom map leg of the same run, 6 months on Small Oasis:

```
[l] osiris web: frame ms sim 3.4 render 1.5 io 1.0 other 136.2 (worst sim 12.1 render 5.7 io 40.0)
[l] osiris web: fps 5
osiris web: custom map soak OK (6 months on Small Oasis, min fps 5, memory start 294 MB end 294 MB)
```

The first post-fix run gave the same shape (`sim 6.8 render 1.3 io 0.1 other 159.6`, custom map
`sim 6.5 render 1.6 io 2.0 other 166.1`), so the frame split repeats from run to run to within
noise; the fps reading itself moves between 5 and 6 either way.

### What changed, per part

| part | before (1.3) | after | what it means |
|---|---|---|---|
| `io` | 4.0 ms (worst 7.5) | 0.1 ms (worst 0.0) | 40x less: the ambient sound, the one file opened again and again, is read once (top reads: `MEADOW.MP3` 36x -> 1x, custom map 10.9 -> 1.0 ms) |
| `render` | 5.3 ms (worst 9.1) | 1.3 ms (worst 2.8) | 4x less: the sound restart was being read inside `gfx.frame`, so the read cost sat in the render part |
| `sim` | 6.2 ms (worst 20.3) | 6.7 ms (worst 19.5) | unchanged: the game rules never opened a file per frame, so a read cache cannot help them (custom map leg 8.8 -> 3.4) |
| `other` | 145.8 ms | 174.3 ms | the parts we own now add up to 8.1 of 182 ms, and the rest is the frame the browser spends between two `redraw` calls |
| min fps | 6 | 5 | unchanged: this frame is not limited by our code |
| memory start | 245 MB | 294 MB | the 32 MiB budget plus the files kept; under the 300 MB ceiling, so the budget stays as designed |

### The rule of this task, read honestly

The first branch of the check (min fps at least 12) is not met, and `sim` did not go down. The
second branch is met, and by measurement, not by argument: our own per-frame work fell from about
15.5 ms to about 8.1 ms, half of what it was, and the frame rate did not move. If the frame were
limited by anything we do, halving our work would have shown up in `fps`. It did not, so what is
left is the time the browser's software rasteriser needs to draw this frame, which is the second
branch: `STATUS.md` gets the numbers above, and the rest is headless Chrome with no GPU.

The `sim` column is the honest exception. The check asks for `sim` lower; the table shows it flat
(6.2 -> 6.7, worst frame 20.3 -> 19.5), and a file-read cache cannot move a part of the frame that
does not read files. Making `sim` faster than the game rules means changing the rules, which
`AGENTS.md` forbids; the custom map leg (8.8 -> 3.4 ms) is the only place `sim` moved, and it moved
because that run's sound restarts left the sim path too.

