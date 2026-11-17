# Design: web-frame-trace

### What the docs say (task 1.1)

**`playwright`: not in docs-mcp.** `search_docs` answers `Library playwright not found in store`,
so Playwright came from Firecrawl, `https://playwright.dev/docs/api/class-cdpsession`: a
`CDPSession` talks raw CDP, created with `page.context().newCDPSession(page)`, methods sent with
`session.send(method, params)`, events subscribed with `session.on(name, handler)`. Playwright's
own `tracing.start({path})` writes a *Playwright* trace (screenshots and a timeline for the trace
viewer), not a Chrome performance trace, so this change uses CDP directly.

**Chrome DevTools Protocol, `Tracing` domain.** From the protocol definition
(`ChromeDevTools/devtools-protocol`, `json/browser_protocol.json`, fetched through Firecrawl):
- `Tracing.start(categories?, options?, bufferUsageReportingInterval?, transferMode?,
  streamFormat?, streamCompression?, traceConfig?, ...)` — `categories` is a comma-separated
  list, `transferMode` is `ReportEvents` (the default, events arrive as `Tracing.dataCollected`
  chunks that the client must keep) or `ReturnAsStream` (a handle is returned instead).
- `Tracing.end()` stops recording; the client then gets `Tracing.tracingComplete`.
- `Tracing.dataCollected` carries `value`, an array of trace events. `Tracing.bufferUsage`
  reports how full the browser's buffer is.

The category list and the collection pattern come from the CDP lab guide,
`https://davidwhittington.github.io/chromium-cdp/` ("Performance timeline traces"), which records
the same data as the DevTools Performance panel:

    -*,devtools.timeline,v8.execute,disabled-by-default-devtools.timeline,
    disabled-by-default-devtools.timeline.frame,toplevel,blink.console,blink.user_timing,
    latencyInfo,disabled-by-default-devtools.timeline.stack,
    disabled-by-default-v8.cpu_profiler,disabled-by-default-v8.cpu_profiler.hires

`disabled-by-default-v8.cpu_profiler*` is what puts JS samples in the trace; `devtools.timeline`
is what puts the main-thread slices in it.

**Chrome trace event format.** The format is the Trace Event Format document
(`docs.google.com/document/d/1CvAClvFfyA5R-PhYUmn5OOQtYMH4h6I0nSsKchNAySU`), whose `X` (complete
slice) events carry `name`, `cat`, `ph: "X"`, `ts` and `dur` in **microseconds** on a thread
named by `pid`/`tid`, nested by time containment. The event names DevTools models are in the
Unofficial Trace Event Manual (`https://www.corewebvitals.io/chrome-trace/events`): the
renderer's main thread is the thread whose slices are wrapped in `RunTask`, and scripted
animations arrive as `FireAnimationFrame` slices on that thread. This is what `trace-top.mjs`
reads; the exact names in our own trace are checked in design section 4, not assumed.

**`winit` 0.30.13, docs-mcp**, query `PollStrategy enum request_redraw web animation frame`:
- `Window::request_redraw`, platform note for **Web**: "`WindowEvent::RedrawRequested` will be
  aligned with the `requestAnimationFrame`". So each `redraw` in `main.rs` that ends with
  `gfx.window.request_redraw()` (line ~2086) produces exactly one rAF callback, and the browser,
  not winit, decides when it fires.
- `EventLoopExtWebSys::spawn_app()` initialises the loop and returns immediately (the page
  already uses it); `run_app()` throws on web.
- `PollStrategy` (web only) is `IdleCallback` (`requestIdleCallback`, throttled) or `Scheduler`
  (Prioritized Task Scheduling API, the default). A `ControlFlow::Poll` loop therefore queues
  the next turn of the loop through the browser's scheduler, another place the main thread can
  wait between frames.

