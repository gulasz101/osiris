# web-frame-trace: name what fills the 183 ms between frames on the real GPU

## Why
`web-gpu-fps` proved the slow frame is not the missing GPU. On this host, with Chrome on Metal
and with ANGLE on OpenGL, the soak gives `min fps 5` and `other 183.1 ms` of a 191.7 ms frame,
while the parts the program times itself (`game.update`, `gfx.frame`, the file reads) add up to
8.6 ms (`docs/STATUS.md`, "The same soak on the M1 Air's real GPU"). A browser on a real GPU
paces frames at about 16 ms, so ~180 ms between two `redraw` calls means something blocks the
main thread that our timers do not cover. A trace has to name it; guessing has already been
wrong once (the earlier "headless has no GPU" explanation).

The candidates, none of them proven: the soak harness itself (`page.evaluate` polling, the
screenshots, the console handler in `web/tests/smoke.mjs`); wgpu's WebGL present and
`get_current_texture`; the synchronous XHR file reads outside the `io` timer; garbage collection;
or winit's web event loop between `request_redraw` (`crates/osiris-app/src/main.rs` at the end of
`redraw`) and the next `RedrawRequested`.

## What changes
- `web/tests/smoke.mjs`: `SMOKE_TRACE=<file>` records a Chrome performance trace with JS
  sampling for 20 s of the running city at the fastest speed, on the soak's own path, and
  writes it to `<file>` outside the repo.
- `scripts/trace-top.mjs <trace.json>`: the ten biggest main-thread slices by total time (name,
  total ms, count) and the mean gap between two `requestAnimationFrame` callbacks. No new npm
  dependency.
- `openspec/specs/web-frame-trace/spec.md`: the trace run and the report as a lasting check.
- `docs/STATUS.md`: the table, the rAF gap, and what fills the ~180 ms, with the command that
  makes it.

## Out of scope
- Web Workers or threads of any kind. If the cause needs them, stop and say so on the issue.
- Any change to the game rules (`crates/osiris-sim`). A fix may make the same rules cheaper,
  never different: `cargo test --workspace` must still give the same replay results.
- Committing a trace file. Traces are written outside the repo (for example `/tmp`) and never
  added to git.
- Making the browser's own frame pacing faster by changing Chrome flags, unless the trace shows
  that a flag is the cause and the fix is small.
