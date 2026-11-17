# Design: web-progress

## One reader for every source
The three ways the game files arrive (folder picker, drag and drop, the copy in browser
storage) all end up as "read a file, mount its bytes". The read was a `for` loop in
`web/main.js` `loadFolder`, and `web/opfs.js` `readTree` had its own loop. Both now call
`readAll` from the new `web/progress.js`:

```js
readAll(items, read, take, bar, limit)
```

`read` turns one item into an `ArrayBuffer`, `take` puts it where it belongs, `bar` is the
progress strip (or `null`), and `limit` is how many reads may be in flight at once. The loop
starts `min(limit, items.length)` workers and each takes the next index, so no file is skipped
and the order of mounting does not matter: `mount_file` writes into a map keyed by path.

`Blob.arrayBuffer()` returns a promise that resolves with the blob's bytes, and the promise
rejects instead of throwing when the read fails (MDN, `Blob.arrayBuffer`, read in docs-mcp), so
one unreadable file (the folder was moved while the page read it) still reaches the `catch` in
`main.js` that puts the error in the status line. `Promise.all` runs the workers and rejects
with the first failure (MDN, `Promise.all`, read in docs-mcp); a `failed` flag makes the other
workers stop instead of mounting files after the failure. The `finally` hides the bar either
way.

Reading eight at a time is the issue's number. It trades memory for time: at most eight
files' bytes exist besides the one being mounted, and the largest game file is a few tens of
megabytes, so the peak stays in the hundreds of megabytes, which the page already uses for the
mounted install.

## The bar itself
`web/index.html` gains

```html
<div id="progress" hidden>
    <div id="progress-track"><div id="progress-fill"></div></div>
    <p id="progress-text"></p>
</div>
```

It is `position: fixed; inset: 0` with a translucent background, so it sits over the canvas (or
over the start page before the game starts) and the page never looks dead. `pointer-events:
none` keeps it out of the way of the drag-and-drop handlers. `#progress[hidden] { display:
none; }` is spelled out because `display: flex` would otherwise beat the browser's own rule for
the `hidden` attribute, the same trap `#start` already documents.

`createBar(element)` returns `{ show(total), update(done), finish(done) }`. `show` writes
`0 / total` at once and records the time; `update` redraws only when at least
`INTERVAL_MS` (100) has passed since the last redraw, which is the issue's "at most every
100 ms"; `finish` draws the final count whatever the clock says and hides the strip. The clock
is a parameter (`{ now }`) so `web/tests/progress-test.mjs` can drive it without waiting.

The text is `progressText(done, total)`:

```
Reading game files: 412 / 1335 (31%)
```

The percentage is `Math.round(done / total * 100)`, which is what the issue's own example
shows for 412 of 1335 (30.86% rounds to 31%).

## How long the start takes
The pick happens in JavaScript, the main menu appears inside the wasm program, so the clock is
handed over once. `web/main.js` calls the new `set_pick_time(performance.now())` at module
start (a visit that restores the files from browser storage has no pick, so the page loading is
its start) and again in `loadFolder` for the picker and for a drop. `web.rs` keeps that number
in a `thread_local` `Cell<Option<f64>>`; `since_pick_ms()` subtracts it from
`window.performance.now()` (`Window.performance()` and `Performance.now()`, read in docs-mcp;
`web-sys` gains its `Performance` feature). `main.rs` logs, right after the existing
`osiris web: main menu` line:

```
osiris web: menu after 4123 ms
```

The two lines mark the same moment — the menu being built, which is before the intro movie
plays, exactly as the desktop build and the existing smoke test already understand "main menu".
A `?mission=N` run never builds the menu and so never logs the time.

## What the smoke test proves
`SMOKE_PICK=1` is a new mode: after staging the files under `web/game-data-staging/`, the test
gives the folder to `#folder` (`page.setInputFiles`), as the wrapped and viewport runs already
do, so `main.js` is what reads the files. While the read is running the test polls for
`#progress` being visible with text matching `Reading game files: <n> / <total> (<p>%)`, saves
`/tmp/osiris-web-loading.png` at that moment and prints `osiris web: loading bar OK`. It then
waits for the canvas and the main menu and checks `osiris web: menu after N ms` before going on
to the ordinary menu checks (sound, canvas colours, screenshot). Without game data the mode is
skipped, as the other game-data modes are.

Every run that logs `osiris web: main menu` also has to log `osiris web: menu after N ms`, so
the number cannot quietly disappear.

## Numbers (measured on this machine)

Filled in as the tasks are done; the machine is Wojtek's Mac, the data folder is
`/Users/paperclip/PharaohData/Akhenaten/resources` (1335 files, 778 MB).

| what | before | after |
|---|---|---|
| wasm size, `web/pkg/osiris_bg.wasm` | 13,739,637 bytes (release build) | 13,749,481 bytes (release build; the bar and the clock cost about 10 KB) |
| reading the 1335 files, one at a time | 3,776 / 4,141 / 5,333 ms over three runs (the disk cache moves it) | 2,552 / 2,940 ms with eight at a time |
| picking the folder to the main menu | 4,256 ms | 2,871 / 3,419 ms |

Eight reads at a time is the faster way here: about a third less time on the read, and
about the same on the start as a whole, because the disk and the mounting of the files set the
pace rather than the CPU. The page keeps the eight. The peak cost is memory: at most eight
files' bytes are held besides the one being mounted, and the largest file in the install is a
few tens of megabytes.

`wasm-opt` is not installed on the machine this was written on, so the build here took the
skip path and the size above is the plain release build. The `-O2` path is one line in
`scripts/build-web.sh` and needs no change to anything else; it has not been measured here.
