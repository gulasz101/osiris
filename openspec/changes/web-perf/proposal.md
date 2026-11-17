# web-perf: find where the frame time goes at the fastest game speed

## Why
The soak run (`docs/STATUS.md`) logs `soak OK (24 months, min fps 6, ...)` for mission 0 at the
fastest game speed. Six frames a second is not playable, and nobody knows which part costs the
time: the game rules (`game.update`), the drawing (`gfx.frame`, which headless Chrome runs
without a GPU), or the synchronous file reads that `web-lazy` added (`web/files.js`, one sync
`XMLHttpRequest` per read, and the store keeps nothing, so a sound played a hundred times is
read a hundred times). This change measures first and then fixes the biggest cost that is ours.

## What changes
- `crates/osiris-app/src/soak.rs`: a `FrameSplit` that adds up the time of each part of a frame
  and reports the average and worst frame over the same ten seconds as `Fps`.
- `crates/osiris-app/src/main.rs` (`redraw`): time `game.update` (sim) and `gfx.frame` (render)
  in the soak run only.
- `crates/osiris-app/src/web.rs` (`lazy_read`): add the time of every lazy read to the frame's
  `io`, and count reads per path, so the soak run can name the files read most.
- `web/tests/smoke.mjs`: parse and print the new line next to the fps line.
- One fix, chosen by the numbers (design 4), then `docs/STATUS.md` with before and after.

## Out of scope
- Web Workers or threads of any kind. If the fix needs them, stop and say so on the issue.
- Making headless Chrome's software GPU faster (flags, a different browser).
- Any change to the game rules. A sim fix may make the same rules cheaper, never different:
  the `cargo test --workspace` replay tests must give the same results.