**`wgpu` 30.0.1, docs-mcp**, query `SurfaceTexture present get_current_texture frame latency`:
- `Surface::get_current_texture` returns a `SurfaceTexture` (`CurrentSurfaceTexture` in this
  version: `Success`, `Suboptimal`, `Timeout`, `Occluded`, `Outdated`, `Lost`, `Validation`), and
  `SurfaceTexture::present()` is the presentation step.
- `PresentMode::Fifo` (the default) is documented as a queue "approximately 3 frames long" and
  "Calls to `Surface::get_current_texture()` will block until there is a spot in the queue"; on
  the web the browser's compositor owns that queue. So a WebGL present can be where the main
  thread waits, and the trace has to show it as a slice (typically `GraphicsLayer`/`Commit` or a
  long `FunctionCall`) rather than as our `render` timer.

**`mdn-web-apis`:** the search for `requestAnimationFrame` returned File API and drag-and-drop
pages, nothing about frame callbacks, so the rAF meaning used here is the winit platform note
above (one `RedrawRequested` per rAF) plus the trace itself.

## 1. Why a trace and not more timers
`web-perf` already times everything the program can see around its own calls, and `other` is by
definition the time *between* two `redraw`s that no code of ours is running. No timer inside the
wasm can see it: the gap is either the browser's own frame scheduling, a task the browser runs
on the main thread between our frames (present, compositing, GC), or our harness's work in
the page (`page.evaluate`, screenshots) landing in the same gap. A Chrome trace sees all of them
from outside the wasm.

## 2. `SMOKE_TRACE=<file>` in `web/tests/smoke.mjs`
The trace run is the soak's setup (so the numbers describe the same scene) with a shorter, fixed
window:
1. `SMOKE_TRACE` implies the menu walk (`MENU`), so `enterFirstMission("Trace")` runs the intro,
   the registry, the family and the first mission exactly as the soak does.
2. `set_soak(true)` turns on the app's own fps and frame-split lines, so the same run prints
   `min fps` and `frame ms ...` next to the trace.
3. A canvas click takes the keyboard, then eleven `]` presses reach the fastest speed
   (`SPEED_STEPS`).
4. A CDP session (`page.context().newCDPSession(page)`) records `Tracing.start` with the
   categories above and `transferMode: "ReportEvents"`; every `Tracing.dataCollected` value is
   kept, and `Tracing.end` is followed by `Tracing.tracingComplete`.
5. The window is 20 s of wall clock, with no `page.evaluate` polling inside it: the harness must
   not be part of the measurement if the trace is to name the game's gap. (The console handler
   still runs; it only appends strings.)
6. The events are written with `JSON.stringify` to `<file>` and the run prints
   `osiris web: trace written to <file> (<n> events, <mb> MB)` and the fps/frame lines it
   collected. The file is never inside the repo; `scripts/no-game-files.sh` and the git hooks do
   not see it, and the acceptance command writes `/tmp/osiris-trace.json`.

`scripts/web-smoke.sh` only has to give the run a timeout: a trace run adds 20 s plus the
trace's own collection to the walk, so it gets the soak's 1800 s.

## 3. `scripts/trace-top.mjs <trace.json>`
Plain node, no dependency. It reads the JSON array and:
- picks the **main thread**: of all `(pid, tid)` pairs, the one with the most total `dur` in
  `RunTask` slices (the renderer's main thread); if no thread has `RunTask`, the one with the
  most total `dur` overall, so the tool still says something on an unexpected trace.
- sums `dur` per `name` over `ph: "X"` slices on that thread and prints the ten biggest as
  `total ms`, `count`, `name` (sorted by total, ties by count).
- prints the **mean ms between two `requestAnimationFrame` callbacks** from the `ts` of the
  main thread's `FireAnimationFrame` slices (the slices that run rAF callbacks), plus the median
  and the worst gap so one long frame cannot hide behind a mean.
- prints the trace's own span and the thread it chose, so the numbers can be checked against the
  run.

## 4. The numbers (task 1.4)
To be filled from the run.

## 5. The cause and the fix (task 1.5)
To be filled from the trace.
