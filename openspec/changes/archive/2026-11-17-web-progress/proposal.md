# web-progress: a progress bar while the files load, and a faster start

## Why
From the moment the player picks their Pharaoh folder to the main menu the page shows one
status line ("Reading 51 of 1335 files...") that changes only every fifty files. A full GOG
install is 778 MB and 1335 files, so the page looks dead for the whole read. Wojtek asked for a
real progress bar, for reading the files faster, and for a number that says how long the start
takes.

## What changes
- `web/progress.js` (new): `progressText(done, total)` gives
  `Reading game files: 412 / 1335 (31%)`; `createBar(element)` drives the bar in the page and
  repaints it at most every 100 ms (`INTERVAL_MS`); `readAll(items, read, take, bar, limit)`
  reads up to `limit` files at the same time (`MAX_READS` is 8) and feeds the bar.
- `web/index.html`: a `#progress` strip over everything — a track, a gold fill and the text —
  hidden until the first file is read.
- `web/main.js`: `loadFolder` reads through `readAll` for the folder picker and for drag and
  drop, logs `osiris web: read <n> files in <ms> ms`, and calls `set_pick_time` when the page
  loads and again at every pick. The restored copy in browser storage feeds the same bar.
- `web/opfs.js`: `readTree` walks the folder into a list first and then reads it through
  `readAll`, so the restore from browser storage shows the bar and reads eight files at a time.
- `crates/osiris-app/src/web.rs`: `set_pick_time(at)` keeps the page's pick on the browser's
  own clock; `since_pick_ms()` says how long ago it was.
- `crates/osiris-app/src/main.rs`: at the main menu the browser build logs
  `osiris web: menu after N ms` next to the existing `osiris web: main menu`.
- `scripts/build-web.sh`: says out loud that it builds the release wasm, and runs
  `wasm-opt -O2` on `web/pkg/osiris_bg.wasm` when `wasm-opt` is on `PATH`. Without it the
  script logs one line and keeps the plain release build; nothing new is required to build.
- `web/tests/progress-test.mjs` (new): the bar's text, the 100 ms repaint limit, and that
  `readAll` never has more than eight reads in flight. Added to `scripts/check.sh`.
- `web/tests/smoke.mjs`: `SMOKE_PICK=1` hands the staged folder to the page's own folder
  picker, waits for the bar, saves `/tmp/osiris-web-loading.png`, and then runs the ordinary
  main-menu checks. Every run that reaches the menu checks `osiris web: menu after N ms`.
- `scripts/pages-site.sh`, `scripts/check-site.sh`: `progress.js` is a page file.
- `docs/STATUS.md`: a "Works" line for the bar and the start time, and the `SMOKE_PICK` mode
  in the checks section.

## Out of scope
- Game rules, game graphics, and the desktop build. The bar and the read order are page code.
- A progress bar for the copy *into* browser storage (`web-remember`'s `save`): that copy runs
  after the game has started and already logs its progress to the console.
- Web Workers, threads or streaming compilation: the browser build is single-threaded and the
  file reads are already asynchronous.
- Compressing the wasm beyond a release build plus `wasm-opt` when it happens to be installed.

## Risks
- Eight reads at once hold up to eight files' bytes at the same time on top of the one being
  mounted. The largest game file decides the peak; the smoke run with the real install is the
  check that the page still reads everything.
- Reading faster may not change much when the files are already in the operating system's disk
  cache, which is what a repeat smoke run sees. `design.md` records what was measured and on
  which run, and the slower of the two is the one kept.
- `wasm-opt` is not installed on this machine, so the size number stays the plain release
  build. The script only uses it when it is there.
- `osiris web: menu after N ms` includes the game's own start (assets, first frame), not only
  the read, so two runs differ by more than the read alone.
